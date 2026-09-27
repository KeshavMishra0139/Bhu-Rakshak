// Build server/test/fixtures/ml_parity.json: real training rows + the raw weather/earthquake data they came from,
// so the server test can prove the live feature code reproduces the training features exactly.
//   node ml/make_parity_fixture.mjs
import fs from 'node:fs';
import path from 'node:path';
import { DATA, ML_ROOT, parseCsv, getCached, addDays } from './lib.mjs';

const REPO = path.resolve(ML_ROOT, '..');
const q = (o) => new URLSearchParams(o).toString();
const rows = parseCsv(fs.readFileSync(path.join(DATA, 'clean.csv'), 'utf8'));
// A few varied rows: landslides and ordinary days, different years and regions. Only settled historical data:
// the provider still revises the last few weeks of ERA5 (preliminary "ERA5T"), e.g. temperatures by ~0.3 °C.
const pick = [
  rows.find((r) => r.sample_type === 'event' && r.date.startsWith('2015-07')),
  rows.find((r) => r.sample_type === 'same_place_other_date' && r.date.startsWith('2012')),
  rows.find((r) => r.sample_type === 'roadside_same_date' && r.state === 'Nagaland'),
].filter(Boolean);

const TODAY = new Date().toISOString().slice(0, 10);
const quakeUrl = `https://earthquake.usgs.gov/fdsnws/event/1/query?${q({ format: 'geojson', minlatitude: 18, maxlatitude: 33, minlongitude: 83, maxlongitude: 102, minmagnitude: 4, starttime: '2006-11-01', endtime: TODAY, orderby: 'time-asc', limit: 20000 })}`;
const allQuakes = (await getCached(quakeUrl, { timeoutMs: 180000 })).features.map((f) => ({ time: f.properties.time, mag: f.properties.mag, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], depth_km: f.geometry.coordinates[2] }));

const cases = [];
for (const r of pick) {
  const start = addDays(r.date, -30);
  const params = q({ latitude: r.lat, longitude: r.lng, start_date: start, end_date: r.date, daily: 'precipitation_sum,snowfall_sum,temperature_2m_max,temperature_2m_min', hourly: ['precipitation', 'soil_moisture_0_to_7cm', 'soil_moisture_7_to_28cm', 'soil_moisture_28_to_100cm'].join(','), timezone: 'Asia/Kolkata' });
  const w = await getCached(`https://archive-api.open-meteo.com/v1/archive?${params}`);
  const end = Date.parse(`${r.date}T23:59:59+05:30`);
  cases.push({
    row: r,
    daily: { time: w.daily.time, precipitation_sum: w.daily.precipitation_sum, snowfall_sum: w.daily.snowfall_sum, temperature_2m_max: w.daily.temperature_2m_max, temperature_2m_min: w.daily.temperature_2m_min },
    hourly: { precipitation: w.hourly.precipitation },
    quakes: allQuakes.filter((e) => e.time > end - 31 * 86400000 && e.time <= end),
  });
}
const out = path.join(REPO, 'server/test/fixtures/ml_parity.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ note: 'Real rows from ml/data/clean.csv with the raw data they were built from.', cases }));
console.log(`wrote ${cases.length} cases: ${cases.map((c) => `${c.row.sample_type} ${c.row.date}`).join(', ')}`);
