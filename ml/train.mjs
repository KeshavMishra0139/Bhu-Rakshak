// Step 3: train and evaluate the landslide model on ml/data/clean.csv.
//   node ml/train.mjs
// Output: ml/models/landslide-gbdt-v1.json (the model) and ml/models/report.md (how good it is, honestly).
//
// Evaluation is done the strict way:
//   • Time split: train on older landslides, test on the most recent ones — never on days it has seen.
//     Each landslide's non-landslide rows stay in the same split as it (grouped by event).
//   • Compared against a RAIN-ONLY model and a TERRAIN-ONLY model, so we can see what the non-rain factors add.
//   • Factor importance = how much the test score drops when a factor group is scrambled (permutation).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA, ML_ROOT, parseCsv, rng } from './lib.mjs';
import { trainGBDT, predictProba } from './gbdt.mjs';
import { rocAuc, avgPrecision, atThreshold, brier, pickThreshold } from './metrics.mjs';

const ALL_GROUPS = {
  rain: ['rain_d0', 'rain_d1', 'rain_3d', 'rain_7d', 'rain_15d', 'rain_30d', 'api_30d', 'max_1h_48h', 'rainy_days_7d', 'power_rain_d0', 'power_rain_3d', 'power_rain_7d', 'power_rain_30d',
    'clim_month_mm_day', 'clim_annual_mm_day', 'rain_3d_vs_normal', 'rain_7d_vs_normal', 'rain_30d_vs_normal'],
  soil_temperature_snow: ['sm_top', 'sm_mid', 'sm_deep', 'tmax_d0', 'tmin_d0', 'snowfall_7d'],
  earthquakes: ['quake_max_mmi_30d', 'quake_count_300km_30d', 'quake_max_mag_300km_30d'],
  terrain: ['elev_m', 'slope_deg', 'northness', 'eastness', 'curvature', 'relief_1km'],
  river: ['dist_major_river_m'],
  vegetation: ['ndvi_before'],
};
// The factor set picked by the bias-checked year-by-year backtest (experiments.mjs); v1 factors if not run yet.
const selectedFile = path.join(ML_ROOT, 'models', 'selected_features.json');
const SELECTED = fs.existsSync(selectedFile) ? JSON.parse(fs.readFileSync(selectedFile, 'utf8')).features : ['rain', 'soil_temperature_snow', 'earthquakes', 'terrain'].flatMap((g) => ALL_GROUPS[g]).filter((f) => !f.includes('clim') && !f.includes('normal'));
const GROUPS = Object.fromEntries(Object.entries(ALL_GROUPS).map(([g, fs2]) => [g, fs2.filter((f) => SELECTED.includes(f))]).filter(([, v]) => v.length));
const ALL = Object.values(GROUPS).flat();

const csvText = fs.readFileSync(path.join(DATA, 'clean.csv'), 'utf8');
const num = (v) => (v === '' || v == null ? null : Number(v));
const rows = parseCsv(csvText).map((r) => ({ ...r, label: +r.label, ...Object.fromEntries(ALL.map((c) => [c, num(r[c])])) }));

// ---------- Split by event, in time order ----------
const eventDate = new Map(rows.filter((r) => r.label === 1).map((r) => [r.event_id, r.date]));
const groupsInOrder = [...eventDate.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id]) => id);
const cut = (frac) => groupsInOrder[Math.floor(groupsInOrder.length * frac)];
const testFrom = eventDate.get(cut(0.75));
const inTest = (r) => eventDate.get(r.event_id) >= testFrom;
const train = rows.filter((r) => !inTest(r));
const test = rows.filter(inTest);
// Validation (for early stopping) = the latest 20% of the training period.
const trainIds = groupsInOrder.filter((id) => eventDate.get(id) < testFrom);
const valFrom = eventDate.get(trainIds[Math.floor(trainIds.length * 0.8)]);
const fit = train.filter((r) => eventDate.get(r.event_id) < valFrom);
const val = train.filter((r) => eventDate.get(r.event_id) >= valFrom);

const X = (set, feats) => set.map((r) => feats.map((f) => r[f]));
const Y = (set) => set.map((r) => r.label);

