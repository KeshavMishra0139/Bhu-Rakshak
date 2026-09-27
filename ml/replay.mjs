// Step 4: replay past monsoons day by day — would the model have warned before real landslides, and how often
// would it have cried wolf on ordinary days?
//   node ml/replay.mjs
//
// Honest by construction: for each season a fresh model is trained ONLY on rows dated before that year, so it
// never sees the landslides it is being tested on. Factors are computed exactly as in build_dataset.mjs
// (checked against dataset rows by the consistency test at the end).
import fs from 'node:fs';
import path from 'node:path';
import { DATA, ML_ROOT, parseCsv, getCached, distanceKm, addDays, dayDiff, intensityAt } from './lib.mjs';
import { terrainAt } from './dem.mjs';
import { trainGBDT, predictProba } from './gbdt.mjs';

const REPLAYS = [
  { name: 'Kurseong (Darjeeling hills)', lat: 26.8826, lng: 88.2788, from: '2015-05-01', to: '2015-10-31' },
  { name: 'Kalimpong', lat: 27.0600, lng: 88.4700, from: '2015-05-01', to: '2015-10-31' },
  { name: 'Kurseong (Darjeeling hills)', lat: 26.8826, lng: 88.2788, from: '2016-05-01', to: '2016-10-31' },
  { name: 'Rimbi (West Sikkim)', lat: 27.3148, lng: 88.1859, from: '2026-07-28', to: '2026-09-25' },
];
const NEAR_KM = 15; // a reported landslide within this distance counts as "a landslide here"

const q = (o) => new URLSearchParams(o).toString();
const model = JSON.parse(fs.readFileSync(path.join(ML_ROOT, 'models', 'landslide-gbdt-v1.json'), 'utf8'));
const FEATS = model.features;
const inventory = parseCsv(fs.readFileSync(path.join(DATA, 'inventory.csv'), 'utf8')).map((e) => ({ ...e, lat: +e.lat, lng: +e.lng }));
const clean = parseCsv(fs.readFileSync(path.join(DATA, 'clean.csv'), 'utf8'));
const num = (v) => (v === '' || v == null ? null : Number(v));

