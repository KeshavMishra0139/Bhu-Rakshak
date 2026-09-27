// Step 1c: extra factors on top of dataset.csv → dataset_plus.csv
//   node ml/build_extra.mjs
//
//   Rain relative to normal   NASA POWER long-term monthly climatology: how many times wetter than usual for this
//                             place and month the last 3 / 7 / 30 days were (50 mm means different things in
//                             Cherrapunji and Gangtok).
//   Past landslides nearby    From our own inventory, strictly BEFORE the sample date (no peeking at the future).
//   Rivers and roads          OpenStreetMap (Overpass, tiled): distance to the nearest major road (road cuts)
//                             and river (toe erosion), capped at 3 km.
//   Vegetation                MODIS NDVI (250 m, 16-day composite ending before the sample date), ORNL DAAC.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, getCached, mapLimit, parseCsv, writeCsv, distanceKm, addDays } from './lib.mjs';
import { roadsRiversNear, nearestM } from './osm.mjs';

// dataset.csv plus the road-matched comparison spots (controls.csv) when they exist.
const rows = [
  ...parseCsv(fs.readFileSync(path.join(DATA, 'dataset.csv'), 'utf8')),
  ...(fs.existsSync(path.join(DATA, 'controls.csv')) ? parseCsv(fs.readFileSync(path.join(DATA, 'controls.csv'), 'utf8')) : []),
];
const NDVI_ONLY = process.argv.includes('--ndvi-only'); // prefetch vegetation while the OSM tiles download
const inventory = parseCsv(fs.readFileSync(path.join(DATA, 'inventory.csv'), 'utf8')).map((e) => ({ ...e, lat: +e.lat, lng: +e.lng }));
const q = (o) => new URLSearchParams(o).toString();
const failures = [];
const safe = (label, fn) => async (x, i) => { try { return await fn(x, i); } catch (e) { failures.push({ step: label, key: JSON.stringify(x).slice(0, 80), error: e.message.slice(0, 160) }); return null; } };
const progress = (label) => (d, n) => { if (d % 100 === 0 || d === n) console.log(`  ${label} ${d}/${n}`); };
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// Distances are capped at 3 km ("3000" = no major road / river within 3 km).
// ---------- Climatology (POWER grid is 0.5°, so cache per cell) ----------
const cellOf = (r) => `${(Math.round(+r.lat * 2) / 2).toFixed(1)},${(Math.round(+r.lng * 2) / 2).toFixed(1)}`;
const cells = [...new Set(rows.map(cellOf))];
console.log(`climatology for ${cells.length} cells…`);
const clim = new Map();
await mapLimit(cells, 2, safe('climatology', async (c) => {
  const [lat, lng] = c.split(',');
  const j = await getCached(`https://power.larc.nasa.gov/api/temporal/climatology/point?${q({ parameters: 'PRECTOTCORR', community: 'AG', longitude: lng, latitude: lat, format: 'JSON' })}`);
  clim.set(c, j.properties.parameter.PRECTOTCORR);
}), progress('climatology'));

// ---------- Rivers and roads (from the cached OSM tiles, see osm.mjs / prefetch_osm.mjs) ----------
const locKey = (r) => `${(+r.lat).toFixed(4)},${(+r.lng).toFixed(4)}`;
const locs = [...new Set(rows.map(locKey))];
const osm = new Map();
if (!NDVI_ONLY) {
  console.log(`rivers and roads for ${locs.length} locations…`);
  await mapLimit(locs, 4, safe('osm', async (k) => {
    const [lat, lng] = k.split(',').map(Number);
    const { roads, rivers } = await roadsRiversNear({ lat, lng });
    osm.set(k, { dist_road_m: nearestM({ lat, lng }, roads), dist_major_river_m: nearestM({ lat, lng }, rivers) });
  }), progress('osm'));
}

// ---------- NDVI before the date (per row) ----------
const adoy = (iso) => { const d = new Date(iso + 'T00:00:00Z'); const start = Date.UTC(d.getUTCFullYear(), 0, 1); return `A${d.getUTCFullYear()}${String(Math.floor((d - start) / 86400000) + 1).padStart(3, '0')}`; };
console.log(`vegetation (MODIS NDVI) for ${rows.length} rows…`);
const ndvi = await mapLimit(rows, 3, safe('ndvi', async (r) => {
  const j = await getCached(`https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?${q({ latitude: r.lat, longitude: r.lng, band: '250m_16_days_NDVI', startDate: adoy(addDays(r.date, -48)), endDate: adoy(addDays(r.date, -18)), kmAboveBelow: 0, kmLeftRight: 0 })}`, { timeoutMs: 90000 });
  const s = (j.subset || []).filter((x) => x.data?.[0] != null && x.data[0] > -3000).sort((a, b) => a.calendar_date.localeCompare(b.calendar_date));
  const last = s[s.length - 1];
  return last ? { ndvi_before: last.data[0] * 0.0001, ndvi_date: last.calendar_date } : null;
}), progress('ndvi'));

if (NDVI_ONLY) { console.log(`vegetation cached, ${failures.length} failed`); process.exit(0); }

// ---------- Assemble ----------
const out = rows.map((r, i) => {
  const c = clim.get(cellOf(r));
  const monthMean = c ? c[MONTHS[Number(r.date.slice(5, 7)) - 1]] : null; // mm/day, long-term mean for this month
  const annual = c ? c.ANN : null;
  const ratio = (v, days) => (monthMean && v !== '' ? +v / (monthMean * days) : null);
  const prior = inventory.filter((e) => e.date < addDays(r.date, -1) && e.event_id !== r.event_id);
  const near = (km) => prior.filter((e) => distanceKm(e, { lat: +r.lat, lng: +r.lng }) <= km).length;
  return {
    ...r,
    clim_month_mm_day: monthMean, clim_annual_mm_day: annual,
    rain_3d_vs_normal: ratio(r.rain_3d, 3), rain_7d_vs_normal: ratio(r.rain_7d, 7), rain_30d_vs_normal: ratio(r.rain_30d, 30),
    past_landslides_5km: near(5), past_landslides_15km: near(15),
    ...(osm.get(locKey(r)) || {}),
    ...(ndvi[i] || {}),
  };
});
writeCsv(path.join(DATA, 'dataset_plus.csv'), out, Object.keys(out.find((o) => o.ndvi_before != null && o.dist_road_m != null) || out[0]));
fs.writeFileSync(path.join(DATA, 'build_extra_log.json'), JSON.stringify({ built_at: new Date().toISOString(), rows: out.length, failures }, null, 2));
console.log(`wrote ml/data/dataset_plus.csv (${out.length} rows), ${failures.length} failed lookups`);
