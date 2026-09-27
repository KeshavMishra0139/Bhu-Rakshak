// Which factors help — and is the model biased? Output: ml/models/experiments.md, selected_features.json
//   node ml/experiments.mjs
//
// 1. Year-by-year backtest ("rolling origin"): for each test year Y (2012–2016), train only on landslides before Y,
//    test on Y, pool the results. Settings are chosen on validation years only.
// 2. Bias checks:
//    • Reporting bias: can DISTANCE TO A ROAD alone tell landslides from random nearby spots? If yes, the random
//      spots are biased (news reports road landslides). Road-matched spots (build_controls.mjs) should remove this,
//      so "where" is also scored against road-matched spots.
//    • Past-landslide counts are tested but never used: they come from news reports and grow over time.
//    • Region fairness: results per region, and a "new area" test — train without a region, test on it.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, ML_ROOT, parseCsv } from './lib.mjs';
import { trainGBDT, predictProba } from './gbdt.mjs';
import { rocAuc, atThreshold } from './metrics.mjs';

const BASE = {
  rain: ['rain_d0', 'rain_d1', 'rain_3d', 'rain_7d', 'rain_15d', 'rain_30d', 'api_30d', 'max_1h_48h', 'rainy_days_7d', 'power_rain_d0', 'power_rain_3d', 'power_rain_7d', 'power_rain_30d'],
  soil_temperature_snow: ['sm_top', 'sm_mid', 'sm_deep', 'tmax_d0', 'tmin_d0', 'snowfall_7d'],
  earthquakes: ['quake_max_mmi_30d', 'quake_count_300km_30d', 'quake_max_mag_300km_30d'],
  terrain: ['elev_m', 'slope_deg', 'northness', 'eastness', 'curvature', 'relief_1km'],
};
const EXTRA = {
  rain_vs_normal: ['clim_month_mm_day', 'clim_annual_mm_day', 'rain_3d_vs_normal', 'rain_7d_vs_normal', 'rain_30d_vs_normal'],
  river: ['dist_major_river_m'],
  vegetation: ['ndvi_before'],
  past_landslides: ['past_landslides_5km', 'past_landslides_15km'],
};
const base = Object.values(BASE).flat();
const CANDIDATES = {
  'Rain only': BASE.rain,
  'v1 (rain, soil, snow, quakes, terrain)': base,
  'v1 + rain vs normal': [...base, ...EXTRA.rain_vs_normal],
  'v1 + river distance': [...base, ...EXTRA.river],
  'v1 + vegetation': [...base, ...EXTRA.vegetation],
  'v1 + rain vs normal + vegetation': [...base, ...EXTRA.rain_vs_normal, ...EXTRA.vegetation],
  'v1 + all new (no past landslides, no road distance)': [...base, ...EXTRA.rain_vs_normal, ...EXTRA.river, ...EXTRA.vegetation],
};
const BIAS_ONLY = {
  'Bias check: + past landslides (never used)': [...base, ...EXTRA.past_landslides],
  'Bias check: + road distance (never used)': [...base, 'dist_road_m'],
};
const CONFIGS = [
  { maxDepth: 2, minLeaf: 20, learningRate: 0.03, colSample: 0.7 },
  { maxDepth: 2, minLeaf: 10, learningRate: 0.05, colSample: 0.8 },
  { maxDepth: 3, minLeaf: 15, learningRate: 0.03, colSample: 0.7, lambda: 5 },
];
const REGIONS = {
  'Sikkim & Darjeeling hills': ['Sikkim', 'West Bengal'],
  'Assam & Meghalaya': ['Assam', 'Meghalaya'],
  'Nagaland, Manipur, Mizoram, Tripura': ['Nagaland', 'Manipur', 'Mizoram', 'Tripura'],
  'Arunachal Pradesh': ['Arunachal Pradesh'],
};

