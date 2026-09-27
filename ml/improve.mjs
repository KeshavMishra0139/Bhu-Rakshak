// Can we do better? Same bias-free, year-by-year backtest as experiments.mjs, scored on exactly the same test
// rows (precisely located landslides 2012–2016 + their same-place ordinary days + road-matched spots), comparing:
//   A  current model (one boosted-tree model, chosen factors)
//   B  + monotone constraints (more rain / wetter soil / stronger shaking can never LOWER the risk)
//   C  + averaging 7 models trained on different random subsets ("bagging")
//   D  two parts: a WHEN model (weather only) trained on ALL landslides incl. 10–25 km-located ones and a WHERE
//      model (terrain etc.) trained on precisely located ones vs road-matched spots; scores added on the log-odds scale
//   E  D + monotone + bagging
//   F  WHEN part alone (weather only, all landslides)
//   node ml/improve.mjs     → ml/models/improve.md
import fs from 'node:fs';
import path from 'node:path';
import { DATA, ML_ROOT, parseCsv } from './lib.mjs';
import { trainGBDT, predictProba } from './gbdt.mjs';
import { rocAuc, atThreshold } from './metrics.mjs';

const selected = JSON.parse(fs.readFileSync(path.join(ML_ROOT, 'models', 'selected_features.json'), 'utf8')).features;
const WEATHER = selected.filter((f) => /rain|api_|max_1h|sm_|tmax|tmin|snow|quake|clim_/.test(f));
const PLACE = ['elev_m', 'slope_deg', 'northness', 'eastness', 'curvature', 'relief_1km', 'dist_major_river_m', 'ndvi_before'];
// +1 = risk may only rise with this factor. Terrain is left free (e.g. very steep rock faces shed less soil).
const UP = /^(rain_|power_rain_|api_30d|max_1h_48h|rainy_days_7d|sm_|quake_max_mmi|rain_\dd_vs_normal|rain_30d_vs_normal)/;
const mono = (feats) => feats.map((f) => (UP.test(f) ? 1 : 0));
const CONFIGS = [
  { maxDepth: 2, minLeaf: 20, learningRate: 0.03, colSample: 0.7 },
  { maxDepth: 2, minLeaf: 10, learningRate: 0.05, colSample: 0.8 },
  { maxDepth: 3, minLeaf: 15, learningRate: 0.03, colSample: 0.7, lambda: 5 },
  { maxDepth: 3, minLeaf: 8, learningRate: 0.05, colSample: 0.8 },
];

const num = (v) => (v === '' || v == null ? null : Number(v));
const load = (file) => parseCsv(fs.readFileSync(path.join(DATA, file), 'utf8')).map((r) => ({ ...r, label: +r.label, ...Object.fromEntries([...new Set([...selected, ...PLACE])].map((c) => [c, num(r[c])])) }));
const precise = load('clean.csv');
const all = load('clean_all.csv'); // + landslides located to 10–25 km
const dateOf = (rows) => new Map(rows.filter((r) => r.label === 1).map((r) => [r.event_id, r.date]));
const dPrecise = dateOf(precise); const dAll = dateOf(all);
const yearP = (r) => dPrecise.get(r.event_id).slice(0, 4);
const yearA = (r) => dAll.get(r.event_id).slice(0, 4);
const TEST_YEARS = ['2012', '2013', '2014', '2015', '2016'];
const logit = (p) => Math.log(Math.max(1e-6, p) / Math.max(1e-6, 1 - p));

/** Train on `train` (time-ordered 80/20 split for early stopping + choosing settings); optional monotone and bagging. */
function fit(train, feats, { monotone = false, bags = 1, dateMap }) {
  const sorted = [...train].sort((a, b) => dateMap.get(a.event_id).localeCompare(dateMap.get(b.event_id)));
  const cut = Math.floor(sorted.length * 0.8);
  const A = sorted.slice(0, cut); const V = sorted.slice(cut);
  const X = (s) => s.map((r) => feats.map((f) => r[f])); const Y = (s) => s.map((r) => r.label);
  const extra = monotone ? { monotone: mono(feats) } : {};
  let best = null;
  for (const cfg of CONFIGS) {
    const m = trainGBDT(X(A), Y(A), { ...cfg, ...extra }, X(V), Y(V));
    const auc = rocAuc(Y(V), X(V).map((x) => predictProba(m, x)));
    if (!best || auc > best.auc) best = { cfg, auc, n: m.trees.length };
  }
  // Final: retrain on all training rows with the chosen settings and tree count; bagging = several seeds.
  const models = Array.from({ length: bags }, (_, b) => trainGBDT(X(train), Y(train), { ...best.cfg, ...extra, nTrees: Math.max(10, best.n), earlyStop: Infinity, seed: 7 + b * 101, rowSample: bags > 1 ? 0.7 : 0.8 }));
  return (row) => models.reduce((a, m) => a + predictProba(m, feats.map((f) => row[f])), 0) / models.length;
}

