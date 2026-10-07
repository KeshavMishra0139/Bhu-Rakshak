// Red zones and relocation (PS SIH26191): what is exposed at every monitored place, for the officer "Red zones" page.
// The zone itself comes from the live risk level (client side, same stream as the map); this adds the exposure:
// buildings, schools and health facilities mapped in OpenStreetMap within 1 km (real, but OSM coverage in the hills is
// incomplete), plus the seed population estimate and seed slope, each flagged so the page can label them honestly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { requireAuth, requireCap } from '../auth/middleware.js';
import { seedData } from '../config/shared.js';
import { q } from '../db/index.js';

const r = Router();
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../data/exposure_osm.json');

export function exposureAll() {
  let osm = null;
  try { osm = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* no OSM extract: OSM fields stay null */ }
  const places = {};
  for (const { id } of q.all('SELECT id FROM locations ORDER BY id')) {
    const o = osm?.places?.[id];
    places[id] = {
      osm: o ? { buildings: o.buildings, schools: o.schools, health: o.health, hospitals: o.hospitals, road_km: o.road_km } : null,
      // Seed placeholders (not measured): labelled "rough estimate" / "sample" on the page.
      population_estimate: seedData.exposure?.exposure?.[id]?.population ?? null,
      slope_deg_sample: seedData.staticLayers?.layers?.[id]?.slope_deg ?? null,
    };
  }
  return {
    osm: osm ? { radius_km: osm.radius_km, generated_at: osm.generated_at } : null,
    places,
  };
}

r.get('/zones/exposure', requireAuth(), requireCap('incidents.view'), (_req, res) => res.json(exposureAll()));

export default r;
