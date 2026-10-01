// Hindcast: replay a real past landslide through the live rule-based engine, hour by hour, using only what the
// system could have known at each hour. Writes client/public/data/hindcast/event.json for the Hindcast page.
//   node ml/build_hindcast.mjs
//
// Inputs, all archived public data:
//  • Weather: Open-Meteo Historical Forecast API — the same hourly variables the live server reads
//    (server/src/ingest/openMeteo.js), so featuresAt() and the engine see exactly the live shape of data.
//  • Rain forecast: Open-Meteo Previous Runs API (precipitation_previous_day1 = the forecast issued about a day
//    earlier), so the replay never uses rain that had not yet fallen as if it had been forecast perfectly.
//  • Earthquakes: USGS FDSN catalogue for the 30 days before, scored with the live seismicSeverity().
//  • Terrain: the monitoring point's static layers from server/src/data/ner_preview.json (as on the live site).
//  • IMD district warnings are not replayed (no machine-readable archive) — the engine's documented fallback.
import fs from 'node:fs';
import path from 'node:path';
import { ML_ROOT, getCached } from './lib.mjs';
import { featuresAt } from '../server/src/ingest/features.js';
import { ENGINE_VERSION, normaliseStatic, normaliseDynamic, scoreFrom, levelFromScore } from '../server/src/prediction/engine.js';
import { parseUsgs, setSeismicCache, seismicSeverity, distanceKm } from '../server/src/ingest/seismic.js';
import { riskConfig } from '../server/src/config/shared.js';

const ROOT = path.resolve(ML_ROOT, '..');
const OUT = path.join(ROOT, 'client/public/data/hindcast/event.json');

// ---------- The event (verified from news reports, see sources) ----------
const EVENT = {
  id: 'aizawl-2024-05-28',
  title_en: 'Aizawl stone-quarry landslide (Cyclone Remal)',
  title_hi: 'आइज़ोल पत्थर खदान भूस्खलन (चक्रवात रेमल)',
  time_ist: '2024-05-28T06:00',
  time_note_en: 'Reported as "around 6 am"',
  time_note_hi: '"लगभग सुबह 6 बजे" बताया गया',
  place_en: 'Between Melthum and Hlimen, southern outskirts of Aizawl',
  place_hi: 'मेलथुम और ह्लिमेन के बीच, आइज़ोल का दक्षिणी बाहरी इलाका',
  state: 'Mizoram',
  // Hlimen locality (OpenStreetMap Nominatim); Melthum is not mapped, so the point is approximate (~1 km).
  lat: 23.6836, lng: 92.7119, accuracy_km: 1,
  deaths: 27,
  trigger_en: 'Heavy rain after Cyclone Remal made landfall',
  trigger_hi: 'चक्रवात रेमल के बाद भारी बारिश',
  sources: [
    { title: 'Outlook India — 27 dead after stone quarry collapses amid incessant rains in Aizawl', url: 'https://www.outlookindia.com/national/mizoram-several-dead-after-stone-quarry-collapses-amid-incessant-rains-in-aizawl' },
    { title: 'The National — Quarry collapses in Mizoram after Cyclone Remal', url: 'https://www.thenationalnews.com/news/asia/2024/05/28/cyclone-remal-mizoram-quarry-landslide-rain/' },
    { title: 'All India Radio News — death toll after massive landslide in Mizoram', url: 'https://www.newsonair.gov.in/death-toll-reaches-23-after-massive-landslide-in-mizoram' },
  ],
};
const REPLAY_FROM = '2024-05-25T00:00'; // IST, shown on the timeline
const REPLAY_TO = '2024-05-28T18:00';
const FETCH_FROM = '2024-05-17'; // 7-day rain sums need a week of history before the timeline starts
const FETCH_TO = '2024-05-30';

// The live monitoring point for Aizawl and its terrain, exactly as the server has them.
const ner = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/src/data/ner_preview.json'), 'utf8'));
const place = ner.places.find((p) => p.location.id === 'aizawl');
const station = place.location;
const staticRow = place.static;

const HOURLY_VARS = [ // same list as server/src/ingest/openMeteo.js
  'precipitation', 'rain', 'snowfall', 'snow_depth', 'temperature_2m', 'relative_humidity_2m', 'cloud_cover',
  'freezing_level_height', 'weather_code', 'soil_temperature_0cm',
  'soil_moisture_0_to_1cm', 'soil_moisture_1_to_3cm', 'soil_moisture_3_to_9cm', 'soil_moisture_9_to_27cm', 'soil_moisture_27_to_81cm',
];
const qs = (o) => new URLSearchParams(o).toString();
const common = { latitude: station.lat.toFixed(4), longitude: station.lng.toFixed(4), start_date: FETCH_FROM, end_date: FETCH_TO, timezone: 'Asia/Kolkata' };
const weather = await getCached(`https://historical-forecast-api.open-meteo.com/v1/forecast?${qs({ ...common, hourly: HOURLY_VARS.join(',') })}`);
const issued = await getCached(`https://previous-runs-api.open-meteo.com/v1/forecast?${qs({ ...common, hourly: 'precipitation_previous_day1' })}`);
const quakes = parseUsgs(await getCached(`https://earthquake.usgs.gov/fdsnws/event/1/query?${qs({ format: 'geojson', starttime: '2024-04-25', endtime: '2024-05-29', latitude: station.lat, longitude: station.lng, maxradiuskm: 800, minmagnitude: 3 })}`));
setSeismicCache({ quakes });

