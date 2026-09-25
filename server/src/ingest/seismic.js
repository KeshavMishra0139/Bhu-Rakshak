// Seismic + ground-motion sensor ingestion (backend only), from free public government sources:
//  • National Center for Seismology (NCS, Ministry of Earth Sciences) — riseq.seismo.gov.in. Its earthquake page
//    embeds two GeoJSON collections: recent earthquakes across India and the neighbourhood, and the national
//    seismograph network (ground-motion sensors). We read both.
//  • USGS FDSN event service (earthquake.usgs.gov) — backup and cross-check for events NCS lists late or not at all.
// Earthquakes weaken slopes: strong shaking can trigger landslides directly and leaves cracked ground that fails in
// the next heavy rain. We estimate shaking intensity at each monitored slope from magnitude, depth and distance.
import { q, tx } from '../db/index.js';
import { env } from '../config/env.js';
import { nowIso, safeJson, clamp } from '../lib/util.js';
import { bus } from '../events/bus.js';
import { setFeed } from './openMeteo.js';

export const NCS_URL = 'https://riseq.seismo.gov.in/riseq/earthquake';
export const USGS_URL = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
const UA = 'Bhu-Rakshak/0.1 (SIH 2026 landslide early warning prototype)';
const REGION = { lat: 27.3, lng: 88.5 }; // Sikkim + Darjeeling hills
export const RADIUS_KM = 500;
export const WINDOW_DAYS = 30;
const IST_MS = 5.5 * 3600000;
const DAY_MS = 86400000;

export function distanceKm(a, b) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Every `"features": [ ... ]` array in a page, read to its matching bracket (the NCS page has JS comments after them). */
export function featureArrays(text) {
  const out = [];
  let from = 0;
  for (;;) {
    const i = text.indexOf('"features"', from);
    if (i < 0) break;
    const start = text.indexOf('[', i);
    if (start < 0) break;
    let depth = 0;
    let inStr = false;
    let end = -1;
    for (let k = start; k < text.length; k++) {
      const ch = text[k];
      if (inStr) {
        if (ch === '\\') k++;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '[') depth++;
      else if (ch === ']' && --depth === 0) { end = k; break; }
    }
    if (end < 0) break;
    const arr = safeJson(text.slice(start, end + 1), null);
    if (Array.isArray(arr)) out.push(arr);
    from = end + 1;
  }
  return out;
}

/** NCS page → { quakes, stations }. NCS lists times in IST. */
export function parseNcsPage(html) {
  const quakes = [];
  const stations = [];
  for (const arr of featureArrays(html)) {
    for (const f of arr) {
      const p = f?.properties || {};
      const [lng, lat] = (f?.geometry?.coordinates || []).map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (p.magnitude != null) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(p.date || ''));
        const t = /^(\d{1,2}):(\d{2}):?(\d{2})?/.exec(String(p.time || ''));
        if (!m || !t) continue;
        const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2], +(t[3] || 0)) - IST_MS;
        quakes.push({ id: `ncs-${p.ID ?? ms}`, source: 'NCS', time: new Date(ms).toISOString(), mag: Number(p.magnitude), depth_km: Number(p.depth) || 10, lat, lng, place: null });
      } else if (p.station) {
        const code = /\[\s*([^\]]+?)\s*\]/.exec(p.station)?.[1] || String(p.station).trim();
        const name = String(p.station).replace(/\[.*\]/, '').trim();
        stations.push({ code, name, state: p.state || null, lat, lng });
      }
    }
  }
  return { quakes, stations };
}

/** USGS FDSN GeoJSON → quakes. */
export function parseUsgs(body) {
  return (body?.features || []).map((f) => {
    const [lng, lat, depth] = f.geometry?.coordinates || [];
    return { id: `usgs-${f.id}`, source: 'USGS', time: new Date(f.properties.time).toISOString(), mag: Number(f.properties.mag), depth_km: Number(depth) || 10, lat, lng, place: f.properties.place || null };
  }).filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.mag));
}

