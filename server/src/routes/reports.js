import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { q } from '../db/index.js';
import { SERVER_ROOT } from '../config/env.js';
import { requireAuth, requireCap, rateLimit } from '../auth/middleware.js';
import { can } from '../auth/permissions.js';
import { bus } from '../events/bus.js';
import { audit } from '../lib/audit.js';
import { createIncident, incidentDetail } from './incidents.js';
import { riskService } from '../prediction/liveLoop.js';
import { ah, HttpError, newId, nowIso } from '../lib/util.js';

const r = Router();
const TYPES = ['crack', 'debris', 'rockfall', 'water_seepage', 'road_damage', 'tilting', 'other'];
const PHOTO_DIR = path.join(SERVER_ROOT, 'uploads/reports');

function nearestLocation(lat, lng) {
  const locs = q.all('SELECT id, lat, lng FROM locations');
  let best = null;
  for (const l of locs) {
    const d = (l.lat - lat) ** 2 + ((l.lng - lng) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (!best || d < best.d) best = { id: l.id, d };
  }
  return best?.id || null;
}

const publicReport = (x) => ({ ...x, photo_path: undefined, has_photo: !!x.photo_path });

r.post('/reports', rateLimit({ bucket: 'report', max: 15, windowMs: 10 * 60000 }), requireAuth(), requireCap('reports.submit'), ah(async (req, res) => {
  const b = req.body || {};
  if (!TYPES.includes(b.type)) throw new HttpError(400, 'invalid_report_type');
  let lat = Number(b.lat);
  let lng = Number(b.lng);
  let locationId = b.location_id && q.one('SELECT id FROM locations WHERE id = :id', { id: b.location_id }) ? b.location_id : null;
  // Anywhere on the watch map (Sikkim, Darjeeling and the North East preview places).
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && lat > 21.5 && lat < 30 && lng > 85 && lng < 97.8;
  if (!hasCoords) {
    if (!locationId) throw new HttpError(400, 'report_location_required');
    const l = q.one('SELECT lat, lng FROM locations WHERE id = :id', { id: locationId });
    lat = l.lat; lng = l.lng;
  }
  if (!locationId) locationId = nearestLocation(lat, lng);
  const id = newId('rep');
  let photoPath = null;
  if (b.photo) {
    const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(String(b.photo));
    if (!m) throw new HttpError(400, 'invalid_photo');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 3 * 1024 * 1024) throw new HttpError(413, 'photo_too_large');
    fs.mkdirSync(PHOTO_DIR, { recursive: true });
    photoPath = path.join('uploads/reports', `${id}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`);
    fs.writeFileSync(path.join(SERVER_ROOT, photoPath), buf);
  }
  q.run(`INSERT INTO reports(id, user_id, type, description, lat, lng, location_id, photo_path, status, created_at)
         VALUES (:id, :uid, :type, :desc, :lat, :lng, :loc, :photo, 'submitted', :now)`,
  { id, uid: req.user.id, type: b.type, desc: String(b.description || '').slice(0, 600) || null, lat, lng, loc: locationId, photo: photoPath, now: nowIso() });
  audit(req.actor, 'report.submit', 'report', id, { type: b.type, location_id: locationId });
  const row = q.one('SELECT * FROM reports WHERE id = :id', { id });
  bus.emit('report_updated', { id, location_id: locationId, status: 'submitted', user_id: req.user.id });
  res.status(201).json({ report: publicReport(row) });
}));

r.get('/reports/mine', requireAuth(), (req, res) => {
  res.json({ reports: q.all('SELECT * FROM reports WHERE user_id = :u ORDER BY created_at DESC LIMIT 50', { u: req.user.id }).map(publicReport) });
});

r.get('/reports', requireAuth(), requireCap('incidents.view'), (req, res) => {
  const status = String(req.query.status || '');
  const rows = q.all(`SELECT r.*, l.name_en, l.name_hi, l.district FROM reports r LEFT JOIN locations l ON l.id = r.location_id
                      ${status ? 'WHERE r.status = :status' : ''} ORDER BY r.created_at DESC LIMIT 200`, status ? { status } : {});
  res.json({ reports: rows.map(publicReport) });
});

r.get('/reports/:id/photo', requireAuth(), (req, res) => {
  const row = q.one('SELECT user_id, photo_path FROM reports WHERE id = :id', { id: req.params.id });
  if (!row?.photo_path) throw new HttpError(404, 'not_found');
  if (row.user_id !== req.user.id && !can(req.actor, 'incidents.view')) throw new HttpError(403, 'forbidden');
  res.sendFile(path.join(SERVER_ROOT, row.photo_path));
});

// { status: verified|rejected|resolved, create_incident?: boolean }
r.post('/reports/:id/status', requireAuth(), requireCap('reports.verify'), ah(async (req, res) => {
  const rep = q.one('SELECT * FROM reports WHERE id = :id', { id: req.params.id });
  if (!rep) throw new HttpError(404, 'not_found');
  const status = req.body?.status;
  if (!['verified', 'rejected', 'resolved'].includes(status)) throw new HttpError(400, 'invalid_status');
  const now = nowIso();
  q.run('UPDATE reports SET status = :s, reviewed_by = :by, reviewed_at = :now WHERE id = :id', { s: status, by: req.actor.performedBy, now, id: rep.id });
  let incident = null;
  if (status === 'verified' && rep.location_id) {
    // Feedback loop: a verified field report marks the location as field-verified (raises confidence).
    q.run('UPDATE locations SET field_verified_at = :now WHERE id = :id', { now, id: rep.location_id });
    riskService.provider?.clearCache?.();
    if (req.body?.create_incident) {
      incident = createIncident({ locationId: rep.location_id, level: q.one('SELECT level FROM risk_state WHERE location_id = :id', { id: rep.location_id })?.level || 'moderate',
        title: `Field report: ${rep.type.replace('_', ' ')}`, notes: rep.description, actor: req.actor });
      q.run("UPDATE incidents SET source = 'citizen_report', stage = 'verified' WHERE id = :id", { id: incident.id });
      q.run("INSERT INTO incident_events(incident_id, from_stage, to_stage, note, actor, at) VALUES (:id, 'detected', 'verified', :n, :a, :now)",
        { id: incident.id, n: `Field report ${rep.id} verified`, a: req.actor.performedBy, now });
      incident = incidentDetail(incident.id);
    }
  }
  audit(req.actor, `report.${status}`, 'report', rep.id, { location_id: rep.location_id });
  bus.emit('report_updated', { id: rep.id, location_id: rep.location_id, status, user_id: rep.user_id });
  res.json({ report: publicReport(q.one('SELECT * FROM reports WHERE id = :id', { id: rep.id })), incident });
}));

export default r;
