// Step 1b-2: road-matched comparison points — the main guard against news-reporting bias.
//   node ml/build_controls.mjs      → ml/data/controls.csv
//
// Why: the landslide inventory comes from news reports, and news reports landslides that block roads or hit
// towns. If the "no landslide" spots are random hillside, a model can score well just by learning "near a road
// ⇒ landslide" — a fact about news coverage, not about slopes.
//
// Fix: for every landslide, pick one spot 8–40 km away on the SAME DATE at (about) the SAME DISTANCE FROM A MAJOR
// ROAD as the landslide, with no landslide reported within 10 km / 7 days (any country, any record). Road access
// is then the same on both sides, so the model has to find real differences (slope, rain, soil…).
import fs from 'node:fs';
import path from 'node:path';
import { DATA, mapLimit, parseCsv, writeCsv, rng, distanceKm, dayDiff } from './lib.mjs';
import { roadsRiversNear, nearestM } from './osm.mjs';
import { weather, power, terrain, quakeCatalogue, shaking, COLUMNS, round3 } from './features.mjs';

const inventory = parseCsv(fs.readFileSync(path.join(DATA, 'inventory.csv'), 'utf8')).map((e) => ({ ...e, lat: +e.lat, lng: +e.lng, accuracy_km: +e.accuracy_km }));
const reported = parseCsv(fs.readFileSync(path.join(DATA, 'all_reported.csv'), 'utf8')).map((e) => ({ ...e, lat: +e.lat, lng: +e.lng }));
const rand = rng(4242);
async function control(e) {
  // Major roads within ~45 km (same road classes as dist_road_m), from the cached OSM tiles.
  const { roads } = await roadsRiversNear(e, 0.42);
  if (!roads.length) return { reason: 'no major roads within 45 km' };
  const CAP = 20000;
  const target = nearestM(e, roads, CAP); // landslide's distance to the nearest major road (m)
  if (target >= CAP) return { reason: 'landslide > 20 km from any major road', target };
  const tol = Math.max(75, target * 0.3);
  const vertices = roads.flatMap((g) => g.map(([lat, lng]) => ({ lat, lng }))).filter((v) => { const km = distanceKm(v, e); return km >= 8 && km <= 40; });
  if (!vertices.length) return { reason: 'no roads 8–40 km away', target };
  for (let k = 0; k < 400; k++) {
    const v = vertices[Math.floor(rand() * vertices.length)];
    const bearing = rand() * 2 * Math.PI;
    const off = target * (0.8 + 0.4 * rand());
    const pt = { lat: v.lat + (off / 110574) * Math.cos(bearing), lng: v.lng + (off / (111320 * Math.cos((v.lat * Math.PI) / 180))) * Math.sin(bearing) };
    const km = distanceKm(pt, e);
    if (km < 8 || km > 40) continue;
    const dist = nearestM(pt, roads, CAP);
    if (Math.abs(dist - target) > tol) continue;
    if (reported.some((r) => Math.abs(dayDiff(r.date, e.date)) <= 7 && distanceKm(r, pt) <= 10)) continue;
    return { lat: +pt.lat.toFixed(4), lng: +pt.lng.toFixed(4), road_m_event: target, road_m_control: dist };
  }
  return { reason: 'no matching spot found', target };
}

const progress = (label) => (d, n) => { if (d % 50 === 0 || d === n) console.log(`  ${label} ${d}/${n}`); };
const failures = [];
const safe = (label, fn) => async (s, i) => { try { return await fn(s, i); } catch (err) { failures.push({ step: label, event_id: s.event_id, error: err.message.slice(0, 160) }); return null; } };

console.log(`road-matched spots for ${inventory.length} landslides…`);
const picks = await mapLimit(inventory, 2, safe('roads', control), progress('roads'));
const samples = [];
inventory.forEach((e, i) => {
  const c = picks[i];
  if (c?.lat != null) samples.push({ event_id: e.event_id, state: e.state, accuracy_km: e.accuracy_km, label: 0, sample_type: 'roadside_same_date', date: e.date, lat: c.lat, lng: c.lng, _match: c });
  else failures.push({ step: 'match', event_id: e.event_id, error: c?.reason || 'lookup failed' });
});
console.log(`matched ${samples.length}/${inventory.length}; computing factors…`);

const quakes = await quakeCatalogue();
const terr = await mapLimit(samples, 4, safe('terrain', terrain), progress('terrain'));
const wx = await mapLimit(samples, 4, safe('weather', weather), progress('weather'));
const pw = await mapLimit(samples, 3, safe('power', power), progress('power'));
const rows = samples.map((s, i) => ({ ...s, month: Number(s.date.slice(5, 7)), ...(wx[i] || {}), ...(pw[i] || {}), ...(terr[i] || {}), ...shaking(s, quakes) }));
writeCsv(path.join(DATA, 'controls.csv'), rows.map((r) => Object.fromEntries(COLUMNS.map((c) => [c, round3(r[c])]))), COLUMNS);

const med = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v[Math.floor(v.length / 2)]; };
const summary = {
  matched: samples.length, of: inventory.length,
  median_road_distance_m: { landslides: Math.round(med(samples.map((s) => s._match.road_m_event))), matched_spots: Math.round(med(samples.map((s) => s._match.road_m_control))) },
  failures: failures.length,
};
fs.writeFileSync(path.join(DATA, 'controls_log.json'), JSON.stringify({ built_at: new Date().toISOString(), summary, failures }, null, 2));
console.log(JSON.stringify(summary));