// ---------- Train one model on a feature set, evaluate on test ----------
// Candidate settings, from cautious to flexible. Chosen by VALIDATION AUC only — the test years are never used to choose.
const CONFIGS = [
  { maxDepth: 2, minLeaf: 20, learningRate: 0.03, colSample: 0.7 },
  { maxDepth: 2, minLeaf: 10, learningRate: 0.05, colSample: 0.8 },
  { maxDepth: 3, minLeaf: 15, learningRate: 0.03, colSample: 0.7, lambda: 5 },
  { maxDepth: 3, minLeaf: 8, learningRate: 0.05, colSample: 0.8 },
];
function run(name, feats) {
  let best = null;
  for (const cfg of CONFIGS) {
    const m = trainGBDT(X(fit, feats), Y(fit), cfg, X(val, feats), Y(val));
    const auc = rocAuc(Y(val), X(val, feats).map((r) => predictProba(m, r)));
    if (!best || auc > best.auc) best = { m, auc, cfg };
  }
  const model = best.model = best.m;
  const pv = X(val, feats).map((r) => predictProba(model, r));
  const threshold = pickThreshold(Y(val), pv);
  const pt = X(test, feats).map((r) => predictProba(model, r));
  const y = Y(test);
  const sub = (type) => {
    const idx = test.map((r, i) => (r.sample_type === 'event' || r.sample_type === type ? i : -1)).filter((i) => i >= 0);
    return rocAuc(idx.map((i) => y[i]), idx.map((i) => pt[i]));
  };
  // Operational threshold: at most ~10% of ordinary days (same place, no landslide) in the TRAINING years may warn.
  const normal = [...fit, ...val].filter((r) => r.sample_type === 'same_place_other_date').map((r) => predictProba(model, feats.map((f) => r[f]))).sort((a, b) => a - b);
  const opsThreshold = normal[Math.floor(normal.length * 0.9)];
  return {
    name, feats, model, threshold, pt, opsThreshold, config: best.cfg, valAuc: best.auc,
    metrics: {
      roc_auc: rocAuc(y, pt), pr_auc: avgPrecision(y, pt), brier: brier(y, pt),
      when_auc: sub('same_place_other_date'), where_auc: sub('nearby_place_same_date'), where_road_auc: sub('roadside_same_date'),
      at_threshold: atThreshold(y, pt, threshold), at_ops_threshold: atThreshold(y, pt, opsThreshold), trees: model.trees.length,
    },
  };
}

// Logistic regression (linear baseline) with median imputation and standardisation.
function runLogistic(feats) {
  const med = feats.map((f) => { const v = fit.map((r) => r[f]).filter((x) => x != null).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] ?? 0; });
  const prep = (set) => set.map((r) => feats.map((f, j) => r[f] ?? med[j]));
  const Xf = prep(fit);
  const mu = feats.map((_, j) => Xf.reduce((a, r) => a + r[j], 0) / Xf.length);
  const sd = feats.map((_, j) => Math.sqrt(Xf.reduce((a, r) => a + (r[j] - mu[j]) ** 2, 0) / Xf.length) || 1);
  const z = (M) => M.map((r) => r.map((v, j) => (v - mu[j]) / sd[j]));
  const A = z(Xf); const y = Y(fit);
  const w = new Array(feats.length).fill(0); let b = 0;
  for (let it = 0; it < 3000; it++) {
    const gw = new Array(feats.length).fill(0); let gb = 0;
    A.forEach((r, i) => { const p = 1 / (1 + Math.exp(-(b + r.reduce((a, v, j) => a + v * w[j], 0)))); const e = p - y[i]; gb += e; r.forEach((v, j) => { gw[j] += e * v; }); });
    for (let j = 0; j < w.length; j++) w[j] -= 0.1 * (gw[j] / A.length + 0.01 * w[j]);
    b -= 0.1 * gb / A.length;
  }
  const pred = (M) => z(M).map((r) => 1 / (1 + Math.exp(-(b + r.reduce((a, v, j) => a + v * w[j], 0)))));
  const pv = pred(prep(val)); const threshold = pickThreshold(Y(val), pv);
  const pt = pred(prep(test)); const yt = Y(test);
  return { name: 'Logistic regression (all factors)', metrics: { roc_auc: rocAuc(yt, pt), pr_auc: avgPrecision(yt, pt), brier: brier(yt, pt), at_threshold: atThreshold(yt, pt, threshold) }, threshold };
}

