// Gradient-boosted decision trees for binary classification (log-loss), dependency-free.
// Small and explainable: shallow trees, quantile-binned splits, learned direction for missing values.
// The saved model is plain JSON, so the Node server can score it directly (see predictProba).

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/** Candidate split thresholds per feature: up to `bins` quantiles of the non-missing values. */
function thresholds(X, j, bins) {
  const v = [];
  for (const row of X) if (row[j] != null && Number.isFinite(row[j])) v.push(row[j]);
  v.sort((a, b) => a - b);
  const out = new Set();
  for (let b = 1; b < bins; b++) {
    const i = Math.floor((b / bins) * v.length);
    if (i > 0 && i < v.length && v[i] !== v[i - 1]) out.add((v[i] + v[i - 1]) / 2);
  }
  return [...out];
}

function buildTree(X, g, h, idx, feats, cuts, depth, p) {
  let G = 0; let H = 0;
  for (const i of idx) { G += g[i]; H += h[i]; }
  const leaf = { value: -G / (H + p.lambda) };
  if (depth >= p.maxDepth || idx.length < 2 * p.minLeaf) return leaf;
  const parentScore = (G * G) / (H + p.lambda);
  let best = null;
  for (const j of feats) {
    // Missing values: accumulate separately, then try sending them left or right.
    let Gm = 0; let Hm = 0; let nm = 0;
    const present = [];
    for (const i of idx) {
      const x = X[i][j];
      if (x == null || !Number.isFinite(x)) { Gm += g[i]; Hm += h[i]; nm++; } else present.push(i);
    }
    present.sort((a, b) => X[a][j] - X[b][j]);
    let Gl = 0; let Hl = 0; let nl = 0; let k = 0;
    for (const t of cuts[j]) {
      while (k < present.length && X[present[k]][j] <= t) { Gl += g[present[k]]; Hl += h[present[k]]; nl++; k++; }
      for (const missLeft of [true, false]) {
        const GL = Gl + (missLeft ? Gm : 0); const HL = Hl + (missLeft ? Hm : 0); const NL = nl + (missLeft ? nm : 0);
        const GR = G - GL; const HR = H - HL; const NR = idx.length - NL;
        if (NL < p.minLeaf || NR < p.minLeaf || HL < p.minChildWeight || HR < p.minChildWeight) continue;
        const gain = (GL * GL) / (HL + p.lambda) + (GR * GR) / (HR + p.lambda) - parentScore;
        if (gain > p.minGain && (!best || gain > best.gain)) best = { j, t, missLeft, gain };
      }
    }
  }
  if (!best) return leaf;
  const L = []; const R = [];
  for (const i of idx) {
    const x = X[i][best.j];
    const goLeft = x == null || !Number.isFinite(x) ? best.missLeft : x <= best.t;
    (goLeft ? L : R).push(i);
  }
  return {
    f: best.j, t: best.t, m: best.missLeft ? 1 : 0, gain: best.gain,
    l: buildTree(X, g, h, L, feats, cuts, depth + 1, p),
    r: buildTree(X, g, h, R, feats, cuts, depth + 1, p),
  };
}

const treeValue = (node, row) => {
  while (node.f !== undefined) {
    const x = row[node.f];
    node = (x == null || !Number.isFinite(x) ? node.m === 1 : x <= node.t) ? node.l : node.r;
  }
  return node.value;
};

function addGain(node, acc) {
  if (node.f === undefined) return;
  acc[node.f] += node.gain;
  addGain(node.l, acc); addGain(node.r, acc);
}

/**
 * Train. X: array of rows (arrays of numbers or null), y: 0/1.
 * Early stopping on (Xv, yv) if given. Seeded for reproducibility.
 */
export function trainGBDT(X, y, opts = {}, Xv = null, yv = null) {
  const p = {
    nTrees: 400, learningRate: 0.05, maxDepth: 3, minLeaf: 8, minChildWeight: 1, lambda: 1, minGain: 1e-6,
    rowSample: 0.8, colSample: 0.8, bins: 32, earlyStop: 40, seed: 7, ...opts,
  };
  let s = p.seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const nF = X[0].length;
  const cuts = Array.from({ length: nF }, (_, j) => thresholds(X, j, p.bins));
  const posRate = y.reduce((a, b) => a + b, 0) / y.length;
  const base = Math.log(posRate / (1 - posRate));
  const F = new Array(X.length).fill(base);
  const Fv = Xv ? new Array(Xv.length).fill(base) : null;
  const trees = [];
  let bestLoss = Infinity; let bestN = 0;
  for (let m = 0; m < p.nTrees; m++) {
    const g = new Array(X.length); const h = new Array(X.length);
    for (let i = 0; i < X.length; i++) { const pr = sigmoid(F[i]); g[i] = pr - y[i]; h[i] = Math.max(pr * (1 - pr), 1e-6); }
    const idx = []; for (let i = 0; i < X.length; i++) if (rand() < p.rowSample) idx.push(i);
    const feats = []; for (let j = 0; j < nF; j++) if (rand() < p.colSample) feats.push(j);
    const tree = buildTree(X, g, h, idx, feats.length ? feats : [...Array(nF).keys()], cuts, 0, p);
    trees.push(tree);
    for (let i = 0; i < X.length; i++) F[i] += p.learningRate * treeValue(tree, X[i]);
    if (Xv) {
      let loss = 0;
      for (let i = 0; i < Xv.length; i++) {
        Fv[i] += p.learningRate * treeValue(tree, Xv[i]);
        const pr = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(Fv[i])));
        loss -= yv[i] * Math.log(pr) + (1 - yv[i]) * Math.log(1 - pr);
      }
      loss /= Xv.length;
      if (loss < bestLoss - 1e-6) { bestLoss = loss; bestN = m + 1; } else if (m + 1 - bestN >= p.earlyStop) break;
    }
  }
  const kept = Xv ? trees.slice(0, bestN) : trees;
  const importance = new Array(nF).fill(0);
  for (const t of kept) addGain(t, importance);
  return { kind: 'gbdt-logloss', base, learningRate: p.learningRate, trees: kept, params: p, importance };
}

/** Probability of a landslide for one row (same feature order as training). */
export function predictProba(model, row) {
  let f = model.base;
  for (const t of model.trees) f += model.learningRate * treeValue(t, row);
  return sigmoid(f);
}
