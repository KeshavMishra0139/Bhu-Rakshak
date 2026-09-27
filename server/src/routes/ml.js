// EXPERIMENTAL model API — officers only (risk.details). Not used for alerts.
// Also the confirmed-landslide record (landslides.record) the model is judged against and retrained on.
import { Router } from 'express';
import { q } from '../db/index.js';
import { requireAuth, requireCap } from '../auth/middleware.js';
import { can } from '../auth/permissions.js';
import { audit } from '../lib/audit.js';
import { HttpError, newId, nowIso } from '../lib/util.js';
import { latestMl, modelCard, predictionLog, istDate } from '../prediction/mlModel.js';
import { scorecard, distanceKm } from '../prediction/mlScorecard.js';

const r = Router();
const officersOnly = (req, _res, next) => (can(req.actor, 'risk.details') ? next() : next(new HttpError(403, 'forbidden')));
const csv = (res, name, cols, rows) => {
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send([cols.join(','), ...rows.map((x) => cols.map((c) => esc(x[c])).join(','))].join('\n') + '\n');
};

r.get('/ml/latest', requireAuth(), officersOnly, (_req, res) => {
  res.json({ model: modelCard(), ...latestMl() });
});

// Full prediction log as CSV, so anyone can check the model against landslides that happened afterwards.
r.get('/ml/log.csv', requireAuth(), officersOnly, (_req, res) => {
  csv(res, 'bhu-rakshak-ml-predictions.csv', ['location_id', 'for_date', 'issued_on', 'score', 'elevated', 'model_version', 'computed_at'], predictionLog());
});

r.get('/ml/scorecard', requireAuth(), officersOnly, (_req, res) => res.json(scorecard()));

// ---------- Confirmed-landslide record ----------
const RECORD_COLS = ['id', 'date', 'lat', 'lng', 'accuracy_km', 'location_id', 'source', 'source_id', 'notes', 'recorded_by', 'recorded_at', 'retracted_at', 'retracted_by', 'retract_reason'];
const recordById = (id) => q.one(`SELECT ${RECORD_COLS.join(', ')} FROM landslide_record WHERE id = :id`, { id });
const nearestPlace = (p) => q.all('SELECT id, lat, lng FROM locations').map((l) => ({ ...l, km: distanceKm(l, p) })).sort((a, b) => a.km - b.km)[0];

r.get('/ml/landslides', requireAuth(), officersOnly, (req, res) => {
  const where = req.query.location_id ? 'WHERE location_id = :loc' : '';
  res.json({ landslides: q.all(`SELECT ${RECORD_COLS.join(', ')} FROM landslide_record ${where} ORDER BY date DESC, recorded_at DESC`, { loc: req.query.location_id || null }) });
});
// For ml/retrain.mjs (and anyone checking): every record, including retracted ones (flagged).
r.get('/ml/landslides.csv', requireAuth(), officersOnly, (_req, res) => {
  csv(res, 'bhu-rakshak-landslide-record.csv', RECORD_COLS, q.all(`SELECT ${RECORD_COLS.join(', ')} FROM landslide_record ORDER BY date`));
});

/**
 * Record a confirmed landslide. Body: { date?, location_id?, lat?, lng?, notes?, report_id?, incident_id?, force? }
 * — from a verified report (its GPS point and day), an incident (its place and detection day), or directly
 * (a monitored place, or a GPS point). Refuses duplicates (same source, or within 2 km and 1 day) unless force.
 */
