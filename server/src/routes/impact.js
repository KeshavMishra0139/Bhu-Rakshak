// What is exposed around a monitored place, for the "Why" card: buildings, schools, health facilities and roads
// mapped in OpenStreetMap within 1 km (server/src/data/exposure_osm.json, built by ml/build_exposure_osm.mjs), plus
// the monitored road segments through the place and their current status. Public: OSM data is open.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { q } from '../db/index.js';
import { HttpError } from '../lib/util.js';

const r = Router();
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../data/exposure_osm.json');
let cache = null;
let cacheMtime = 0;
function osm() {
  try {
    const m = fs.statSync(FILE).mtimeMs;
    if (!cache || m !== cacheMtime) { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); cacheMtime = m; }
  } catch { cache = null; }
  return cache;
}

export function impactFor(id) {
  const loc = q.one('SELECT id FROM locations WHERE id = :id', { id });
  if (!loc) return null;
  const data = osm();
  const segments = q.all('SELECT r.id, r.name_en, r.name_hi, r.status, r.diversion_en, r.diversion_hi, r.eta_clear_hours FROM roads r, json_each(r.path_json) p WHERE p.value = :id ORDER BY r.name_en', { id });
  return {
    location_id: id,
    radius_km: data?.radius_km ?? null,
    osm: data?.places?.[id] ?? null,
    segments,
    source: data ? { name: 'OpenStreetMap', generated_at: data.generated_at, extracts: data.sources } : null,
  };
}

r.get('/impact/:id', (req, res) => {
  const out = impactFor(req.params.id);
  if (!out) throw new HttpError(404, 'location_not_found');
  res.json(out);
});

export default r;
