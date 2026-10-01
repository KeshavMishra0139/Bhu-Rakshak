// Road corridor checker: a driving route between two points (OSRM on OpenStreetMap roads), cut into ~2 km
// segments, each linked to the nearest monitored place within 15 km (the browser colours it by that place's live
// risk). When the route crosses high-risk places, /corridor/alternative looks for a lower-risk way round: OSRM's own
// alternatives, the officers' diversion notes on the affected road segments ("Via A – B – C"), then detours either
// side of the risky stretch. The public OSRM server allows about one request a second, so calls are spaced and cached.
import { Router } from 'express';
import { q } from '../db/index.js';
import { requireAuth } from '../auth/middleware.js';
import { ah, HttpError, safeJson } from '../lib/util.js';
import { geocode } from './map.js';

export const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';
export const SEGMENT_KM = 2;
export const MONITOR_KM = 8; // about half the spacing between monitored places; a point's rating says little about a hillside farther away
const BOX = { minLat: 21, maxLat: 30.5, minLng: 85, maxLng: 98 };
const UA = 'Bhu-Rakshak/0.1 (SIH 2026 landslide early warning prototype)';
const HIGH = new Set(['high', 'critical']);

const r = Router();
r.use('/corridor', requireAuth());

const toRad = Math.PI / 180;
export const km = (a, b) => {
  const x = (b[1] - a[1]) * toRad * Math.cos(((a[0] + b[0]) / 2) * toRad); const y = (b[0] - a[0]) * toRad;
  return 6371 * Math.sqrt(x * x + y * y);
};

