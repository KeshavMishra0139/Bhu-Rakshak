// Map configuration served to the client: Bhuvan WMS layers (discovered from the official service's
// GetCapabilities, never guessed), seed historical landslide points, and place search.
import { Router } from 'express';
import { q } from '../db/index.js';
import { env } from '../config/env.js';
import { requireAuth } from '../auth/middleware.js';
import { ah, HttpError } from '../lib/util.js';
import { seismicData, intensityAt, distanceKm, RADIUS_KM } from '../ingest/seismic.js';

const REGION_POINT = { lat: 27.33, lng: 88.5 };

const r = Router();

// ---------- Place search (OpenStreetMap Nominatim) ----------
// Nominatim's free service allows at most 1 request per second from an identified application and asks
// callers to cache results, so every search goes through here: signed-in users only, cached, and throttled.
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const GEOCODE_VIEWBOX = '87.6,29.6,97.5,21.9'; // Sikkim, Darjeeling/Kalimpong and the rest of the North East (matches the map bounds)
const geocodeCache = new Map(); // query -> { at, results }
const GEOCODE_TTL_MS = 24 * 3600000;
let nextGeocodeAt = 0;

export function simplifyPlace(p) {
  const parts = String(p.display_name || '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    name: p.name || parts[0] || '',
    detail: parts.slice(1, 4).join(', '),
    lat: Number(p.lat),
    lng: Number(p.lon),
    kind: p.type || p.category || null,
  };
}

export async function geocode(query, fetchImpl = globalThis.fetch) {
  const key = query.toLowerCase();
  const hit = geocodeCache.get(key);
  if (hit && Date.now() - hit.at < GEOCODE_TTL_MS) return hit.results;
  const wait = nextGeocodeAt - Date.now();
  nextGeocodeAt = Math.max(Date.now(), nextGeocodeAt) + 1100;
  if (wait > 0) await new Promise((res) => setTimeout(res, wait));
  const params = new URLSearchParams({ format: 'jsonv2', q: query, countrycodes: 'in', viewbox: GEOCODE_VIEWBOX, bounded: '1', limit: '6', 'accept-language': 'en' });
  const res = await fetchImpl(`${NOMINATIM_URL}?${params}`, { headers: { 'User-Agent': 'Bhu-Rakshak/0.1 (SIH 2026 landslide early warning prototype)' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new HttpError(502, 'search_unavailable');
  const results = (await res.json()).map(simplifyPlace).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  geocodeCache.set(key, { at: Date.now(), results });
  if (geocodeCache.size > 500) geocodeCache.delete(geocodeCache.keys().next().value);
  return results;
}

r.get('/map/geocode', requireAuth(), ah(async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (query.length < 2 || query.length > 100) throw new HttpError(400, 'invalid_query');
  try {
    res.json({ results: await geocode(query), source: 'OpenStreetMap Nominatim' });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, 'search_unavailable');
  }
}));
// Documented on the official Bhuvan wiki ("How to use WMS services"), WMS version 1.1.1.
export const BHUVAN_WMS_URL = 'https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms';
const THEMES = [/geomorph/i, /lineament/i, /lulc|land ?use/i, /flood/i, /glacial|glof|lake/i];
let cache = { at: 0, layers: [], ok: false };

async function bhuvanLayers() {
  if (Date.now() - cache.at < 12 * 3600000) return cache;
  const url = `${BHUVAN_WMS_URL}?service=WMS&version=1.1.1&request=GetCapabilities${env.bhuvanToken ? `&token=${encodeURIComponent(env.bhuvanToken)}` : ''}`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const layers = [];
    for (const m of xml.matchAll(/<Layer[^>]*>\s*<Name>([^<]+)<\/Name>\s*<Title>([^<]*)<\/Title>/g)) {
      const [, name, title] = m;
      // Sikkim (SK) or Indian Himalayan region layers for the listed themes only.
      const regional = /(^|[:_])SK[_A-Z0-9]/.test(name) || /sikkim|himalaya|IHR/i.test(title + name);
      if (regional && THEMES.some((re) => re.test(name + ' ' + title))) layers.push({ name, title });
      if (layers.length >= 12) break;
    }
    cache = { at: Date.now(), layers, ok: true };
  } catch {
    cache = { at: Date.now() - 11 * 3600000, layers: [], ok: false }; // retry in ~1 h; the client simply hides the section
  }
  return cache;
}

r.get('/map/config', ah(async (_req, res) => {
  const b = await bhuvanLayers();
  res.json({
    bhuvan: { available: b.ok && b.layers.length > 0, url: BHUVAN_WMS_URL, version: '1.1.1', token: env.bhuvanToken || null, layers: b.layers },
  });
}));

// SEED: past-landslide points scattered deterministically around each location (count = landslide_history_count).
r.get('/map/history', (_req, res) => {
  const rows = q.all('SELECT l.id, l.lat, l.lng, s.landslide_history_count AS n, s.last_event_date FROM locations l JOIN static_layers s ON s.location_id = l.id');
  const points = [];
  for (const l of rows) {
    let h = [...l.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const rnd = () => ((h = (h * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (let k = 0; k < l.n; k++) {
      const ang = rnd() * Math.PI * 2;
      const dist = 0.005 + rnd() * 0.035;
      points.push({ location_id: l.id, lat: l.lat + Math.sin(ang) * dist, lng: l.lng + Math.cos(ang) * dist, year: 2015 + Math.floor(rnd() * 11) });
    }
  }
  res.json({ source: 'static_seed', points });
});

// Recent earthquakes near the region + NCS seismograph stations (public government data, see ingest/seismic.js).
r.get('/map/seismic', requireAuth(), (_req, res) => {
  const { quakes, stations, fetchedAt } = seismicData();
  const feed = q.one("SELECT status, message FROM feed_status WHERE feed = 'seismic'") || null;
  const now = Date.now();
  res.json({
    quakes: quakes.map((e) => ({ ...e, mmi_region: Math.round(intensityAt(e, REGION_POINT) * 10) / 10, age_hours: Math.round((now - new Date(e.time).getTime()) / 3600000) })),
    stations: stations.filter((s) => distanceKm(s, REGION_POINT) <= RADIUS_KM),
    fetched_at: fetchedAt,
    feed,
  });
});

export default r;
