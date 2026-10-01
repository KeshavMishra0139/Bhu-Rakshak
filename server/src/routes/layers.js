// Regional map layers. /layers/rain: cumulative rainfall over the last 3, 7 and 15 days on a 0.5° grid (~50 km)
// covering Sikkim, Darjeeling and the North East, from Open-Meteo daily totals (model data, not rain gauges).
// Refreshed at most every 3 hours, in a few batched requests, and kept in memory.
import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { ah, HttpError } from '../lib/util.js';

export const RAIN_URL = 'https://api.open-meteo.com/v1/forecast';
export const GRID = { minLat: 22, maxLat: 29.5, minLng: 88, maxLng: 97.5, step: 0.5 };
const TTL_MS = 3 * 3600000;
const BATCH = 100;

const r = Router();
let cache = null; // { fetched_at, through, cells: [[lat, lng, r3, r7, r15], …] }
let inflight = null;

export function gridPoints(g = GRID) {
  const pts = [];
  for (let lat = g.minLat; lat <= g.maxLat + 1e-9; lat += g.step) {
    for (let lng = g.minLng; lng <= g.maxLng + 1e-9; lng += g.step) pts.push([+lat.toFixed(2), +lng.toFixed(2)]);
  }
  return pts;
}

/** Sums of the last 3, 7 and 15 daily totals up to and including `through` (today, partly elapsed). */
export function windowSums(time, values, through) {
  let end = time.indexOf(through);
  if (end < 0) end = time.length - 1;
  const sum = (n) => {
    let s = 0;
    for (let k = Math.max(0, end - n + 1); k <= end; k++) s += values[k] || 0;
    return Math.round(s * 10) / 10;
  };
  return [sum(3), sum(7), sum(15)];
}

const todayIST = (ms = Date.now()) => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);

export async function refreshRain({ fetchImpl = globalThis.fetch, nowMs = Date.now() } = {}) {
  const pts = gridPoints();
  const through = todayIST(nowMs);
  const cells = [];
  for (let i = 0; i < pts.length; i += BATCH) {
    const batch = pts.slice(i, i + BATCH);
    const params = new URLSearchParams({
      latitude: batch.map((p) => p[0]).join(','), longitude: batch.map((p) => p[1]).join(','),
      daily: 'precipitation_sum', past_days: '15', forecast_days: '1', timezone: 'Asia/Kolkata',
    });
    const res = await fetchImpl(`${RAIN_URL}?${params}`, { headers: { 'User-Agent': 'Bhu-Rakshak/0.1 (SIH 2026 prototype)' }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new HttpError(502, 'layer_unavailable');
    const body = await res.json();
    const list = Array.isArray(body) ? body : [body];
    list.forEach((loc, k) => {
      const d = loc?.daily;
      if (!d?.time) return;
      cells.push([batch[k][0], batch[k][1], ...windowSums(d.time, d.precipitation_sum, through)]);
    });
  }
  cache = { fetched_at: new Date(nowMs).toISOString(), through, cells };
  return cache;
}

r.get('/layers/rain', requireAuth(), ah(async (_req, res) => {
  const stale = !cache || Date.now() - new Date(cache.fetched_at).getTime() > TTL_MS;
  if (stale) {
    inflight ??= refreshRain().finally(() => { inflight = null; });
    if (!cache) {
      try { await inflight; } catch { throw new HttpError(502, 'layer_unavailable'); }
    } else inflight.catch(() => {}); // serve the old grid while refreshing
  }
  res.json({ ...cache, step: GRID.step, source: 'Open-Meteo daily precipitation (model)', windows_days: [3, 7, 15] });
}));

export default r;