console.log(`rows ${rows.length} · train ${fit.length} + validation ${val.length} (landslides before ${testFrom}) · test ${test.length} (landslides from ${testFrom})`);
const full = run('Full model (rain + soil/temperature/snow + earthquakes + terrain)', ALL);
const rainOnly = run('Rain only', GROUPS.rain);
const terrainOnly = run('Terrain only', GROUPS.terrain);
const noTerrain = run('Everything except terrain', ALL.filter((f) => !(GROUPS.terrain || []).includes(f)));
const logistic = runLogistic(ALL);

// ---------- Permutation importance by factor group (full model, test set) ----------
const r = rng(11);
const baseAuc = full.metrics.roc_auc;
const importance = {};
for (const [g, feats] of Object.entries(GROUPS)) {
  let drop = 0;
  for (let rep = 0; rep < 10; rep++) {
    const shuffled = test.map((row) => ({ ...row }));
    const perm = shuffled.map((_, i) => i);
    for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; } // Fisher–Yates
    for (const f of feats) { const vals = test.map((row) => row[f]); shuffled.forEach((row, i) => { row[f] = vals[perm[i]]; }); }
    const p = X(shuffled, ALL).map((row) => predictProba(full.model, row));
    drop += baseAuc - rocAuc(Y(test), p);
  }
  importance[g] = drop / 10;
}
// Per-feature gain importance (top 12).
const gainTotal = full.model.importance.reduce((a, b) => a + b, 0) || 1;
const topFeatures = ALL.map((f, j) => [f, full.model.importance[j] / gainTotal]).sort((a, b) => b[1] - a[1]).slice(0, 12);

// ---------- Rimbi check ----------
const rimbi = test.map((row, i) => ({ row, p: full.pt[i], pRain: rainOnly.pt[i] })).filter((x) => x.row.event_id.startsWith('rimbi'));

// ---------- Final model: retrain on ALL data (fit + val + test), same number of trees ----------
const nTrees = full.model.trees.length;
const finalModel = trainGBDT(X(rows, ALL), Y(rows), { ...full.config, nTrees, earlyStop: Infinity });
const models = path.join(ML_ROOT, 'models');
fs.mkdirSync(models, { recursive: true });
const summary = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(3) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([a, b]) => [a, +(+b).toFixed(3)])) : v]));
fs.writeFileSync(path.join(models, 'landslide-gbdt-v1.json'), JSON.stringify({
  name: 'bhu-rakshak-landslide-gbdt', version: 1, created_at: new Date().toISOString(),
  features: ALL, feature_groups: GROUPS, threshold: full.threshold, ops_threshold: full.opsThreshold, config: full.config,
  note: 'Output is a relative landslide-likelihood score trained with ~1 landslide per 3 non-landslides; it is not a calibrated real-world probability.',
  training_data: { file: 'ml/data/clean.csv', sha1: crypto.createHash('sha1').update(csvText).digest('hex'), rows: rows.length, landslides: rows.filter((x) => x.label).length },
  evaluation: { test_from: testFrom, test_rows: test.length, ...summary(full.metrics) },
  model: finalModel,
}));

