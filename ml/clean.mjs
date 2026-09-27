// Step 2: clean and validate the dataset before training. Every removal is counted and explained in
// ml/data/cleaning_report.json, and the cleaned rows are written to ml/data/clean.csv.
//   node ml/clean.mjs
//
// Checks, in order:
//   1. Duplicate reports  — the same landslide reported twice (same day ±1, within 5 km) is kept once
//                           (the copy with the most precise location).
//   2. Non-natural cause  — mining, construction, burst pipes etc. can't be predicted from weather/terrain.
//   3. Imprecise location — events located only to 10–25 km are dropped: terrain factors need ≤ 5 km.
//   4. Missing data       — rows without weather or terrain values are dropped.
//   5. Impossible values  — physical range checks on every factor.
//   6. Implausible place  — a "landslide" on flat plains (tiny slope AND relief) is almost always a geocoding error
//                           (the news report was placed at a town centre); such events are dropped.
//   7. Flat negatives     — non-landslide spots on flat plains make the task artificially easy, so they are dropped:
//                           the model must learn to tell hill slopes apart, not hills from plains.
//   8. Exact duplicates   — identical place + date rows are kept once.
//   9. Orphans            — non-landslide rows whose landslide was removed are dropped with it.
//  10. Border / dropped   — non-landslide rows near ANY reported landslide (other countries, imprecise records).
//  11. Mixed sources      — rows not on the ERA5 reanalysis (different soil-moisture depths) are dropped.
//  12. Random spots       — set aside (road-biased); road-matched spots are used instead.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, parseCsv, writeCsv, distanceKm, dayDiff } from './lib.mjs';

const MAX_ACCURACY_KM = 5;
const FLAT = { slope: 3, relief: 30 }; // "flat" = slope < 3° AND < 30 m height range within ~1 km
const NATURAL_TRIGGERS = new Set(['downpour', 'rain', 'continuous_rain', 'monsoon', 'tropical_cyclone', 'flooding', 'snowfall_snowmelt', 'earthquake', 'freeze_thaw', 'unknown', '']);

const inventory = parseCsv(fs.readFileSync(path.join(DATA, 'inventory.csv'), 'utf8'))
  .map((e) => ({ ...e, lat: +e.lat, lng: +e.lng, accuracy_km: +e.accuracy_km }));
const num = (v) => (v === '' || v == null ? null : Number(v));
// Uses dataset_plus.csv (with the extra factors from build_extra.mjs) when it exists.
const INPUT = fs.existsSync(path.join(DATA, 'dataset_plus.csv')) ? 'dataset_plus.csv' : 'dataset.csv';
const rows = parseCsv(fs.readFileSync(path.join(DATA, INPUT), 'utf8'))
  .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, ['sample_type', 'event_id', 'date', 'state', 'weather_source', 'ndvi_date'].includes(k) ? v : num(v)])));

const report = { input: { file: INPUT, events: inventory.length, rows: rows.length }, removed: {}, examples: {} };
const drop = (reason, items, show = (x) => x) => {
  report.removed[reason] = (report.removed[reason] || 0) + items.length;
  report.examples[reason] = [...(report.examples[reason] || []), ...items.slice(0, 5).map(show)].slice(0, 5);
};

// ---- Event-level checks ----
const removedEvents = new Map(); // event_id -> reason
const removeEvent = (e, reason) => { if (!removedEvents.has(e.event_id)) removedEvents.set(e.event_id, reason); };

// 1. Duplicate reports.
const byPrecision = [...inventory].sort((a, b) => a.accuracy_km - b.accuracy_km);
const kept = [];
for (const e of byPrecision) {
  const dup = kept.find((k) => Math.abs(dayDiff(k.date, e.date)) <= 1 && distanceKm(k, e) <= 5);
  if (dup) removeEvent(e, `duplicate_report (of ${dup.event_id})`);
  else kept.push(e);
}
// 2. Non-natural cause.
for (const e of inventory) if (!NATURAL_TRIGGERS.has(e.trigger || '')) removeEvent(e, `non_natural_trigger:${e.trigger}`);
// 3. Imprecise location.
for (const e of inventory) if (e.accuracy_km > MAX_ACCURACY_KM) removeEvent(e, 'location_accuracy_over_5km');