/** NCS first; add USGS events NCS doesn't have (same quake = within 90 s and 80 km). Region + time window only. */
export function mergeQuakes(ncs, usgs, nowMs = Date.now()) {
  const keep = (e) => distanceKm(REGION, e) <= RADIUS_KM && nowMs - new Date(e.time).getTime() <= WINDOW_DAYS * DAY_MS;
  const out = ncs.filter(keep);
  for (const u of usgs.filter(keep)) {
    const dup = out.some((n) => Math.abs(new Date(n.time) - new Date(u.time)) < 90000 && distanceKm(n, u) < 80);
    if (!dup) out.push(u);
  }
  return out.sort((a, b) => b.time.localeCompare(a.time));
}

/**
 * Estimated shaking intensity (Modified Mercalli, I–X) at a point: a simple magnitude–hypocentral-distance relation
 * (I ≈ 1.5·M − 3.5·log10 R + 3). Coarse, but enough to tell "felt far away" from "strong shaking on this slope".
 */
export function intensityAt(e, point) {
  const r = Math.max(10, Math.hypot(distanceKm(e, point), e.depth_km || 10));
  return clamp(1.5 * e.mag - 3.5 * Math.log10(r) + 3, 1, 12);
}

/** Landslide-relevant shaking 0..1: nothing below intensity IV, full at VII (damaging); fades with a ~7-day half-life. */
export const shakingSeverity = (mmi) => clamp((mmi - 4) / 3, 0, 1);
const HALF_LIFE_DAYS = 7;

// ---------- In-memory view (read on every risk tick) ----------
const cache = { quakes: [], stations: [], fetchedAt: null };

export function loadSeismicCache() {
  for (const r of q.all('SELECT kind, data_json, fetched_at FROM seismic_cache')) {
    cache[r.kind] = safeJson(r.data_json, []);
    if (r.kind === 'quakes') cache.fetchedAt = r.fetched_at;
  }
}
/** Test hook. */
export function setSeismicCache({ quakes = [], stations = [] }, fetchedAt = nowIso()) {
  Object.assign(cache, { quakes, stations, fetchedAt });
}
export const seismicData = () => ({ ...cache });

/** Strongest recent shaking at a point, or null when nothing relevant has happened. */
export function strongestShaking(point, atMs) {
  let best = null;
  for (const e of cache.quakes) {
    const ageDays = (atMs - new Date(e.time).getTime()) / DAY_MS;
    if (ageDays < 0 || ageDays > WINDOW_DAYS) continue;
    const mmi = intensityAt(e, point);
    const severity = shakingSeverity(mmi) * Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    if (!best || severity > best.severity || (severity === best.severity && mmi > best.mmi)) best = { e, mmi, severity };
  }
  return best;
}

/** Engine input: 0..1 (0 when quiet). */
export function seismicSeverity(point, atMs) {
  if (!point || point.lat == null) return 0;
  return strongestShaking(point, atMs)?.severity || 0;
}

/** What officers see in the station drawer. */
export function seismicSummary(point, atMs) {
  if (!point || point.lat == null || !cache.fetchedAt) return null;
  const recent = cache.quakes.filter((e) => atMs - new Date(e.time).getTime() <= 7 * DAY_MS);
  const best = strongestShaking(point, atMs);
  const nearest = cache.stations
    .map((s) => ({ ...s, km: distanceKm(s, point) }))
    .sort((a, b) => a.km - b.km)[0] || null;
  const ev = best?.e;
  return {
    events_7d: recent.length,
    strongest: ev ? {
      mag: ev.mag, time: ev.time, depth_km: ev.depth_km, source: ev.source, place: ev.place,
      distance_km: Math.round(distanceKm(ev, point)), mmi: Math.round(best.mmi * 10) / 10, severity: Math.round(best.severity * 100) / 100,
    } : null,
    nearest_station: nearest ? { code: nearest.code, name: nearest.name, distance_km: Math.round(nearest.km) } : null,
    fetched_at: cache.fetchedAt,
    source: 'NCS / USGS',
  };
}