const num = (v) => (v === '' || v == null ? null : Number(v));
const raw = parseCsv(fs.readFileSync(path.join(DATA, 'clean.csv'), 'utf8'));
const allCols = [...new Set([...Object.values(CANDIDATES), ...Object.values(BIAS_ONLY)].flat())];
const missingCols = allCols.filter((c) => !(c in raw[0]));
if (missingCols.length) { console.error('clean.csv lacks', missingCols.join(', '), '— run build_controls, build_extra, clean first'); process.exit(1); }
const toRow = (r) => ({ ...r, label: +r.label, ...Object.fromEntries([...allCols, 'dist_road_m'].map((c) => [c, num(r[c])])) });
const rows = raw.map(toRow);
// Random nearby spots are NOT in clean.csv (road-biased); loaded only for the bias section.
const randomSpots = parseCsv(fs.readFileSync(path.join(DATA, 'bias_check_random_spots.csv'), 'utf8')).map(toRow);
const biasRows = [...rows, ...randomSpots];
const eventOf = new Map(rows.filter((r) => r.label === 1).map((r) => [r.event_id, r]));
const eventDate = (r) => eventOf.get(r.event_id).date;
const yearOf = (r) => eventDate(r).slice(0, 4);
const regionOf = (r) => Object.entries(REGIONS).find(([, st]) => st.includes(eventOf.get(r.event_id).state))?.[0] || 'Unknown state';
const TEST_YEARS = ['2012', '2013', '2014', '2015', '2016'];

function fitBest(train, feats) {
  const sorted = [...train].sort((a, b) => eventDate(a).localeCompare(eventDate(b)));
  const cut = Math.floor(sorted.length * 0.8);
  const fit = sorted.slice(0, cut); const val = sorted.slice(cut);
  const X = (s) => s.map((r) => feats.map((f) => r[f])); const Y = (s) => s.map((r) => r.label);
  let best = null;
  for (const cfg of CONFIGS) {
    const m = trainGBDT(X(fit), Y(fit), cfg, X(val), Y(val));
    const auc = rocAuc(Y(val), X(val).map((x) => predictProba(m, x)));
    if (!best || auc > best.auc) best = { m, auc, cfg };
  }
  const normal = train.filter((r) => r.sample_type === 'same_place_other_date').map((r) => predictProba(best.m, feats.map((f) => r[f]))).sort((a, b) => a - b);
  return { model: best.m, ops: normal[Math.floor(normal.length * 0.9)], cfg: best.cfg };
}
const aucFor = (pool, type) => { const i = pool.map((x, k) => (x.r.sample_type === 'event' || x.r.sample_type === type ? k : -1)).filter((k) => k >= 0); return rocAuc(i.map((k) => pool[k].r.label), i.map((k) => pool[k].p)); };

function backtest(feats) {
  const pool = [];
  const perYear = {};
  for (const Yr of TEST_YEARS) {
    const train = rows.filter((r) => yearOf(r) < Yr);
    const test = rows.filter((r) => yearOf(r) === Yr);
    if (!test.some((r) => r.label) || !train.length) continue;
    const { model, ops } = fitBest(train, feats);
    const p = test.map((r) => predictProba(model, feats.map((f) => r[f])));
    perYear[Yr] = rocAuc(test.map((r) => r.label), p);
    test.forEach((r, i) => pool.push({ r, p: p[i], hit: p[i] >= ops ? 1 : 0 }));
  }
  const ops = atThreshold(pool.map((x) => x.r.label), pool.map((x) => x.hit), 0.5);
  return {
    pool, perYear, auc: rocAuc(pool.map((x) => x.r.label), pool.map((x) => x.p)),
    when: aucFor(pool, 'same_place_other_date'), whereRoad: aucFor(pool, 'roadside_same_date'),
    recall: ops.recall, far: ops.false_alarm_rate, precision: ops.precision,
  };
}

