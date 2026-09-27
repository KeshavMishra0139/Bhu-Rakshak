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
import { DATA, getCached, mapLimit, parseCsv, writeCsv, rng, distanceKm, addDays, dayDiff, intensityAt } from './lib.mjs';
import { terrainAt } from './dem.mjs';

const TODAY = new Date().toISOString().slice(0, 10);
const inventory = parseCsv(fs.readFileSync(path.join(DATA, 'inventory.csv'), 'utf8'))
  .map((e) => ({ ...e, lat: +e.lat, lng: +e.lng, accuracy_km: +e.accuracy_km }));
const rand = rng(2026);

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

// ---------- 2. Weather: Open-Meteo (ERA5 reanalysis, or the forecast archive for recent days) ----------
const q = (o) => new URLSearchParams(o).toString();
const DAILY = 'precipitation_sum,snowfall_sum,temperature_2m_max,temperature_2m_min';

async function weather(s) {
  const start = addDays(s.date, -30);
  const recent = dayDiff(TODAY, s.date) < 7; // ERA5 lags ~5 days
  const soil = recent ? ['soil_moisture_3_to_9cm', 'soil_moisture_9_to_27cm', 'soil_moisture_27_to_81cm'] : ['soil_moisture_0_to_7cm', 'soil_moisture_7_to_28cm', 'soil_moisture_28_to_100cm'];
  const url = recent
    ? `https://api.open-meteo.com/v1/forecast?${q({ latitude: s.lat, longitude: s.lng, start_date: start, end_date: s.date, daily: DAILY, hourly: ['precipitation', ...soil].join(','), timezone: 'Asia/Kolkata' })}`
    : `https://archive-api.open-meteo.com/v1/archive?${q({ latitude: s.lat, longitude: s.lng, start_date: start, end_date: s.date, daily: DAILY, hourly: ['precipitation', ...soil].join(','), timezone: 'Asia/Kolkata' })}`;
  const j = await getCached(url);
  const p = j.daily.precipitation_sum; // index 30 = event day (d0), 29 = day before
  const n = p.length - 1;
  const sum = (from, to) => p.slice(n - to, n - from + 1).reduce((a, b) => a + (b ?? 0), 0);
  let api = 0;
  for (let i = 0; i < n; i++) api = api * 0.9 + (p[i] ?? 0); // antecedent precipitation index up to the day before
  const hp = j.hourly.precipitation;
  const dayBefore = (k) => { const v = j.hourly[k].slice(-48, -24).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  return {
    rain_d0: p[n], rain_d1: p[n - 1], rain_3d: sum(0, 2), rain_7d: sum(0, 6), rain_15d: sum(0, 14), rain_30d: sum(0, 29),
    api_30d: api, max_1h_48h: Math.max(...hp.slice(-48).map((x) => x ?? 0)),
    rainy_days_7d: p.slice(n - 6, n + 1).filter((x) => (x ?? 0) >= 1).length,
    sm_top: dayBefore(soil[0]), sm_mid: dayBefore(soil[1]), sm_deep: dayBefore(soil[2]),
    tmax_d0: j.daily.temperature_2m_max[n], tmin_d0: j.daily.temperature_2m_min[n],
    snowfall_7d: j.daily.snowfall_sum.slice(n - 6, n + 1).reduce((a, b) => a + (b ?? 0), 0),
    weather_grid_lat: j.latitude, weather_grid_lng: j.longitude, weather_source: recent ? 'open-meteo-forecast-archive' : 'open-meteo-era5',
  };
}

// ---------- 3. Second rain source: NASA POWER (daily, MERRA-2 based) ----------
async function power(s) {
  const start = addDays(s.date, -30).replace(/-/g, '');
  const end = s.date.replace(/-/g, '');
  const j = await getCached(`https://power.larc.nasa.gov/api/temporal/daily/point?${q({ parameters: 'PRECTOTCORR', community: 'AG', longitude: s.lng, latitude: s.lat, start, end, format: 'JSON' })}`);
  const v = Object.values(j.properties.parameter.PRECTOTCORR).map((x) => (x < 0 ? null : x));
  const n = v.length - 1;
  const sum = (k) => { const w = v.slice(n - k + 1); return w.some((x) => x == null) ? null : w.reduce((a, b) => a + b, 0); };
  return { power_rain_d0: v[n], power_rain_3d: sum(3), power_rain_7d: sum(7), power_rain_30d: sum(30) };
}

// ---------- 4. Terrain: AWS Terrain Tiles (mainly NASA SRTM ~30 m in this region), see dem.mjs ----------
async function terrain(p) {
  const t = await terrainAt(p.lat, p.lng);
  const flat = t.slope < 2; // flat ground has no meaningful facing direction
  return {
    elev_m: t.elev, slope_deg: t.slope, aspect_deg: flat ? null : t.aspect,
    northness: flat ? 0 : Math.cos((t.aspect * Math.PI) / 180), eastness: flat ? 0 : Math.sin((t.aspect * Math.PI) / 180),
    curvature: t.curvature, relief_1km: t.relief,
  };
}

// ---------- 5. Earthquakes: USGS catalogue, one regional query ----------
async function quakeCatalogue() {
  const j = await getCached(`https://earthquake.usgs.gov/fdsnws/event/1/query?${q({ format: 'geojson', minlatitude: 18, maxlatitude: 33, minlongitude: 83, maxlongitude: 102, minmagnitude: 4, starttime: '2006-11-01', endtime: TODAY, orderby: 'time-asc', limit: 20000 })}`, { timeoutMs: 180000 });
  return j.features.map((f) => ({ time: f.properties.time, mag: f.properties.mag, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], depth_km: f.geometry.coordinates[2] }));
}
function shaking(s, quakes) {
  const end = Date.parse(s.date + 'T23:59:59+05:30');
  const start = end - 30 * 86400000;
  let maxMmi = 0; let count = 0; let maxMag = 0;
  for (const e of quakes) {
    if (e.time < start || e.time > end) continue;
    const km = distanceKm(e, s);
    if (km <= 300) { count++; maxMag = Math.max(maxMag, e.mag); }
    maxMmi = Math.max(maxMmi, intensityAt(e, s));
  }
  return { quake_max_mmi_30d: maxMmi || 1, quake_count_300km_30d: count, quake_max_mag_300km_30d: maxMag || null };
}

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

const COLUMNS = [
  'label', 'sample_type', 'event_id', 'date', 'month', 'lat', 'lng', 'accuracy_km', 'state',
  'rain_d0', 'rain_d1', 'rain_3d', 'rain_7d', 'rain_15d', 'rain_30d', 'api_30d', 'max_1h_48h', 'rainy_days_7d',
  'power_rain_d0', 'power_rain_3d', 'power_rain_7d', 'power_rain_30d',
  'sm_top', 'sm_mid', 'sm_deep', 'tmax_d0', 'tmin_d0', 'snowfall_7d',
  'elev_m', 'slope_deg', 'aspect_deg', 'northness', 'eastness', 'curvature', 'relief_1km',
  'quake_max_mmi_30d', 'quake_count_300km_30d', 'quake_max_mag_300km_30d',
  'weather_source', 'weather_grid_lat', 'weather_grid_lng',
];
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