// 6. Implausible place (needs terrain from the event row).
for (const r of rows.filter((x) => x.sample_type === 'event')) {
  if (r.slope_deg != null && r.relief_1km != null && r.slope_deg < FLAT.slope && r.relief_1km < FLAT.relief) {
    removeEvent({ event_id: r.event_id }, 'event_on_flat_ground (likely geocoding error)');
  }
}
const reasonCounts = {};
for (const why of removedEvents.values()) { const k = why.replace(/ \(of .*\)$/, ''); reasonCounts[k] = (reasonCounts[k] || 0) + 1; }
report.removed_events = reasonCounts;
report.removed_event_examples = [...removedEvents.entries()].slice(0, 12).map(([id, why]) => {
  const e = inventory.find((x) => x.event_id === id) || {};
  return `${id} ${e.date || ''} ${e.place || ''} → ${why}`;
});

// ---- Row-level checks ----
let clean = rows;
const orphan = clean.filter((r) => removedEvents.has(r.event_id));
drop('rows_of_removed_events (incl. their non-landslide rows)', orphan, (r) => `${r.event_id} ${r.sample_type}`);
clean = clean.filter((r) => !removedEvents.has(r.event_id));

// 4. Missing data.
const CORE = ['rain_d0', 'rain_3d', 'rain_7d', 'rain_30d', 'api_30d', 'max_1h_48h', 'sm_top', 'sm_deep', 'elev_m', 'slope_deg', 'relief_1km'];
const missing = clean.filter((r) => CORE.some((c) => r[c] == null || !Number.isFinite(r[c])));
drop('missing_core_values', missing, (r) => `${r.event_id} ${r.sample_type} ${r.date} missing ${CORE.filter((c) => r[c] == null).join(',')}`);
clean = clean.filter((r) => !missing.includes(r));

// 5. Impossible values.
const RANGES = {
  rain_d0: [0, 1000], rain_d1: [0, 1000], rain_3d: [0, 2000], rain_7d: [0, 3000], rain_15d: [0, 4000], rain_30d: [0, 6000],
  max_1h_48h: [0, 300], power_rain_d0: [0, 1000], power_rain_30d: [0, 6000],
  sm_top: [0, 0.8], sm_mid: [0, 0.8], sm_deep: [0, 0.8], tmax_d0: [-50, 50], tmin_d0: [-60, 45], snowfall_7d: [0, 1000],
  elev_m: [-10, 8900], slope_deg: [0, 90], relief_1km: [0, 3000], quake_max_mmi_30d: [1, 12],
  ndvi_before: [-0.2, 1], dist_major_river_m: [0, 3000], dist_road_m: [0, 3000], rain_30d_vs_normal: [0, 30], clim_month_mm_day: [0, 60],
};
const bad = clean.filter((r) => Object.entries(RANGES).some(([c, [lo, hi]]) => r[c] != null && (r[c] < lo || r[c] > hi)));
drop('out_of_physical_range', bad, (r) => `${r.event_id} ${Object.entries(RANGES).filter(([c, [lo, hi]]) => r[c] != null && (r[c] < lo || r[c] > hi)).map(([c]) => `${c}=${r[c]}`).join(',')}`);
clean = clean.filter((r) => !bad.includes(r));

// 7. Flat negatives.
const flatNeg = clean.filter((r) => r.label === 0 && r.slope_deg < FLAT.slope && r.relief_1km < FLAT.relief);
drop('non_landslide_on_flat_ground', flatNeg, (r) => `${r.sample_type} ${r.lat},${r.lng} slope ${r.slope_deg} relief ${r.relief_1km}`);
clean = clean.filter((r) => !flatNeg.includes(r));

