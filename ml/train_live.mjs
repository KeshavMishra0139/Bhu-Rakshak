// Train the model the website runs ("live model").
//   node ml/train_live.mjs   → ml/models/landslide-live-v1.json, ml/models/live_model.md
//
// Differences from train.mjs, all forced by what the website can actually get every day:
//   • No NASA POWER rain (published 2–3 days late) and no soil-moisture layers (the live forecast feed measures
//     different depths than the ERA5 data the model learned from). check_shift.mjs showed the live rain feed
//     itself matches ERA5 closely (ratio ≈ 0.98, 3-day correlation ≈ 0.99), so rain factors carry over.
//   • 7 models averaged ("bagging") — the steadiest variant in improve.mjs.
// It is evaluated with the same bias-free, year-by-year backtest before training the final version on all years.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA, ML_ROOT, parseCsv } from './lib.mjs';
import { trainGBDT, predictProba } from './gbdt.mjs';
import { rocAuc, atThreshold } from './metrics.mjs';

const selected = JSON.parse(fs.readFileSync(path.join(ML_ROOT, 'models', 'selected_features.json'), 'utf8')).features;
export const LIVE_FEATURES = selected.filter((f) => !f.startsWith('power_') && !f.startsWith('sm_'));
const BAGS = 7;
const CONFIGS = [
  { maxDepth: 2, minLeaf: 20, learningRate: 0.03, colSample: 0.7 },
  { maxDepth: 2, minLeaf: 10, learningRate: 0.05, colSample: 0.8 },
  { maxDepth: 3, minLeaf: 15, learningRate: 0.03, colSample: 0.7, lambda: 5 },
  { maxDepth: 3, minLeaf: 8, learningRate: 0.05, colSample: 0.8 },
];

const csvText = fs.readFileSync(path.join(DATA, 'clean.csv'), 'utf8');
const num = (v) => (v === '' || v == null ? null : Number(v));
const rows = parseCsv(csvText).map((r) => ({ ...r, label: +r.label, ...Object.fromEntries(selected.map((c) => [c, num(r[c])])) }));
const eventDate = new Map(rows.filter((r) => r.label === 1).map((r) => [r.event_id, r.date]));
const yearOf = (r) => eventDate.get(r.event_id).slice(0, 4);

function fit(train, feats) {
  const sorted = [...train].sort((a, b) => eventDate.get(a.event_id).localeCompare(eventDate.get(b.event_id)));
  const cut = Math.floor(sorted.length * 0.8);
  const A = sorted.slice(0, cut); const V = sorted.slice(cut);
  const X = (s) => s.map((r) => feats.map((f) => r[f])); const Y = (s) => s.map((r) => r.label);
  let best = null;
  for (const cfg of CONFIGS) {
    const m = trainGBDT(X(A), Y(A), cfg, X(V), Y(V));
    const auc = rocAuc(Y(V), X(V).map((x) => predictProba(m, x)));
    if (!best || auc > best.auc) best = { cfg, auc, n: m.trees.length };
  }
  const models = Array.from({ length: BAGS }, (_, b) => trainGBDT(X(train), Y(train), { ...best.cfg, nTrees: Math.max(10, best.n), earlyStop: Infinity, seed: 7 + b * 101, rowSample: 0.7 }));
  return { models, cfg: best.cfg, nTrees: Math.max(10, best.n), score: (row) => models.reduce((a, m) => a + predictProba(m, feats.map((f) => row[f])), 0) / models.length };
}

function backtest(feats) {
  const pool = [];
  for (const Y of ['2012', '2013', '2014', '2015', '2016']) {
    const test = rows.filter((r) => yearOf(r) === Y);
    const train = rows.filter((r) => yearOf(r) < Y);
    const { score } = fit(train, feats);
    const normal = train.filter((r) => r.sample_type === 'same_place_other_date').map(score).sort((a, b) => a - b);
    const ops = normal[Math.floor(normal.length * 0.9)];
    for (const r of test) { const s = score(r); pool.push({ r, s, hit: s >= ops ? 1 : 0 }); }
  }
  const auc = (type) => { const i = pool.filter((x) => x.r.sample_type === 'event' || !type || x.r.sample_type === type); return rocAuc(i.map((x) => x.r.label), i.map((x) => x.s)); };
  const o = atThreshold(pool.map((x) => x.r.label), pool.map((x) => x.hit), 0.5);
  return { auc: auc(), when: auc('same_place_other_date'), where: auc('roadside_same_date'), caught: o.recall, false_alarms: o.false_alarm_rate, warnings_right: o.precision, test_landslides: pool.filter((x) => x.r.label).length };
}