// ---------- Report ----------
const pct = (v) => `${(v * 100).toFixed(0)}%`;
const f3 = (v) => (v == null || Number.isNaN(v) ? '–' : v.toFixed(3));
const line = (x) => `| ${x.name} | ${f3(x.metrics.roc_auc)} | ${f3(x.metrics.pr_auc)} | ${x.metrics.when_auc != null ? f3(x.metrics.when_auc) : '–'} | ${x.metrics.where_road_auc != null ? f3(x.metrics.where_road_auc) : '–'} | ${pct(x.metrics.at_threshold.recall)} | ${pct(x.metrics.at_threshold.precision)} | ${pct(x.metrics.at_threshold.false_alarm_rate)} |`;
const c = full.metrics.at_threshold;
const md = `# Landslide model v1 — evaluation report

Factors: ${ALL.length} (${Object.keys(GROUPS).join(', ')}), chosen by the bias-checked backtest in experiments.md.

Generated ${new Date().toISOString().slice(0, 10)} from \`ml/data/clean.csv\` (${rows.length} rows: ${rows.filter((x) => x.label).length} landslides, ${rows.filter((x) => !x.label).length} non-landslides).

**Test set = landslides from ${testFrom} onward (${test.length} rows), never seen in training.** Train/validation used earlier years.

| Model | ROC AUC | PR AUC | "When" AUC | "Where" AUC (road-matched) | Landslides caught | Warnings that were right | False-alarm rate |
|---|---|---|---|---|---|---|---|
${[full, rainOnly, terrainOnly, noTerrain].map(line).join('\n')}
| ${logistic.name} | ${f3(logistic.metrics.roc_auc)} | ${f3(logistic.metrics.pr_auc)} | – | – | ${pct(logistic.metrics.at_threshold.recall)} | ${pct(logistic.metrics.at_threshold.precision)} | ${pct(logistic.metrics.at_threshold.false_alarm_rate)} |

- **ROC AUC**: 0.5 = coin toss, 1.0 = perfect ranking of landslide vs non-landslide.
- **"When" AUC**: same place, landslide day vs another day. **"Where" AUC**: same day, landslide spot vs a road-matched spot 8–40 km away (same distance from a major road, so equally likely to be reported in the news).
- Threshold (${full.threshold}) was chosen on the validation years (best F1 with at least 70% of landslides caught), then applied unchanged to the test years.

## Full model on the test years
Caught **${c.tp} of ${c.tp + c.fn}** landslides (${pct(c.recall)}); raised **${c.tp + c.fp}** warnings, **${c.tp}** correct (${pct(c.precision)}); false-alarm rate **${pct(c.false_alarm_rate)}** of non-landslide cases.

## With the operational threshold (${full.opsThreshold.toFixed(2)}: ~1 warning per 10 ordinary days)
${(() => { const o = full.metrics.at_ops_threshold; return `Caught **${o.tp} of ${o.tp + o.fn}** test landslides (${pct(o.recall)}); false-alarm rate **${pct(o.false_alarm_rate)}**; warnings that were right ${pct(o.precision)}. Rain-only at its own operational threshold: caught ${pct(rainOnly.metrics.at_ops_threshold.recall)}, false alarms ${pct(rainOnly.metrics.at_ops_threshold.false_alarm_rate)}.`; })()}

Chosen settings (by validation AUC ${full.valAuc.toFixed(3)}): \`${JSON.stringify(full.config)}\`, ${full.model.trees.length} trees.

## What the model relies on
Drop in test ROC AUC when a factor group is scrambled (bigger = more important):
${Object.entries(importance).sort((a, b) => b[1] - a[1]).map(([g, v]) => `- **${g.replace(/_/g, ' ')}**: ${v >= 0 ? '−' : '+'}${Math.abs(v).toFixed(3)}`).join('\n')}

Top individual factors (share of tree split gain):
${topFeatures.map(([f, v]) => `- \`${f}\` ${pct(v)}`).join('\n')}

## Rimbi, West Sikkim (2026)
${rimbi.length ? rimbi.map((x) => `- ${x.row.date} ${x.row.sample_type}: full model **${x.p.toFixed(2)}** (${x.p >= full.threshold ? 'WARNING' : 'no warning'}), rain-only ${x.pRain.toFixed(2)}`).join('\n') : '- Not in the test set.'}

## Limits — read before quoting these numbers
- The inventory is news-based (NASA GLC): remote landslides are under-reported, and "no landslide reported" is not proof none happened.
- Non-landslide samples were drawn ~3 per landslide, so the score is a relative likelihood, not a real-world probability.
- Rain comes from 10–50 km weather cells (ERA5, NASA POWER); local cloudbursts are smoothed out.
- Missing factors: geology/rock type, land cover, soil texture, observed satellite rain (IMERG), ground movement (InSAR). Road distance is deliberately not used (news-coverage bias).
- The test set is small, so the numbers have wide uncertainty (roughly ±0.05 AUC).
`;
fs.writeFileSync(path.join(models, 'report.md'), md);
console.log(md);