// ---------- 1. Factor comparison ----------
const results = [];
for (const [name, feats] of Object.entries({ ...CANDIDATES, ...BIAS_ONLY })) {
  results.push({ name, n: feats.length, feats, biasOnly: name in BIAS_ONLY, ...backtest(feats) });
  console.log(name, results.at(-1).auc.toFixed(3));
}
// Pick the factor set with the best pooled backtest AUC; a set with more factors must win by ≥ 0.01 to be chosen.
const eligible = results.filter((r) => !r.biasOnly && r.name !== 'Rain only').sort((a, b) => a.n - b.n);
let chosen = eligible[0];
for (const r of eligible.slice(1)) if (r.auc > chosen.auc + 0.01) chosen = r;
const rainOnly = results.find((r) => r.name === 'Rain only');

// ---------- 2a. Reporting bias: distance to road alone ----------
function roadOnlyAuc(type) {
  const sub = biasRows.filter((r) => (r.sample_type === 'event' || r.sample_type === type) && r.dist_road_m != null);
  return { auc: rocAuc(sub.map((r) => r.label), sub.map((r) => -r.dist_road_m)), n: sub.length }; // closer to road ⇒ "more landslide"
}
const roadBias = { random: roadOnlyAuc('nearby_place_same_date'), matched: roadOnlyAuc('roadside_same_date') };