export function recordLandslide(b, actor) {
  let rec;
  if (b.report_id) {
    const rep = q.one('SELECT * FROM reports WHERE id = :id', { id: b.report_id });
    if (!rep) throw new HttpError(404, 'not_found');
    if (!['verified', 'resolved'].includes(rep.status)) throw new HttpError(400, 'report_not_verified');
    const place = rep.location_id ? q.one('SELECT lat, lng FROM locations WHERE id = :id', { id: rep.location_id }) : null;
    const gps = rep.lat != null && rep.lng != null;
    rec = { source: 'report', source_id: rep.id, lat: gps ? rep.lat : place?.lat, lng: gps ? rep.lng : place?.lng, accuracy_km: gps ? 0.5 : 2,
      date: b.date || istDate(Date.parse(rep.created_at)), notes: b.notes || `Verified field report: ${rep.type}${rep.description ? ` — ${rep.description}` : ''}` };
  } else if (b.incident_id) {
    const inc = q.one('SELECT i.title, i.detected_at, i.id, l.lat, l.lng FROM incidents i JOIN locations l ON l.id = i.location_id WHERE i.id = :id', { id: b.incident_id });
    if (!inc) throw new HttpError(404, 'not_found');
    rec = { source: 'incident', source_id: inc.id, lat: inc.lat, lng: inc.lng, accuracy_km: 2, date: b.date || istDate(Date.parse(inc.detected_at)), notes: b.notes || `Incident: ${inc.title}` };
  } else if (b.lat != null && b.lng != null) {
    rec = { source: 'officer', source_id: null, lat: Number(b.lat), lng: Number(b.lng), accuracy_km: 0.5, date: b.date, notes: b.notes || null };
  } else if (b.location_id) {
    const place = q.one('SELECT lat, lng FROM locations WHERE id = :id', { id: b.location_id });
    if (!place) throw new HttpError(404, 'not_found');
    rec = { source: 'officer', source_id: null, lat: place.lat, lng: place.lng, accuracy_km: 2, date: b.date, notes: b.notes || null };
  } else throw new HttpError(400, 'missing_place');

  if (!Number.isFinite(rec.lat) || !Number.isFinite(rec.lng) || rec.lat < 20 || rec.lat > 32 || rec.lng < 85 || rec.lng > 100) throw new HttpError(400, 'invalid_place');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.date || '') || rec.date > istDate() || rec.date < '2000-01-01') throw new HttpError(400, 'invalid_date');
  if (rec.notes) rec.notes = String(rec.notes).slice(0, 500);
  if (rec.source_id && q.one('SELECT id FROM landslide_record WHERE source = :s AND source_id = :sid', { s: rec.source, sid: rec.source_id })) throw new HttpError(409, 'already_recorded');
  if (!b.force) {
    const dup = q.all('SELECT id, date, lat, lng FROM landslide_record WHERE retracted_at IS NULL')
      .find((x) => Math.abs(Date.parse(x.date) - Date.parse(rec.date)) <= 86400000 && distanceKm(x, rec) <= 2);
    if (dup) throw new HttpError(409, 'possible_duplicate');
  }
  const id = newId('ls');
  q.run(`INSERT INTO landslide_record(id, date, lat, lng, accuracy_km, location_id, source, source_id, notes, recorded_by, recorded_at)
         VALUES (:id, :date, :lat, :lng, :acc, :loc, :src, :sid, :notes, :by, :at)`,
  { id, date: rec.date, lat: rec.lat, lng: rec.lng, acc: rec.accuracy_km, loc: nearestPlace(rec)?.id || null, src: rec.source, sid: rec.source_id, notes: rec.notes || null, by: actor.performedBy, at: nowIso() });
  audit(actor, 'landslide.record', 'landslide_record', id, { date: rec.date, source: rec.source, source_id: rec.source_id });
  return recordById(id);
}
r.post('/ml/landslides', requireAuth(), requireCap('landslides.record'), (req, res) => res.status(201).json({ landslide: recordLandslide(req.body || {}, req.actor) }));

// Mistakes are retracted, never deleted: the record stays with who retracted it and why.
export function retractLandslide(id, reasonIn, actor) {
  const rec = recordById(id);
  if (!rec) throw new HttpError(404, 'not_found');
  if (rec.retracted_at) throw new HttpError(409, 'already_retracted');
  const reason = String(reasonIn || '').trim().slice(0, 300);
  if (!reason) throw new HttpError(400, 'reason_required');
  q.run('UPDATE landslide_record SET retracted_at = :at, retracted_by = :by, retract_reason = :why WHERE id = :id', { at: nowIso(), by: actor.performedBy, why: reason, id: rec.id });
  audit(actor, 'landslide.retract', 'landslide_record', rec.id, { reason });
  return recordById(rec.id);
}
r.post('/ml/landslides/:id/retract', requireAuth(), requireCap('landslides.record'), (req, res) => res.json({ landslide: retractLandslide(req.params.id, req.body?.reason, req.actor) }));

export default r;
