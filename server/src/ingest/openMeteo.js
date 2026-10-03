// Open-Meteo ingestion (backend only). One batched request for all locations, cached in weather_cache.
// Open-Meteo data is licensed CC BY 4.0 — attribution lives on the About page only.
import { q, tx } from '../db/index.js';
import { riskConfig } from '../config/shared.js';
import { env } from '../config/env.js';
import { featuresAt, hourIndex, fallbackHourly } from './features.js';
import { nowIso } from '../lib/util.js';
import { bus } from '../events/bus.js';

export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const HOURLY_VARS = [
  'precipitation', 'rain', 'snowfall', 'snow_depth', 'temperature_2m', 'relative_humidity_2m', 'cloud_cover',
  'freezing_level_height', 'weather_code', 'soil_temperature_0cm',
  'soil_moisture_0_to_1cm', 'soil_moisture_1_to_3cm', 'soil_moisture_3_to_9cm', 'soil_moisture_9_to_27cm', 'soil_moisture_27_to_81cm',
];

export function buildForecastUrl(locations) {
  const params = new URLSearchParams({
    latitude: locations.map((l) => l.lat.toFixed(4)).join(','),
    longitude: locations.map((l) => l.lng.toFixed(4)).join(','),
    hourly: HOURLY_VARS.join(','),
    daily: 'precipitation_sum',
    past_days: '7',
    forecast_days: '3',
    timezone: 'Asia/Kolkata',
  });
  return `${FORECAST_URL}?${params.toString()}`;
}

export function setFeed(feed, status, message, success) {
  const now = nowIso();
  q.run(`INSERT INTO feed_status(feed, status, last_success, last_attempt, message)
         VALUES (:feed, :status, :ls, :now, :message)
         ON CONFLICT(feed) DO UPDATE SET status = excluded.status, last_attempt = excluded.last_attempt, message = excluded.message,
           last_success = COALESCE(excluded.last_success, feed_status.last_success)`,
    { feed, status, ls: success ? now : null, now, message: message || null });
}

function storeLocation(loc, hourly, daily, source, fetchedAt) {
  const i = hourIndex(hourly, Date.now());
  const features = featuresAt(hourly, i);
  q.run(`INSERT INTO weather_cache(location_id, fetched_at, hourly_json, daily_json, features_json, source)
         VALUES (:id, :at, :h, :d, :f, :src)
         ON CONFLICT(location_id) DO UPDATE SET fetched_at = excluded.fetched_at, hourly_json = excluded.hourly_json,
           daily_json = excluded.daily_json, features_json = excluded.features_json, source = excluded.source`,
    { id: loc.id, at: fetchedAt, h: JSON.stringify(hourly), d: JSON.stringify(daily || {}), f: JSON.stringify(features), src: source });
}

/** Error for a refused request, with Open-Meteo's own explanation, e.g. "HTTP 429 (Daily API request limit exceeded…)". */
export async function httpError(res, label = 'HTTP') {
  let reason = '';
  try { reason = String(JSON.parse(await res.text())?.reason || ''); } catch { /* no readable body */ }
  const err = new Error(`${label} ${res.status}${reason ? ` (${reason.slice(0, 160)})` : ''}`);
  err.status = res.status;
  return err;
}

// True while Open-Meteo is refusing our requests for exceeding its usage limit (HTTP 429). On shared hosting the
// limit is shared with other apps on the same internet address, so the AI model's request would be refused too.
let refused = false;
export const openMeteoRefused = () => refused;

/** Fetch all locations in one call. Keeps the last cached snapshot on any failure. */
export async function refreshWeather({ fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  const locations = q.all('SELECT id, lat, lng FROM locations ORDER BY id');
  if (!locations.length) return { ok: false, reason: 'no_locations' };
  const url = buildForecastUrl(locations);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Bhu-Rakshak/0.1 (SIH 2026 prototype)' } });
    clearTimeout(timer);
    if (!res.ok) throw await httpError(res);
    let body = await res.json();
    if (!Array.isArray(body)) body = [body];
    if (body.length !== locations.length) throw new Error(`expected ${locations.length} results, got ${body.length}`);
    const fetchedAt = nowIso();
    tx(() => body.forEach((r, k) => {
      if (!r.hourly?.time?.length) throw new Error(`no hourly data for ${locations[k].id}`);
      storeLocation(locations[k], r.hourly, r.daily, 'open-meteo', fetchedAt);
    }));
    setFeed('open_meteo', 'ok', `${locations.length} locations`, true);
    refused = false;
    bus.emit('weather_refreshed', { at: fetchedAt, source: 'open-meteo' });
    return { ok: true, count: locations.length };
  } catch (e) {
    refused = e.status === 429;
    const msg = e.name === 'AbortError' ? 'timeout' : e.message;
    const cached = q.one('SELECT COUNT(*) AS n FROM weather_cache WHERE source = :s', { s: 'open-meteo' }).n;
    setFeed('open_meteo', cached ? 'degraded' : 'error', `Serving last cached snapshot (${msg})`, false);
    if (process.env.NODE_ENV !== 'test') console.warn(`[open-meteo] refresh failed: ${msg}. Serving cached data.`);
    ensureFallback();
    return { ok: false, reason: msg };
  }
}

/** Make sure every location has *some* weather rows (fallback climatology when never fetched). */
export function ensureFallback() {
  const missing = q.all(`SELECT l.id, l.lat, l.lng, l.district, s.elevation_m FROM locations l
                         JOIN static_layers s ON s.location_id = l.id
                         LEFT JOIN weather_cache w ON w.location_id = l.id WHERE w.location_id IS NULL`);
  if (!missing.length) return 0;
  const fetchedAt = nowIso();
  tx(() => missing.forEach((l) => storeLocation(l, fallbackHourly(l, l.elevation_m, Date.now()), {}, 'fallback_climatology', fetchedAt)));
  return missing.length;
}

// After a failed refresh, try again sooner than the regular schedule: 5 min later, then 15 min after that.
// The ladder restarts after the next success.
const RETRY_MINUTES = [5, 15];
let retryTimer = null;
let retries = 0;
async function scheduledRefresh() {
  const r = await refreshWeather();
  if (r.ok) {
    retries = 0;
    clearTimeout(retryTimer);
    retryTimer = null;
    return;
  }
  if (retryTimer || retries >= RETRY_MINUTES.length) return;
  const minutes = RETRY_MINUTES[retries++];
  console.warn(`[open-meteo] trying again in ${minutes} min.`);
  retryTimer = setTimeout(() => { retryTimer = null; scheduledRefresh(); }, minutes * 60000);
  retryTimer.unref?.();
}

let cronTask;
let intervalHandle;
export async function startWeatherSchedule() {
  ensureFallback();
  if (env.disableIngest) {
    setFeed('open_meteo', 'degraded', 'Ingest disabled by DISABLE_INGEST', false);
    return;
  }
  scheduledRefresh(); // fire and forget; cached/fallback data serves meanwhile
  const minutes = riskConfig.live.openMeteoRefreshMinutes;
  try {
    const cron = (await import('node-cron')).default;
    cronTask = cron.schedule(`*/${minutes} * * * *`, () => scheduledRefresh(), { timezone: 'Asia/Kolkata' });
  } catch {
    intervalHandle = setInterval(() => scheduledRefresh(), minutes * 60000);
  }
}
export function stopWeatherSchedule() {
  cronTask?.stop();
  if (intervalHandle) clearInterval(intervalHandle);
  clearTimeout(retryTimer);
}