// ---------- Daily factors for a whole season at one place ----------
async function seasonFactors(p, from, to) {
  const start = addDays(from, -31);
  const today = new Date().toISOString().slice(0, 10);
  const recent = dayDiff(today, to) < 7;
  const soil = recent ? ['soil_moisture_3_to_9cm', 'soil_moisture_9_to_27cm', 'soil_moisture_27_to_81cm'] : ['soil_moisture_0_to_7cm', 'soil_moisture_7_to_28cm', 'soil_moisture_28_to_100cm'];
  const params = { latitude: p.lat, longitude: p.lng, start_date: start, end_date: to, daily: 'precipitation_sum,snowfall_sum,temperature_2m_max,temperature_2m_min', hourly: ['precipitation', ...soil].join(','), timezone: 'Asia/Kolkata' };
  const w = await getCached(recent ? `https://api.open-meteo.com/v1/forecast?${q(params)}` : `https://archive-api.open-meteo.com/v1/archive?${q(params)}`);
  const pw = await getCached(`https://power.larc.nasa.gov/api/temporal/daily/point?${q({ parameters: 'PRECTOTCORR', community: 'AG', longitude: p.lng, latitude: p.lat, start: start.replace(/-/g, ''), end: to.replace(/-/g, ''), format: 'JSON' })}`);
  const pv = Object.values(pw.properties.parameter.PRECTOTCORR).map((x) => (x < 0 ? null : x));
  const t = await terrainAt(p.lat, p.lng);
  const flat = t.slope < 2;
  const terrain = { elev_m: t.elev, slope_deg: t.slope, northness: flat ? 0 : Math.cos((t.aspect * Math.PI) / 180), eastness: flat ? 0 : Math.sin((t.aspect * Math.PI) / 180), curvature: t.curvature, relief_1km: t.relief };
  const quakes = await quakeCatalogue();

  const P = w.daily.precipitation_sum;
  const H = w.hourly;
  const days = [];
  for (let n = 31; n < w.daily.time.length; n++) {
    const date = w.daily.time[n];
    const sum = (a, b) => { let s = 0; for (let k = n - b; k <= n - a; k++) s += P[k] ?? 0; return s; };
    let api = 0; for (let k = n - 30; k < n; k++) api = api * 0.9 + (P[k] ?? 0);
    const hEnd = (n + 1) * 24; // hourly index just after day n
    const meanDayBefore = (key) => { const v = H[key].slice(hEnd - 48, hEnd - 24).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const psum = (k) => { const v = pv.slice(n - k + 1, n + 1); return v.some((x) => x == null) ? null : v.reduce((a, b) => a + b, 0); };
    const end = Date.parse(date + 'T23:59:59+05:30');
    let mmi = 0; let count = 0; let maxMag = 0;
    for (const e of quakes) {
      if (e.time < end - 30 * 86400000 || e.time > end) continue;
      if (distanceKm(e, p) <= 300) { count++; maxMag = Math.max(maxMag, e.mag); }
      mmi = Math.max(mmi, intensityAt(e, p));
    }
    days.push({
      date,
      rain_d0: P[n], rain_d1: P[n - 1], rain_3d: sum(0, 2), rain_7d: sum(0, 6), rain_15d: sum(0, 14), rain_30d: sum(0, 29), api_30d: api,
      max_1h_48h: Math.max(...H.precipitation.slice(hEnd - 48, hEnd).map((x) => x ?? 0)),
      rainy_days_7d: P.slice(n - 6, n + 1).filter((x) => (x ?? 0) >= 1).length,
      power_rain_d0: pv[n], power_rain_3d: psum(3), power_rain_7d: psum(7), power_rain_30d: psum(30),
      sm_top: meanDayBefore(soil[0]), sm_mid: meanDayBefore(soil[1]), sm_deep: meanDayBefore(soil[2]),
      tmax_d0: w.daily.temperature_2m_max[n], tmin_d0: w.daily.temperature_2m_min[n],
      snowfall_7d: w.daily.snowfall_sum.slice(n - 6, n + 1).reduce((a, b) => a + (b ?? 0), 0),
      ...terrain, quake_max_mmi_30d: mmi || 1, quake_count_300km_30d: count, quake_max_mag_300km_30d: maxMag || null,
    });
  }
  return days;
}
let quakeCache;
async function quakeCatalogue() {
  if (quakeCache) return quakeCache;
  const today = new Date().toISOString().slice(0, 10);
  const j = await getCached(`https://earthquake.usgs.gov/fdsnws/event/1/query?${q({ format: 'geojson', minlatitude: 18, maxlatitude: 33, minlongitude: 83, maxlongitude: 102, minmagnitude: 4, starttime: '2006-11-01', endtime: today, orderby: 'time-asc', limit: 20000 })}`, { timeoutMs: 180000 });
  quakeCache = j.features.map((f) => ({ time: f.properties.time, mag: f.properties.mag, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], depth_km: f.geometry.coordinates[2] }));
  return quakeCache;
}

// ---------- A model that has never seen the replay year ----------
function modelBefore(year) {
  const rows = clean.filter((r) => r.date < `${year}-01-01`).map((r) => ({ ...r, label: +r.label, x: FEATS.map((f) => num(r[f])) }));
  const cut = Math.floor(rows.length * 0.85);
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const m = trainGBDT(sorted.slice(0, cut).map((r) => r.x), sorted.slice(0, cut).map((r) => r.label), {}, sorted.slice(cut).map((r) => r.x), sorted.slice(cut).map((r) => r.label));
  return { model: m, rows: rows.length, landslides: rows.filter((r) => r.label).length };
}

