// EXPERIMENTAL landslide model — a second opinion for officers, logged daily. It never raises alerts or citizen
// warnings (the baseline engine keeps doing that).
//
// The model (ml/models/landslide-live.json) was trained on 180 news-reported landslides (NASA GLC + hand-checked
// 2026 reports) with bias checks; see ml/models/live_model.md for how well it does (and doesn't) work.
// Every 3 hours: one batched Open-Meteo request (31 past days + today + tomorrow) → the same 26 factors as in
// training (ml/live_features.mjs, verified against real training rows in server/test/mlModel.test.js) → score for
// today and tomorrow at every monitored place → logged in ml_predictions, so it can be judged against landslides
// that happen later (a prediction is only credible if it was made before the event).
import fs from 'node:fs';
import path from 'node:path';
import { q, tx } from '../db/index.js';
import { env, REPO_ROOT } from '../config/env.js';
import { nowIso } from '../lib/util.js';
import { setFeed, httpError, openMeteoRefused } from '../ingest/openMeteo.js';
import { seismicData } from '../ingest/seismic.js';
import { bus } from '../events/bus.js';
import { liveFeatures } from '../../../ml/live_features.mjs';
import { predictProba } from '../../../ml/gbdt.mjs';

const MODEL_FILE = path.join(REPO_ROOT, 'ml/models/landslide-live.json');
const PLACES_FILE = path.join(REPO_ROOT, 'ml/models/live_locations.json');
const REFRESH_MIN = 180;
const IST_MS = 5.5 * 3600000;

let model = null;
let places = null;
let latest = { computed_at: null, predictions: {} };

let loadedMtime = 0;
/** Loads the model; reloads it when ml/retrain.mjs --promote replaces the file (checked at most once a minute). */
let lastCheck = 0;
export function loadModel() {
  if (model && Date.now() - lastCheck < 60000) return model;
  lastCheck = Date.now();
  const mtime = fs.statSync(MODEL_FILE).mtimeMs;
  if (!model || mtime !== loadedMtime) {
    model = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8'));
    places = JSON.parse(fs.readFileSync(PLACES_FILE, 'utf8')).locations;
    loadedMtime = mtime;
  }
  return model;
}

/** Average of the bagged models' scores for one feature object. */
export function scoreFeatures(features) {
  const m = loadModel();
  const row = m.features.map((f) => features[f] ?? null);
  return m.models.reduce((a, mm) => a + predictProba(mm, row), 0) / m.models.length;
}

/** Public, citizen-safe summary of the model (no trees). */
export function modelCard() {
  const m = loadModel();
  return {
    version: m.version, created_at: m.created_at, status: m.status, meaning: m.meaning,
    elevated_threshold: m.ops_threshold, evaluation: m.evaluation, training_data: m.training_data, sources: m.sources,
  };
}

export const istDate = (ms = Date.now()) => new Date(ms + IST_MS).toISOString().slice(0, 10);

function quakesForModel() {
  return (seismicData().quakes || []).filter((e) => e.mag >= 4).map((e) => ({ time: Date.parse(e.time), mag: e.mag, lat: e.lat, lng: e.lng, depth_km: e.depth_km }));
}

/** Score one place from one Open-Meteo series (daily IST days; hourly from 00:00 IST of daily.time[0]). */
export function scorePlace(locationId, series, quakes, todayIso) {
  loadModel();
  const place = places[locationId];
  if (!place) return null;
  const out = {};
  for (const [label, date] of [['today', todayIso], ['tomorrow', istDate(Date.parse(todayIso + 'T12:00:00+05:30') + 86400000)]]) {
    const n = series.daily.time.indexOf(date);
    if (n < 30) continue;
    const f = liveFeatures({ daily: series.daily, hourly: series.hourly, n, place, quakes });
    const score = scoreFeatures(f);
    out[label] = {
      date, score: +score.toFixed(4), elevated: score >= model.ops_threshold,
      inputs: {
        rain_d0: f.rain_d0, rain_3d: +f.rain_3d.toFixed(1), rain_7d: +f.rain_7d.toFixed(1), rain_30d: +f.rain_30d.toFixed(0),
        rain_3d_vs_normal: f.rain_3d_vs_normal == null ? null : +f.rain_3d_vs_normal.toFixed(2),
        max_1h_48h: f.max_1h_48h, quake_max_mmi_30d: +f.quake_max_mmi_30d.toFixed(1),
      },
      features: f,
    };
  }
  return out;
}