const hourly = weather.hourly;
const fcByTime = new Map(issued.hourly.time.map((t, k) => [t, issued.hourly.precipitation_previous_day1[k]]));
const istMs = (t) => new Date(`${t}:00+05:30`).getTime();
const staticN = normaliseStatic(staticRow);
const eventMs = istMs(EVENT.time_ist);

const hours = [];
for (let i = 0; i < hourly.time.length; i++) {
  const t = hourly.time[i];
  if (t < REPLAY_FROM || t > REPLAY_TO) continue;
  const f = featuresAt(hourly, i);
  // Replace "the next 24/48 h of rain" (which in an archive is what actually fell) with the forecast as issued.
  let fc24 = 0; let fc48 = 0;
  for (let k = 1; k <= 48; k++) {
    const v = fcByTime.get(hourly.time[i + k]) || 0;
    if (k <= 24) fc24 += v;
    fc48 += v;
  }
  f.rain_fc_24h = Math.round(fc24 * 10) / 10;
  f.rain_fc_48h = Math.round(fc48 * 10) / 10;
  f.imd_rain_severity = null;
  f.seismic_shaking = seismicSeverity(station, istMs(t));
  const { score, drivers } = scoreFrom(staticN, normaliseDynamic(f, staticRow.elevation_m));
  hours.push({
    t, score: Math.round(score * 1000) / 1000, level: levelFromScore(score),
    rain_mm: f.rain_intensity, rain_24h: f.rain_24h, rain_72h: f.rain_72h, rain_fc_24h: f.rain_fc_24h,
    saturation: f.saturation_index, drivers: drivers.slice(0, 3),
  });
}

const before = hours.filter((h) => istMs(h.t) <= eventMs);
const firstAt = (lv) => {
  const rank = { moderate: 1, high: 2, critical: 3 }[lv];
  // First hour of the run of hours at or above this level that is still going at the time of the event.
  let start = null;
  for (const h of before) {
    const r = { low: 0, moderate: 1, high: 2, critical: 3 }[h.level];
    if (r >= rank) start ??= h.t; else start = null;
  }
  return start;
};
const first = { moderate: firstAt('moderate'), high: firstAt('high'), critical: firstAt('critical') };
const lead = Object.fromEntries(Object.entries(first).map(([k, v]) => [k, v ? Math.round((eventMs - istMs(v)) / 3600000) : null]));
const peak = before.reduce((m, h) => (!m || h.score > m.score ? h : m), null);
const atEvent = hours.find((h) => h.t === EVENT.time_ist);
const nearbyQuakes = quakes.map((e) => ({ mag: e.mag, time: e.time, distance_km: Math.round(distanceKm(e, station)), place: e.place }));

const result = {
  _comment: 'Generated by ml/build_hindcast.mjs from archived public data. Do not edit by hand; re-run the script. Replace with another event by editing EVENT in the script.',
  generated_at: new Date().toISOString(),
  event: EVENT,
  station: {
    id: station.id, name_en: station.name_en, name_hi: station.name_hi, lat: station.lat, lng: station.lng,
    distance_km: Math.round(distanceKm(station, EVENT) * 10) / 10,
    note_en: 'The live system watches Aizawl from one monitoring point (steepest roadside slope near the town centre). The replay scores that point, as the live site would have.',
    note_hi: 'लाइव सिस्टम आइज़ोल को एक निगरानी बिंदु (शहर के पास सड़क किनारे की सबसे खड़ी ढलान) से देखता है। रीप्ले उसी बिंदु का स्कोर दिखाता है, जैसा लाइव साइट दिखाती।',
  },
  thresholds: riskConfig.thresholds,
  method: {
    engine: ENGINE_VERSION,
    weather: 'Open-Meteo Historical Forecast API (same hourly variables as the live feed)',
    forecast: 'Open-Meteo Previous Runs API: rain forecast as issued about one day earlier (no hindsight)',
    imd: 'Not replayed (no machine-readable IMD warning archive); the engine falls back to the model rain forecast, as it does live when IMD has nothing current',
    seismic: `USGS catalogue, 30 days before: ${nearbyQuakes.length} quake(s) of M3+ within 800 km, scored with the live shaking formula`,
    terrain: 'Aizawl monitoring point from the NER preview (slope, landslide history, roads from public data; rock type and fault distance are unverified defaults)',
  },
  quakes: nearbyQuakes,
  first, lead_hours: lead,
  peak_before_event: peak && { t: peak.t, score: peak.score, level: peak.level },
  at_event: atEvent && { t: atEvent.t, score: atEvent.score, level: atEvent.level },
  hours,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n');
console.log(`station ${station.id} is ${result.station.distance_km} km from the event`);
console.log('first moderate', first.moderate, `(${lead.moderate} h before)`, '| first high', first.high, `(${lead.high} h before)`, '| first critical', first.critical, `(${lead.critical} h before)`);
console.log('peak before event', JSON.stringify(result.peak_before_event), '| at event', JSON.stringify(result.at_event));
console.log('quakes', JSON.stringify(nearbyQuakes));
for (const h of hours.filter((_, k) => k % 6 === 0)) console.log(h.t, h.score, h.level.padEnd(8), `rain ${h.rain_mm}/h 24h ${h.rain_24h} 72h ${h.rain_72h} fc ${h.rain_fc_24h} sat ${h.saturation}`, h.drivers.map((d) => d.key).join(','));
console.log(`wrote ${path.relative(ROOT, OUT)}`);