const out = [];
const md = ['# Replaying past monsoons\n', `A model trained only on data from **before** each season scores every day. Warning threshold = ${model.ops_threshold.toFixed(2)} (operational: ~1 warning per 10 ordinary days in the training years). A "landslide day" = a landslide reported within ${NEAR_KM} km.\n`];
for (const rp of REPLAYS) {
  const year = rp.from.slice(0, 4);
  const { model: m, rows, landslides } = modelBefore(year);
  const days = await seasonFactors(rp, rp.from, rp.to);
  const events = inventory.filter((e) => e.date >= rp.from && e.date <= rp.to && distanceKm(e, rp) <= NEAR_KM);
  const eventDays = new Set(events.map((e) => e.date));
  const scored = days.map((d) => ({ ...d, p: predictProba(m, FEATS.map((f) => d[f])) }));
  const warn = (d) => d.p >= model.ops_threshold;
  // A landslide counts as "warned" if the model warned on that day or the day before.
  const caught = [...eventDays].filter((d) => scored.some((s) => warn(s) && dayDiff(d, s.date) >= 0 && dayDiff(d, s.date) <= 1));
  const quietDays = scored.filter((s) => ![...eventDays].some((d) => Math.abs(dayDiff(d, s.date)) <= 2));
  const falseDays = quietDays.filter(warn);
  const top = [...scored].sort((a, b) => b.p - a.p).slice(0, 8);
  // Within the season: how highly were the landslide days ranked among all days? (0.5 = random, 1 = always top)
  const rankOf = (d) => { const s = scored.find((x) => x.date === d); return s ? scored.filter((x) => x.p < s.p).length / (scored.length - 1) : null; };
  const pcts = [...eventDays].map(rankOf).filter((v) => v != null);
  const seasonAuc = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
  const res = {
    place: rp.name, season: `${rp.from} → ${rp.to}`, trained_on: `${rows} rows (${landslides} landslides) before ${year}`,
    landslide_days: [...eventDays].sort(), warned_landslide_days: caught.sort(),
    warning_days: scored.filter(warn).length, days: scored.length, season_rank: seasonAuc, false_alarm_days: falseDays.length, quiet_days: quietDays.length,
  };
  out.push(res);
  const eventScores = [...eventDays].sort().map((d) => { const s = scored.find((x) => x.date === d); const prev = scored.find((x) => x.date === addDays(d, -1)); return `${d}: ${s ? s.p.toFixed(2) : '–'} (day before ${prev ? prev.p.toFixed(2) : '–'})`; });
  md.push(`## ${rp.name}, ${rp.from.slice(0, 7)} to ${rp.to.slice(0, 7)}`,
    `Model trained on ${res.trained_on}.`,
    `- Landslide days: **${eventDays.size}** · warned on the day or the day before: **${caught.length}**`,
    `- Warning days in the season: **${res.warning_days} of ${res.days}** · on quiet days (no landslide within ±2 days): **${falseDays.length} of ${quietDays.length}** (${((falseDays.length / (quietDays.length || 1)) * 100).toFixed(0)}%)`,
    `- Landslide days ranked on average above **${seasonAuc == null ? '–' : (seasonAuc * 100).toFixed(0) + '%'}** of the season's days (50% = no better than chance)`,
    `- Score on landslide days: ${eventScores.join('; ') || '–'}`,
    `- Highest-scored days: ${top.map((d) => `${d.date} ${d.p.toFixed(2)}${eventDays.has(d.date) ? ' ✓' : ''}`).join(', ')}`, '');
  console.log(JSON.stringify(res));
}

// ---------- Consistency test: replay factors must equal the dataset's factors for the same place/day ----------
const probe = clean.find((r) => r.sample_type === 'event' && r.date >= '2015-05-01' && r.date <= '2015-10-31' && Math.abs(+r.lat - REPLAYS[0].lat) < 1e-3 && Math.abs(+r.lng - REPLAYS[0].lng) < 1e-3);
if (probe) {
  const days = await seasonFactors(REPLAYS[0], REPLAYS[0].from, REPLAYS[0].to);
  const d = days.find((x) => x.date === probe.date);
  const diffs = FEATS.filter((f) => num(probe[f]) != null && d[f] != null && Math.abs(num(probe[f]) - d[f]) > 0.01 * Math.max(1, Math.abs(d[f])));
  md.push(`\n_Consistency check (${probe.date}, ${probe.event_id}): ${diffs.length ? 'MISMATCH in ' + diffs.join(', ') : 'replay factors match the training dataset'}._`);
  console.log('consistency:', diffs.length ? diffs : 'ok');
}
fs.writeFileSync(path.join(ML_ROOT, 'models', 'replay.md'), md.join('\n'));
fs.writeFileSync(path.join(ML_ROOT, 'models', 'replay.json'), JSON.stringify(out, null, 2));
console.log(md.join('\n'));
