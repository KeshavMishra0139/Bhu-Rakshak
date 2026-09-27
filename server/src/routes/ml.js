// EXPERIMENTAL model API — officers only (risk.details). Not used for alerts.
import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { can } from '../auth/permissions.js';
import { HttpError } from '../lib/util.js';
import { latestMl, modelCard, predictionLog } from '../prediction/mlModel.js';

const r = Router();
const officersOnly = (req, _res, next) => (can(req.actor, 'risk.details') ? next() : next(new HttpError(403, 'forbidden')));

r.get('/ml/latest', requireAuth(), officersOnly, (_req, res) => {
  res.json({ model: modelCard(), ...latestMl() });
});

// Full prediction log as CSV, so anyone can check the model against landslides that happened afterwards.
r.get('/ml/log.csv', requireAuth(), officersOnly, (_req, res) => {
  const rows = predictionLog();
  const cols = ['location_id', 'for_date', 'issued_on', 'score', 'elevated', 'model_version', 'computed_at'];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="bhu-rakshak-ml-predictions.csv"');
  res.send([cols.join(','), ...rows.map((x) => cols.map((c) => x[c]).join(','))].join('\n') + '\n');
});

export default r;