function variant(name, build) {
  const pool = [];
  for (const Y of TEST_YEARS) {
    const test = precise.filter((r) => yearP(r) === Y);
    if (!test.some((r) => r.label)) continue;
    const score = build(Y);
    // Operational threshold from ordinary days in the (precise) training years: ~1 warning per 10 ordinary days.
    const normal = precise.filter((r) => yearP(r) < Y && r.sample_type === 'same_place_other_date').map(score).sort((a, b) => a - b);
    const ops = normal[Math.floor(normal.length * 0.9)];
    for (const r of test) { const s = score(r); pool.push({ r, s, hit: s >= ops ? 1 : 0 }); }
  }
  const auc = (type) => { const i = pool.filter((x) => x.r.sample_type === 'event' || !type || x.r.sample_type === type); return rocAuc(i.map((x) => x.r.label), i.map((x) => x.s)); };
  const o = atThreshold(pool.map((x) => x.r.label), pool.map((x) => x.hit), 0.5);
  const res = { name, auc: auc(), when: auc('same_place_other_date'), where: auc('roadside_same_date'), recall: o.recall, far: o.false_alarm_rate, precision: o.precision };
  console.log(name.padEnd(58), res.auc.toFixed(3), res.when.toFixed(3), res.where.toFixed(3));
  return res;
}

const single = (opts) => (Y) => fit(precise.filter((r) => yearP(r) < Y), selected, { ...opts, dateMap: dPrecise });
const twoPart = (opts) => (Y) => {
  // WHEN: landslide day vs ordinary day at the same place, weather only, ALL landslides (incl. 10–25 km located).
  const whenRows = all.filter((r) => yearA(r) < Y && r.sample_type !== 'roadside_same_date');
  const when = fit(whenRows, WEATHER, { ...opts, dateMap: dAll });
  // WHERE: landslide spot vs road-matched spot on the same day, place factors only, precisely located landslides.
  const whereRows = precise.filter((r) => yearP(r) < Y && r.sample_type !== 'same_place_other_date');
  const where = fit(whereRows, PLACE, { ...opts, monotone: false, dateMap: dPrecise });
  return (row) => 1 / (1 + Math.exp(-(logit(when(row)) + logit(where(row)))));
};
const whenOnly = (opts) => (Y) => fit(all.filter((r) => yearA(r) < Y && r.sample_type !== 'roadside_same_date'), WEATHER, { ...opts, dateMap: dAll });

console.log(`precise: ${precise.filter((r) => r.label).length} landslides · all: ${all.filter((r) => r.label).length} landslides · weather factors ${WEATHER.length}, place factors ${PLACE.length}`);
console.log('variant'.padEnd(58), 'AUC   when  where');
const results = [
  variant('A  current (one model, chosen factors)', single({})),
  variant('B  + monotone constraints', single({ monotone: true })),
  variant('C  + bagging (7 models)', single({ bags: 7 })),
  variant('B+C  monotone + bagging', single({ monotone: true, bags: 7 })),
  variant('D  two parts: WHEN (all landslides) + WHERE (precise)', twoPart({})),
  variant('E  two parts + monotone + bagging', twoPart({ monotone: true, bags: 7 })),
  variant('F  WHEN part only (weather, all landslides)', whenOnly({})),
  variant('G  WHEN part only + monotone + bagging', whenOnly({ monotone: true, bags: 7 })),
];

const f = (v) => (Number.isFinite(v) ? v.toFixed(3) : '–');
const pct = (v) => `${(v * 100).toFixed(0)}%`;
const md = `# Improving the model — same bias-free backtest, same test rows

Test: precisely located landslides 2012–2016 (${precise.filter((r) => r.label && TEST_YEARS.includes(yearP(r))).length}) with their ordinary days and road-matched spots; every model trained only on earlier years.
"All landslides" adds ${all.filter((r) => r.label).length - precise.filter((r) => r.label).length} landslides located to 10–25 km (used only for the weather-based WHEN part).

| Variant | ROC AUC | When | Where (road-matched) | Caught | False alarms | Warnings right |
|---|---|---|---|---|---|---|
${results.map((r) => `| ${r.name} | ${f(r.auc)} | ${f(r.when)} | ${f(r.where)} | ${pct(r.recall)} | ${pct(r.far)} | ${pct(r.precision)} |`).join('\n')}

Caught / false alarms at ~1 warning per 10 ordinary days (threshold from the training years). Differences under ~0.03 are within noise.
`;
fs.writeFileSync(path.join(ML_ROOT, 'models', 'improve.md'), md);
console.log(md);