// ---------- OSRM ----------
let nextAt = 0;
const cache = new Map(); // url -> { at, routes }
const TTL_MS = 6 * 3600000;
export async function osrm(points, { alternatives = false, fetchImpl = globalThis.fetch } = {}) {
  const coords = points.map(([lat, lng]) => `${lng.toFixed(5)},${lat.toFixed(5)}`).join(';');
  const url = `${OSRM_URL}/${coords}?overview=full&geometries=geojson&steps=false&alternatives=${alternatives ? 3 : 'false'}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.routes;
  const wait = nextAt - Date.now();
  nextAt = Math.max(Date.now(), nextAt) + 1100;
  if (wait > 0) await new Promise((res) => setTimeout(res, wait));
  let res;
  try { res = await fetchImpl(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) }); } catch { throw new HttpError(502, 'routing_unavailable'); }
  if (!res.ok && res.status !== 400) throw new HttpError(502, 'routing_unavailable');
  const j = await res.json().catch(() => ({}));
  if (j.code === 'NoRoute' || j.code === 'NoSegment') return [];
  if (j.code !== 'Ok') throw new HttpError(502, 'routing_unavailable');
  const routes = j.routes.map((x) => ({
    coords: x.geometry.coordinates.map(([lng, lat]) => [+lat.toFixed(5), +lng.toFixed(5)]),
    distance_m: Math.round(x.distance), duration_s: Math.round(x.duration),
  }));
  cache.set(url, { at: Date.now(), routes });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return routes;
}

// ---------- Segments ----------
const places = () => q.all('SELECT l.id, l.lat, l.lng, r.level FROM locations l LEFT JOIN risk_state r ON r.location_id = l.id');

/** Cut a polyline into pieces of about `segKm`, each tied to the nearest monitored place within MONITOR_KM. */
export function splitRoute(coords, pl, segKm = SEGMENT_KM) {
  const total = coords.slice(1).reduce((s, p, i) => s + km(coords[i], p), 0);
  const n = Math.max(1, Math.round(total / segKm));
  const target = total / n;
  const segs = [];
  let cur = [coords[0]]; let len = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = km(coords[i - 1], coords[i]);
    cur.push(coords[i]); len += d;
    if (len >= target && segs.length < n - 1) { segs.push({ coords: cur, km: len }); cur = [coords[i]]; len = 0; }
  }
  if (cur.length > 1 || !segs.length) segs.push({ coords: cur, km: len });
  return segs.map((s) => {
    const mid = s.coords[Math.floor(s.coords.length / 2)];
    let best = null; let bd = Infinity;
    for (const p of pl) { const d = km(mid, [p.lat, p.lng]); if (d < bd) { bd = d; best = p; } }
    const near = best && bd <= MONITOR_KM;
    return { coords: s.coords, km: +s.km.toFixed(2), place_id: near ? best.id : null, place_km: near ? +bd.toFixed(1) : null };
  });
}

const highCount = (segs, levels) => segs.filter((s) => s.place_id && HIGH.has(levels[s.place_id])).length;

function parsePoint(v) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(v || ''));
  if (!m) throw new HttpError(400, 'invalid_point');
  const p = [Number(m[1]), Number(m[2])];
  if (p[0] < BOX.minLat || p[0] > BOX.maxLat || p[1] < BOX.minLng || p[1] > BOX.maxLng) throw new HttpError(400, 'outside_region');
  return p;
}
function endpoints(req) {
  const from = parsePoint(req.query.from); const to = parsePoint(req.query.to);
  if (km(from, to) < 0.3) throw new HttpError(400, 'points_too_close');
  if (km(from, to) > 600) throw new HttpError(400, 'points_too_far');
  return { from, to };
}
const shape = (route, segs, kind, via = null) => ({ kind, via, distance_m: route.distance_m, duration_s: route.duration_s, segments: segs });
const SOURCE = { routing: 'OSRM (OpenStreetMap roads)', segment_km: SEGMENT_KM, monitor_km: MONITOR_KM };

r.get('/corridor/route', ah(async (req, res) => {
  const { from, to } = endpoints(req);
  const routes = await osrm([from, to], { alternatives: true });
  if (!routes.length) throw new HttpError(404, 'no_route');
  const pl = places();
  res.json({ routes: routes.map((x, i) => shape(x, splitRoute(x.coords, pl), i === 0 ? 'main' : 'osrm_alternative')), source: SOURCE });
}));

/** "Via Lava – Algarah – Pedong (NH-717A)" → ["Lava", "Algarah", "Pedong"] (same rule as the citizen roads page). */
export function diversionPlaces(text) {
  const m = /^\s*via\s+(.+?)\s*(\(.*\))?\s*\.?\s*$/i.exec(text || '');
  if (!m) return [];
  return m[1].split(/\s*(?:–|—|-|,|→|>)\s*/).map((s) => s.trim()).filter((s) => s.length > 1);
}

/** Detour points either side of the risky stretch, perpendicular to the overall direction of travel. */
function sidePoints(from, to, centre, distancesKm) {
  const dy = to[0] - from[0]; const dx = (to[1] - from[1]) * Math.cos(centre[0] * toRad);
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len; const ny = dx / len; // unit normal (east, north) in km-ish space
  return distancesKm.flatMap((d) => [1, -1].map((s) => [centre[0] + (s * ny * d) / 111, centre[1] + (s * nx * d) / (111 * Math.cos(centre[0] * toRad))]))
    .filter((p) => p[0] >= BOX.minLat && p[0] <= BOX.maxLat && p[1] >= BOX.minLng && p[1] <= BOX.maxLng);
}

const altCache = new Map(); // key -> { at, body }
r.get('/corridor/alternative', ah(async (req, res) => {
  const { from, to } = endpoints(req);
  const key = `${from.map((x) => x.toFixed(3))}|${to.map((x) => x.toFixed(3))}`;
  const hit = altCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60000) return res.json(hit.body);

  const pl = places();
  const levels = Object.fromEntries(pl.map((p) => [p.id, p.level]));
  const routes = await osrm([from, to], { alternatives: true });
  if (!routes.length) throw new HttpError(404, 'no_route');
  const main = { route: routes[0], segs: splitRoute(routes[0].coords, pl) };
  const mainHigh = highCount(main.segs, levels);
  const tried = [];
  const consider = (route, kind, via) => {
    const segs = splitRoute(route.coords, pl);
    tried.push({ route, segs, kind, via, high: highCount(segs, levels) });
  };
  for (const x of routes.slice(1)) consider(x, 'osrm_alternative', null);

  const better = () => tried.some((c) => c.high < mainHigh && c.route.distance_m <= 2.5 * main.route.distance_m);
  if (mainHigh > 0 && !better()) {
    // 1. Officers' diversion notes on monitored roads through the high-risk places on this route.
    const riskyIds = new Set(main.segs.filter((s) => s.place_id && HIGH.has(levels[s.place_id])).map((s) => s.place_id));
    const roads = q.all('SELECT id, diversion_en, path_json FROM roads').filter((x) => safeJson(x.path_json, []).some((id) => riskyIds.has(id)));
    for (const road of roads) {
      const names = diversionPlaces(road.diversion_en).slice(0, 4);
      if (!names.length) continue;
      const pts = [];
      for (const n of names) {
        const g = (await geocode(n).catch(() => []))[0];
        if (g) pts.push([g.lat, g.lng]);
      }
      if (!pts.length) continue;
      // Notes may be written from either end of the road: visit the places in order of distance from the start.
      pts.sort((x, y) => km(from, x) - km(from, y));
      const alt = (await osrm([from, ...pts, to]).catch(() => []))[0];
      if (alt) consider(alt, 'diversion', names.join(' – '));
      if (better()) break;
    }
    // 2. Detours either side of the risky stretch.
    if (!better()) {
      const risky = main.segs.filter((s) => s.place_id && HIGH.has(levels[s.place_id]));
      const mids = risky.map((s) => s.coords[Math.floor(s.coords.length / 2)]);
      const centre = [mids.reduce((a, p) => a + p[0], 0) / mids.length, mids.reduce((a, p) => a + p[1], 0) / mids.length];
      for (const p of sidePoints(from, to, centre, [20, 40])) {
        const alt = (await osrm([from, p, to]).catch(() => []))[0];
        if (alt) consider(alt, 'detour', null);
        if (better()) break;
      }
    }
  }
  const best = tried.filter((c) => c.high < mainHigh && c.route.distance_m <= 2.5 * main.route.distance_m)
    .sort((a, b) => a.high - b.high || a.route.distance_m - b.route.distance_m)[0];
  const body = {
    main_high: mainHigh,
    alternative: best ? shape(best.route, best.segs, best.kind, best.via) : null,
    tried: tried.length,
    source: SOURCE,
  };
  altCache.set(key, { at: Date.now(), body });
  if (altCache.size > 200) altCache.delete(altCache.keys().next().value);
  res.json(body);
}));

export default r;
