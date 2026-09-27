// Evaluation metrics shared by train.mjs and experiments.mjs.

/** ROC AUC (probability a random landslide scores above a random non-landslide; ties count half). */
export function rocAuc(y, p) {
  const pairs = y.map((v, i) => [p[i], v]).sort((a, b) => a[0] - b[0]);
  let sumPos = 0; let nPos = 0;
  for (let i = 0; i < pairs.length;) {
    let j = i; while (j < pairs.length && pairs[j][0] === pairs[i][0]) j++;
    const avg = (i + j + 1) / 2;
    for (let k = i; k < j; k++) if (pairs[k][1] === 1) { sumPos += avg; nPos++; }
    i = j;
  }
  const nNeg = pairs.length - nPos;
  return nPos && nNeg ? (sumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg) : NaN;
}

export function avgPrecision(y, p) {
  const o = y.map((v, i) => [p[i], v]).sort((a, b) => b[0] - a[0]);
  const P = y.reduce((a, b) => a + b, 0);
  let tp = 0; let ap = 0;
  o.forEach(([, v], i) => { if (v) { tp++; ap += tp / (i + 1); } });
  return ap / P;
}

export function atThreshold(y, p, t) {
  let tp = 0; let fp = 0; let tn = 0; let fn = 0;
  y.forEach((v, i) => { const hit = p[i] >= t; if (hit && v) tp++; else if (hit) fp++; else if (v) fn++; else tn++; });
  const precision = tp / (tp + fp || 1); const recall = tp / (tp + fn || 1);
  return { tp, fp, tn, fn, precision, recall, f1: (2 * precision * recall) / (precision + recall || 1), false_alarm_rate: fp / (fp + tn || 1), accuracy: (tp + tn) / y.length };
}

export const brier = (y, p) => y.reduce((a, v, i) => a + (p[i] - v) ** 2, 0) / y.length;

/** Threshold chosen on validation data: best F1 while catching at least 70% of landslides. */
export function pickThreshold(y, p) {
  let best = { t: 0.5, f1: -1 };
  for (let t = 0.05; t <= 0.95; t += 0.01) {
    const m = atThreshold(y, p, t);
    if (m.recall >= 0.7 && m.f1 > best.f1) best = { t: +t.toFixed(2), f1: m.f1 };
  }
  return best.t;
}