const full = backtest(selected);
const live = backtest(LIVE_FEATURES);
console.log('all chosen factors:', JSON.stringify(full));
console.log('live factors      :', JSON.stringify(live));

// Final live model on all years.
const final = fit(rows, LIVE_FEATURES);
const normal = rows.filter((r) => r.sample_type === 'same_place_other_date').map(final.score).sort((a, b) => a - b);
const opsThreshold = normal[Math.floor(normal.length * 0.9)];
const r3 = (x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(3) : v]));
const card = {
  name: 'bhu-rakshak-landslide-live', version: 'live-v1', created_at: new Date().toISOString(),
  features: LIVE_FEATURES, ops_threshold: +opsThreshold.toFixed(4),
  meaning: 'Relative landslide-likelihood score for one place and one day (trained ~1 landslide : 3 non-landslides) — not a real-world probability. "Elevated" = above the level reached on ~10% of ordinary monsoon days.',
  status: 'EXPERIMENTAL — second opinion for officers only; does not trigger alerts.',
  evaluation: { method: 'Year-by-year backtest 2012–2016, trained only on earlier years; bias-free comparisons (same place other day; road-matched spot)', ...r3(live), with_all_factors: r3(full) },
  training_data: { file: 'ml/data/clean.csv', sha1: crypto.createHash('sha1').update(csvText).digest('hex'), rows: rows.length, landslides: rows.filter((r) => r.label).length, years: '2007–2016, 2026' },
  sources: ['NASA Global Landslide Catalog + hand-checked 2026 reports', 'Open-Meteo (ERA5 for training, forecast API live)', 'NASA POWER climatology', 'USGS / NCS earthquakes', 'AWS Terrain Tiles (SRTM)'],
  config: final.cfg, trees_per_model: final.nTrees,
  models: final.models.map((m) => ({ kind: m.kind, base: m.base, learningRate: m.learningRate, trees: m.trees })),
};
fs.writeFileSync(path.join(ML_ROOT, 'models', 'landslide-live-v1.json'), JSON.stringify(card));
const pct = (v) => `${(v * 100).toFixed(0)}%`;
fs.writeFileSync(path.join(ML_ROOT, 'models', 'live_model.md'), `# Live model (runs on the website)

Factors (${LIVE_FEATURES.length}): ${LIVE_FEATURES.map((f) => `\`${f}\``).join(', ')}.
Left out because the website can't get them the same way every day: NASA POWER rain (2–3 days late) and
soil-moisture layers (different depths in the live feed). 7 models averaged.

| | ROC AUC | When | Where (road-matched) | Caught | False alarms | Warnings right |
|---|---|---|---|---|---|---|
| All chosen factors (not runnable live) | ${full.auc.toFixed(3)} | ${full.when.toFixed(3)} | ${full.where.toFixed(3)} | ${pct(full.caught)} | ${pct(full.false_alarms)} | ${pct(full.warnings_right)} |
| **Live model** | **${live.auc.toFixed(3)}** | ${live.when.toFixed(3)} | ${live.where.toFixed(3)} | ${pct(live.caught)} | ${pct(live.false_alarms)} | ${pct(live.warnings_right)} |

Year-by-year backtest 2012–2016 (${live.test_landslides} test landslides), each year trained only on earlier years.
"Elevated" threshold: ${opsThreshold.toFixed(3)} (reached on ~10% of ordinary monsoon days in the training data).
`);
console.log(`saved live model: ${LIVE_FEATURES.length} factors, ${BAGS} models × ${final.nTrees} trees, elevated ≥ ${opsThreshold.toFixed(3)}`);