// ---------- 2b. Data balance table ----------
const med = (a) => { const v = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
const TYPES = ['event', 'same_place_other_date', 'nearby_place_same_date', 'roadside_same_date'];
const balance = ['dist_road_m', 'elev_m', 'slope_deg', 'relief_1km', 'rain_3d', 'past_landslides_5km'].map((c) => [c, ...TYPES.map((t) => med(biasRows.filter((r) => r.sample_type === t).map((r) => r[c])))]);
// Past-landslide counts grow with calendar time — a leak, not physics.
const byYear = {};
for (const r of rows.filter((x) => x.sample_type === 'same_place_other_date')) (byYear[r.date.slice(0, 4)] ||= []).push(r.past_landslides_15km);
const pastTrend = Object.entries(byYear).sort().map(([y, v]) => `${y}: ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)}`).join(' · ');

// ---------- 2c. Region fairness (chosen set) ----------
const regionRows = Object.keys(REGIONS).map((reg) => {
  const pool = chosen.pool.filter((x) => regionOf(x.r) === reg);
  const n = pool.filter((x) => x.r.label).length;
  const y = pool.map((x) => x.r.label);
  const ops = atThreshold(y, pool.map((x) => x.hit), 0.5);
  return { reg, n, auc: n >= 5 ? rocAuc(y, pool.map((x) => x.p)) : NaN, recall: ops.recall, far: ops.false_alarm_rate };
});
// New-area test: train on every other region (all years), test on this one.
const newArea = Object.keys(REGIONS).map((reg) => {
  const train = rows.filter((r) => regionOf(r) !== reg);
  const test = rows.filter((r) => regionOf(r) === reg);
  if (test.filter((r) => r.label).length < 5) return { reg, auc: NaN, n: test.filter((r) => r.label).length };
  const { model } = fitBest(train, chosen.feats);
  const p = test.map((r) => predictProba(model, chosen.feats.map((f) => r[f])));
  const pool = test.map((r, i) => ({ r, p: p[i] }));
  return { reg, n: test.filter((r) => r.label).length, auc: rocAuc(test.map((r) => r.label), p), when: aucFor(pool, 'same_place_other_date'), whereRoad: aucFor(pool, 'roadside_same_date') };
});

// ---------- Report ----------
const f = (v) => (Number.isFinite(v) ? v.toFixed(3) : '–');
const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : '–');
const nTest = rows.filter((r) => r.label && TEST_YEARS.includes(yearOf(r))).length;
const md = `# Which factors help — and is the model biased?

Data: \`ml/data/clean.csv\` — ${rows.filter((r) => r.label).length} landslides, ${rows.filter((r) => !r.label).length} non-landslide samples
(${['same_place_other_date', 'roadside_same_date'].map((t) => `${rows.filter((r) => r.sample_type === t).length} ${t}`).join(', ')}); ${randomSpots.length} random nearby spots kept aside for the bias check only.

## 1. Year-by-year backtest (train on earlier years only, test on 2012–2016, pooled: ${nTest} test landslides)

| Factors | # | ROC AUC | When | Where (road-matched) | Caught | False alarms | Warnings right | AUC by year |
|---|---|---|---|---|---|---|---|---|
${results.map((r) => `| ${r.biasOnly ? '_' + r.name + '_' : r.name === chosen.name ? '**' + r.name + ' ← chosen**' : r.name} | ${r.n} | ${f(r.auc)} | ${f(r.when)} | ${f(r.whereRoad)} | ${pct(r.recall)} | ${pct(r.far)} | ${pct(r.precision)} | ${Object.entries(r.perYear).map(([y, v]) => `${y}: ${f(v)}`).join(' · ')} |`).join('\n')}

- **When**: same place, landslide day vs an ordinary day. **Where**: same day, landslide spot vs a **road-matched** spot
  8–40 km away (same distance from a major road, so an equal chance of being reported in the news).
- Random nearby spots are not used at all (see bias checks): they made "where" look far better than it is.
- Road distance and past-landslide counts are never used as factors (both carry the news-coverage bias); rows marked
  _Bias check_ show what they would do.
- Caught / false alarms use the operational threshold (~1 warning per 10 ordinary days in the training years).
- Chosen = best pooled AUC; a set with more factors had to win by ≥ 0.01. With ~${nTest} test landslides, differences
  under ~0.03 are within noise.

## 2. Bias checks

**Reporting bias (news covers road landslides).** Using *only* "how close to a major road":
- landslides vs random nearby spots: AUC **${f(roadBias.random.auc)}** (${roadBias.random.n} rows)
- landslides vs road-matched spots: AUC **${f(roadBias.matched.auc)}** (${roadBias.matched.n} rows)

${roadBias.random.auc > 0.6 ? 'Road distance alone separates landslides from random spots — clear evidence of reporting bias in random comparisons. ' : ''}Against road-matched spots it should be ≈ 0.5 (no signal), which means the matched comparison is fair.
Random spots were therefore removed; "where" is measured only against road-matched spots.

**Balance of the samples (medians):**

| | Landslide | Same place, other day | Random nearby spot | Road-matched spot |
|---|---|---|---|---|
${balance.map(([c, ...v]) => `| ${c} | ${v.map((x) => (x == null ? '–' : x.toFixed(1))).join(' | ')} |`).join('\n')}

**Past-landslide counts are NOT used.** They come from the same news reports (they mark where reporters go), and they
grow with calendar time — average count near "ordinary day" samples by year: ${pastTrend}. A model would partly learn
the date. Adding them anyway: backtest AUC ${f(results.find((r) => r.biasOnly).auc)} vs ${f(results.find((r) => r.name.startsWith('v1 (')).auc)} without — shown only as a check.

**Region fairness (chosen factors, year-by-year backtest):**

| Region | Test landslides | AUC | Caught | False alarms |
|---|---|---|---|---|
${regionRows.map((r) => `| ${r.reg} | ${r.n} | ${f(r.auc)} | ${pct(r.recall)} | ${pct(r.far)} |`).join('\n')}

**New-area test (train on the other regions, test on this one — all years):**

| Region never seen in training | Landslides | AUC | When | Where (road-matched) |
|---|---|---|---|---|
${newArea.map((r) => `| ${r.reg} | ${r.n} | ${f(r.auc)} | ${f(r.when)} | ${f(r.whereRoad)} |`).join('\n')}

Other safeguards already in the pipeline: non-landslide samples near ANY reported landslide (any country, any record)
removed; one weather product (ERA5) for every row; flat-ground events (geocoding errors) removed; month and
location are never given to the model; tests are always on later years than training.
`;
fs.writeFileSync(path.join(ML_ROOT, 'models', 'experiments.md'), md);
fs.writeFileSync(path.join(ML_ROOT, 'models', 'selected_features.json'), JSON.stringify({ set: chosen.name, features: chosen.feats, backtest_auc: +chosen.auc.toFixed(3), rain_only_auc: +rainOnly.auc.toFixed(3) }, null, 2));
console.log(md);
