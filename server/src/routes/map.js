// Map configuration served to the client: Bhuvan WMS layers (discovered from the official service's
// GetCapabilities, never guessed), and seed historical landslide points.
import { Router } from 'express';
import { q } from '../db/index.js';
import { env } from '../config/env.js';
import { ah } from '../lib/util.js';

const r = Router();
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

export default r;
