// Step 1b: training dataset — landslide events and non-events with trigger AND terrain factors.
//   node ml/build_inventory.mjs && node ml/build_dataset.mjs
//
// Samples (label):
//   1  event                  a landslide from ml/data/inventory.csv, on its reported date
//   0  same_place_other_date  the same spot on 2 dates with no reported landslide nearby (teaches WHEN)
//   0  nearby_place_same_date a spot 8–40 km away on the same date with no reported landslide nearby (teaches WHERE)
//
// Factors per sample (see ml/README.md for the full data dictionary):
//   rain (two independent sources), antecedent wetness, soil moisture at three depths, temperature and snow,
//   earthquake shaking in the previous 30 days, and terrain (elevation, slope, aspect, curvature, local relief).
//
// All sources are free and keyless: Open-Meteo historical weather (ERA5 reanalysis; forecast archive for the last
// few days), NASA POWER (MERRA-2 based), USGS earthquake catalogue, AWS Terrain Tiles (NASA SRTM ~30 m).
// Every response is cached in ml/data/cache, so re-runs are quick and can resume after a failure.
import path from 'node:path';
import fs from 'node:fs';
import { DATA, mapLimit, parseCsv, writeCsv, rng, distanceKm, addDays, dayDiff } from './lib.mjs';
import { weather, power, terrain, quakeCatalogue, shaking, COLUMNS } from './features.mjs';

const TODAY = new Date().toISOString().slice(0, 10);
const inventory = parseCsv(fs.readFileSync(path.join(DATA, 'inventory.csv'), 'utf8'))
  .map((e) => ({ ...e, lat: +e.lat, lng: +e.lng, accuracy_km: +e.accuracy_km }));
// Seeded randomness. Landslides recorded on the website (ids 'rec-…') get their own seed, so adding new records
// never reshuffles the samples of the existing ones (their data stays cached and comparable across retrains).
const globalRand = rng(2026);
const seedOf = (id) => [...id].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
let rand = globalRand;

// ---------- 1. Samples ----------
/** Is there a reported landslide within `km` and `days` of this point/date? */
const nearEvent = (p, date, km, days) => inventory.some((e) => Math.abs(dayDiff(e.date, date)) <= days && distanceKm(e, p) <= km);
const firstYear = 2007;
const lastYear = Number(TODAY.slice(0, 4));

function otherDate(e) {
  // Same season (±45 days of the event's day-of-year) in another year, so the model can't just learn "it's monsoon".
  for (let k = 0; k < 50; k++) {
    const year = firstYear + Math.floor(rand() * (lastYear - firstYear + 1));
    const shift = Math.round((rand() * 2 - 1) * 45);
    const d = addDays(`${year}${e.date.slice(4)}`, shift);
    if (d >= TODAY || dayDiff(TODAY, d) < 3) continue;
    if (Math.abs(dayDiff(d, e.date)) < 30) continue;
    if (!nearEvent(e, d, 10, 10)) return d;
  }
  return null;
}
function nearbyPlace(e) {
  for (let k = 0; k < 50; k++) {
    const km = 8 + rand() * 32;
    const bearing = rand() * 2 * Math.PI;
    const p = { lat: e.lat + (km / 111) * Math.cos(bearing), lng: e.lng + (km / (111 * Math.cos((e.lat * Math.PI) / 180))) * Math.sin(bearing) };
    if (!nearEvent(p, e.date, 8, 7)) return { lat: +p.lat.toFixed(4), lng: +p.lng.toFixed(4) };
  }
  return null;
}

const samples = [];
for (const e of inventory) {
  rand = e.event_id.startsWith('rec-') ? rng(seedOf(e.event_id)) : globalRand;
  const base = { event_id: e.event_id, state: e.state, accuracy_km: e.accuracy_km };
  samples.push({ ...base, label: 1, sample_type: 'event', date: e.date, lat: e.lat, lng: e.lng });
  for (let i = 0; i < 2; i++) {
    const d = otherDate(e);
    if (d) samples.push({ ...base, label: 0, sample_type: 'same_place_other_date', date: d, lat: e.lat, lng: e.lng });
  }
  const p = nearbyPlace(e);
  if (p) samples.push({ ...base, label: 0, sample_type: 'nearby_place_same_date', date: e.date, ...p });
}
console.log(`samples: ${samples.length} (${samples.filter((s) => s.label).length} landslides, ${samples.filter((s) => !s.label).length} non-landslides)`);

// ---------- Run ----------
const progress = (label) => (d, n) => { if (d % 100 === 0 || d === n) console.log(`  ${label} ${d}/${n}`); };
const failures = [];
const safe = (label, fn) => async (s, i) => { try { return await fn(s, i); } catch (e) { failures.push({ step: label, event_id: s.event_id, date: s.date, error: e.message.slice(0, 160) }); return null; } };

console.log('earthquake catalogue…');
const quakes = await quakeCatalogue();
console.log(`  ${quakes.length} M4+ earthquakes since 2006`);

console.log('terrain…');
const locKey = (s) => `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
const uniqueLocs = [...new Map(samples.map((s) => [locKey(s), s])).values()];
const terr = await mapLimit(uniqueLocs, 4, safe('terrain', terrain), progress('terrain'));
const terrainByLoc = new Map(uniqueLocs.map((s, i) => [locKey(s), terr[i]]));

console.log('weather (Open-Meteo)…');
const wx = await mapLimit(samples, 4, safe('weather', weather), progress('weather'));
console.log('rain (NASA POWER)…');
const pw = await mapLimit(samples, 3, safe('power', power), progress('power'));

const rows = samples.map((s, i) => ({
  ...s, month: Number(s.date.slice(5, 7)),
  ...(wx[i] || {}), ...(pw[i] || {}), ...(terrainByLoc.get(locKey(s)) || {}), ...shaking(s, quakes),
}));

const round = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
writeCsv(path.join(DATA, 'dataset.csv'), rows.map((r) => Object.fromEntries(COLUMNS.map((c) => [c, round(r[c])]))), COLUMNS);
fs.writeFileSync(path.join(DATA, 'build_log.json'), JSON.stringify({ built_at: new Date().toISOString(), samples: rows.length, failures }, null, 2));

// ---------- Quick look: do the factors differ between landslides and non-landslides? ----------
const med = (a) => { const v = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
const groups = { event: rows.filter((r) => r.sample_type === 'event'), same_place_other_date: rows.filter((r) => r.sample_type === 'same_place_other_date'), nearby_place_same_date: rows.filter((r) => r.sample_type === 'nearby_place_same_date') };
console.log(`\nwrote ml/data/dataset.csv: ${rows.length} rows, ${failures.length} failed lookups (see build_log.json)`);
console.log('\nmedians            event   same-place/other-date   nearby/same-date');
for (const c of ['rain_d0', 'rain_3d', 'rain_7d', 'rain_30d', 'api_30d', 'max_1h_48h', 'power_rain_3d', 'sm_top', 'sm_deep', 'slope_deg', 'relief_1km', 'curvature', 'elev_m', 'quake_max_mmi_30d']) {
  console.log(c.padEnd(18), ...Object.values(groups).map((g) => String(med(g.map((r) => r[c]))?.toFixed(2) ?? '–').padStart(12)));
}