// 8. Exact duplicates.
const seen = new Set();
const dups = [];
clean = clean.filter((r) => {
  const k = `${r.lat.toFixed(4)},${r.lng.toFixed(4)},${r.date}`;
  if (seen.has(k)) { dups.push(r); return false; }
  seen.add(k);
  return true;
});
drop('duplicate_place_and_date', dups, (r) => `${r.event_id} ${r.sample_type} ${r.date}`);

// 9. Negatives that ended up within 10 km / 3 days of ANY kept event are ambiguous — drop them.
const keptEvents = clean.filter((r) => r.label === 1);
const ambiguous = clean.filter((r) => r.label === 0 && keptEvents.some((e) => Math.abs(dayDiff(e.date, r.date)) <= 3 && distanceKm(e, r) <= 10));
drop('non_landslide_too_close_to_a_landslide', ambiguous, (r) => `${r.event_id} ${r.sample_type} ${r.date}`);
clean = clean.filter((r) => !ambiguous.includes(r));

// 10. Negatives near ANY reported landslide — including across the border (Bhutan, Nepal, Bangladesh, Myanmar)
//     and records we dropped for an imprecise location. "No landslide" must mean no landslide anyone reported.
const reported = parseCsv(fs.readFileSync(path.join(DATA, 'all_reported.csv'), 'utf8')).map((e) => ({ ...e, lat: +e.lat, lng: +e.lng }));
const contaminated = clean.filter((r) => r.label === 0 && reported.some((e) => Math.abs(dayDiff(e.date, r.date)) <= 7 && distanceKm(e, r) <= 10));
drop('non_landslide_near_any_reported_landslide (any country/record)', contaminated, (r) => `${r.event_id} ${r.sample_type} ${r.date}`);
clean = clean.filter((r) => !contaminated.includes(r));

// 11. One weather product for everyone: rows still on the forecast archive (ERA5 not yet published) are dropped,
//     because their soil-moisture layers are measured at different depths.
const mixed = clean.filter((r) => r.weather_source && r.weather_source !== 'open-meteo-era5');
drop('not_on_era5_reanalysis', mixed, (r) => `${r.event_id} ${r.sample_type} ${r.date} ${r.weather_source}`);
clean = clean.filter((r) => !mixed.includes(r));

// 12. Random nearby spots are set aside. The bias check (experiments.mjs) showed that distance to a road ALONE
//     separates landslides from random spots almost perfectly — news reports landslides that hit roads. They are
//     replaced by road-matched spots (build_controls.mjs) and kept only in bias_check_random_spots.csv.
const cols = Object.keys(rows[0]);
const randomSpots = clean.filter((r) => r.sample_type === 'nearby_place_same_date');
writeCsv(path.join(DATA, 'bias_check_random_spots.csv'), randomSpots, cols);
drop('random_nearby_spot (road-biased; kept only for the bias check)', randomSpots, (r) => `${r.event_id} ${r.date}`);
clean = clean.filter((r) => r.sample_type !== 'nearby_place_same_date');

// ---- Output ----
writeCsv(path.join(DATA, 'clean.csv'), clean, cols);
const pos = clean.filter((r) => r.label === 1);
report.output = {
  rows: clean.length, landslides: pos.length, non_landslides: clean.length - pos.length,
  by_type: clean.reduce((m, r) => ((m[r.sample_type] = (m[r.sample_type] || 0) + 1), m), {}),
  years: [...new Set(pos.map((r) => r.date.slice(0, 4)))].sort().join(','),
  by_state: pos.reduce((m, r) => ((m[r.state || '?'] = (m[r.state || '?'] || 0) + 1), m), {}),
};
fs.writeFileSync(path.join(DATA, 'cleaning_report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ removed_events: report.removed_events, removed_rows: report.removed, output: report.output }, null, 2));