// ---------- Fetch ----------
async function get(url, fetchImpl, timeoutMs, accept) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function refreshSeismic({ fetchImpl = globalThis.fetch, timeoutMs = 25000, nowMs = Date.now() } = {}) {
  const start = new Date(nowMs - WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const usgsUrl = `${USGS_URL}?${new URLSearchParams({ format: 'geojson', latitude: REGION.lat, longitude: REGION.lng, maxradiuskm: RADIUS_KM, minmagnitude: '2.5', starttime: start, orderby: 'time' })}`;
  const [ncsR, usgsR] = await Promise.allSettled([
    get(NCS_URL, fetchImpl, timeoutMs, 'text/html').then(parseNcsPage),
    get(usgsUrl, fetchImpl, timeoutMs, 'application/json').then((t) => parseUsgs(safeJson(t, {}))),
  ]);
  const ncs = ncsR.status === 'fulfilled' ? ncsR.value : null;
  const usgs = usgsR.status === 'fulfilled' ? usgsR.value : null;
  const ncsOk = ncs && ncs.quakes.length > 0;
  const errMsg = (r) => (r.reason?.name === 'TimeoutError' ? 'timeout' : r.reason?.message);

  if (!ncsOk && !usgs) {
    const msg = `NCS: ${ncsR.status === 'rejected' ? errMsg(ncsR) : 'no events in page'}; USGS: ${errMsg(usgsR)}`;
    const cached = cache.quakes.length > 0;
    setFeed('seismic', cached ? 'degraded' : 'error', cached ? `Serving last earthquake data (${msg})` : msg, false);
    if (process.env.NODE_ENV !== 'test') console.warn(`[seismic] refresh failed: ${msg}`);
    return { ok: false, reason: msg };
  }

  const quakes = mergeQuakes(ncsOk ? ncs.quakes : [], usgs || [], nowMs);
  const stations = ncs?.stations?.length ? ncs.stations : cache.stations;
  const fetchedAt = new Date(nowMs).toISOString();
  tx(() => {
    for (const [kind, data] of [['quakes', quakes], ['stations', stations]]) {
      q.run(`INSERT INTO seismic_cache(kind, data_json, fetched_at) VALUES (:k, :j, :at)
             ON CONFLICT(kind) DO UPDATE SET data_json = excluded.data_json, fetched_at = excluded.fetched_at`,
      { k: kind, j: JSON.stringify(data), at: fetchedAt });
    }
  });
  setSeismicCache({ quakes, stations }, fetchedAt);

  const sources = [ncsOk && 'NCS', usgs && 'USGS'].filter(Boolean).join(' + ');
  const missing = !ncsOk ? ' (NCS unavailable, USGS only)' : !usgs ? ' (USGS cross-check unavailable)' : '';
  setFeed('seismic', missing ? 'degraded' : 'ok', `${quakes.length} earthquakes within ${RADIUS_KM} km in ${WINDOW_DAYS} days · ${sources}${missing}`, true);
  if (stations.length) {
    const near = stations.filter((s) => distanceKm(s, REGION) <= 150).map((s) => s.name);
    setFeed('sensors', 'ok', `NCS seismograph network: ${stations.length} stations, ${near.length} within 150 km (${near.join(', ')}). Slope sensors (piezometer, tilt) not yet installed.`, true);
  }
  bus.emit('weather_refreshed', { at: fetchedAt, source: 'seismic' }); // re-score now that shaking inputs changed
  return { ok: true, quakes: quakes.length, stations: stations.length };
}

let intervalHandle;
export async function startSeismicSchedule() {
  loadSeismicCache();
  if (env.disableIngest) {
    if (!cache.fetchedAt) setFeed('seismic', 'degraded', 'Ingest disabled by DISABLE_INGEST', false);
    return;
  }
  refreshSeismic();
  intervalHandle = setInterval(() => refreshSeismic(), 15 * 60000);
  intervalHandle.unref?.();
}
export function stopSeismicSchedule() {
  if (intervalHandle) clearInterval(intervalHandle);
}
