// Fixed inputs for the live model at each monitored place, computed once from the SAME sources as training:
// terrain from AWS Terrain Tiles (dem.mjs) and normal monthly rain from NASA POWER climatology (0.5° cell, as in
// build_extra.mjs).   node ml/prepare_live.mjs   → ml/models/live_locations.json
import fs from 'node:fs';
import path from 'node:path';
import { ML_ROOT, getCached } from './lib.mjs';
import { terrainAt } from './dem.mjs';

const REPO = path.resolve(ML_ROOT, '..');
const { locations: core } = JSON.parse(fs.readFileSync(path.join(REPO, 'server/src/data/locations.json'), 'utf8'));
const previewFile = path.join(REPO, 'server/src/data/ner_preview.json');
const preview = fs.existsSync(previewFile) ? JSON.parse(fs.readFileSync(previewFile, 'utf8')).places.map((p) => p.location) : [];
const locations = [...core, ...preview];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const q = (o) => new URLSearchParams(o).toString();
const out = {};
for (const l of locations) {
  const t = await terrainAt(l.lat, l.lng);
  const flat = t.slope < 2;
  const cell = { lat: (Math.round(l.lat * 2) / 2).toFixed(1), lng: (Math.round(l.lng * 2) / 2).toFixed(1) };
  const c = (await getCached(`https://power.larc.nasa.gov/api/temporal/climatology/point?${q({ parameters: 'PRECTOTCORR', community: 'AG', longitude: cell.lng, latitude: cell.lat, format: 'JSON' })}`)).properties.parameter.PRECTOTCORR;
  out[l.id] = {
    lat: l.lat, lng: l.lng,
    terrain: { elev_m: t.elev, slope_deg: +t.slope.toFixed(3), northness: flat ? 0 : +Math.cos((t.aspect * Math.PI) / 180).toFixed(3), eastness: flat ? 0 : +Math.sin((t.aspect * Math.PI) / 180).toFixed(3), curvature: +t.curvature.toFixed(3), relief_1km: t.relief },
    clim_month_mm_day: MONTHS.map((m) => c[m]), clim_annual_mm_day: c.ANN,
  };
  console.log(l.id.padEnd(12), JSON.stringify(out[l.id].terrain), 'normal Sep', c.SEP, 'mm/day');
}
fs.writeFileSync(path.join(ML_ROOT, 'models', 'live_locations.json'), JSON.stringify({ built_at: new Date().toISOString(), sources: ['AWS Terrain Tiles (SRTM)', 'NASA POWER climatology'], locations: out }, null, 2));