export async function refreshMl({ fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  loadModel();
  const ids = Object.keys(places);
  const params = new URLSearchParams({
    latitude: ids.map((id) => places[id].lat.toFixed(4)).join(','),
    longitude: ids.map((id) => places[id].lng.toFixed(4)).join(','),
    daily: 'precipitation_sum,snowfall_sum,temperature_2m_max,temperature_2m_min',
    hourly: 'precipitation', past_days: '31', forecast_days: '2', timezone: 'Asia/Kolkata',
  });
  try {
    const res = await fetchImpl(`https://api.open-meteo.com/v1/forecast?${params}`, { headers: { 'User-Agent': 'Bhu-Rakshak/0.1 (SIH 2026 prototype)' }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw await httpError(res, 'Open-Meteo HTTP');
    const body = await res.json();
    const series = Array.isArray(body) ? body : [body];
    const today = istDate(now);
    const quakes = quakesForModel();
    const computedAt = new Date(now).toISOString();
    const predictions = {};
    ids.forEach((id, i) => { const s = scorePlace(id, series[i], quakes, today); if (s) predictions[id] = s; });
    tx(() => {
      for (const [id, p] of Object.entries(predictions)) {
        for (const d of Object.values(p)) {
          q.run(`INSERT INTO ml_predictions(location_id, for_date, issued_on, score, elevated, model_version, features_json, computed_at)
                 VALUES (:id, :for, :issued, :score, :el, :ver, :f, :at)
                 ON CONFLICT(location_id, for_date, issued_on) DO UPDATE SET score = excluded.score, elevated = excluded.elevated,
                   model_version = excluded.model_version, features_json = excluded.features_json, computed_at = excluded.computed_at`,
          { id, for: d.date, issued: today, score: d.score, el: d.elevated ? 1 : 0, ver: model.version, f: JSON.stringify(d.features), at: computedAt });
        }
      }
    });
    latest = { computed_at: computedAt, predictions: Object.fromEntries(Object.entries(predictions).map(([id, p]) => [id, Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { date: v.date, score: v.score, elevated: v.elevated, inputs: v.inputs }]))])) };
    const elevated = Object.values(latest.predictions).filter((p) => p.today?.elevated).length;
    setFeed('ml_model', 'ok', `Experimental model ${model.version}: ${Object.keys(predictions).length} places scored, ${elevated} elevated today (not used for alerts)`, true);
    return { ok: true, places: Object.keys(predictions).length };
  } catch (e) {
    setFeed('ml_model', latest.computed_at ? 'degraded' : 'error', `Experimental model: ${e.message}`, false);
    if (process.env.NODE_ENV !== 'test') console.warn('[ml] refresh failed:', e.message);
    return { ok: false, reason: e.message };
  }
}

export const latestMl = () => latest;

/** Everything the model has predicted so far (for judging it later). */
export const predictionLog = () => q.all('SELECT location_id, for_date, issued_on, score, elevated, model_version, computed_at FROM ml_predictions ORDER BY for_date, location_id, issued_on');

let timer;
let started = false;
let running = null;
const runMl = () => (running ??= refreshMl().finally(() => { running = null; }));

/** A scheduled run waits while Open-Meteo is refusing the site's weather requests (its request would be refused too). */
function scheduledMl() {
  started = true;
  if (!openMeteoRefused()) return runMl();
  setFeed('ml_model', latest.computed_at ? 'degraded' : 'error', 'Experimental model: waiting until Open-Meteo accepts requests again', false);
}
// When weather comes back after a refusal, catch up at once instead of waiting for the next 3-hourly run.
function onWeather({ source }) {
  if (!started || source !== 'open-meteo') return;
  if (!latest.computed_at || Date.now() - Date.parse(latest.computed_at) > REFRESH_MIN * 60000) runMl();
}

export function startMlSchedule() {
  try { loadModel(); } catch (e) { setFeed('ml_model', 'not_configured', `Model file missing: ${e.message}`, false); return; }
  if (env.disableIngest) { setFeed('ml_model', 'degraded', 'Ingest disabled by DISABLE_INGEST', false); return; }
  setTimeout(scheduledMl, 5000).unref?.(); // after the seismic feed's first load
  timer = setInterval(scheduledMl, REFRESH_MIN * 60000);
  timer.unref?.();
  bus.on('weather_refreshed', onWeather);
}
export function stopMlSchedule() {
  if (timer) clearInterval(timer);
  bus.off('weather_refreshed', onWeather);
}
