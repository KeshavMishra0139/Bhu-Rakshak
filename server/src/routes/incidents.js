import { Router } from 'express';
import { q, tx } from '../db/index.js';
import { requireAuth, requireCap } from '../auth/middleware.js';
import { can } from '../auth/permissions.js';
import { bus } from '../events/bus.js';
import { audit } from '../lib/audit.js';
import { ah, HttpError, newId, nowIso, safeJson } from '../lib/util.js';

const r = Router();
export const STAGES = ['detected', 'under_verification', 'verified', 'alert_issued', 'response_underway', 'resolved', 'closed'];
r.use('/incidents', requireAuth(), requireCap('incidents.view'));

export function incidentDetail(id) {
  const inc = q.one(`SELECT i.*, l.name_en, l.name_hi, l.district, l.corridor_id, u.name AS owner_name
                     FROM incidents i JOIN locations l ON l.id = i.location_id LEFT JOIN users u ON u.id = i.owner_id WHERE i.id = :id`, { id });
  if (!inc) return null;
  inc.events = q.all('SELECT * FROM incident_events WHERE incident_id = :id ORDER BY at', { id });
  inc.sop_ticks = q.all('SELECT * FROM incident_sop_ticks WHERE incident_id = :id', { id });
  inc.resources = q.all(`SELECT r.*, ir.assigned_at, ir.assigned_by FROM incident_resources ir JOIN resources r ON r.id = ir.resource_id
                         WHERE ir.incident_id = :id AND ir.released_at IS NULL`, { id });
  inc.alerts = q.all('SELECT id, severity, kind, title_en, title_hi, created_at, cancelled_at FROM alerts WHERE incident_id = :id ORDER BY created_at DESC', { id });
  return inc;
}

export function createIncident({ locationId, level, title, source = 'officer', notes, actor, inboxMessageId }) {
  const loc = q.one('SELECT id, name_en FROM locations WHERE id = :id', { id: locationId });
  if (!loc) throw new HttpError(400, 'invalid_location');
  const id = newId('inc');
  const now = nowIso();
  tx(() => {
    q.run(`INSERT INTO incidents(id, location_id, title, stage, level, owner_id, source, notes, detected_at, updated_at)
           VALUES (:id, :loc, :title, 'detected', :level, :owner, :source, :notes, :now, :now)`,
    { id, loc: locationId, title: title || `Risk at ${loc.name_en}`, level: level || 'moderate', owner: actor?.userId || null, source, notes: notes || null, now });
    q.run('INSERT INTO incident_events(incident_id, from_stage, to_stage, note, actor, at) VALUES (:id, NULL, :s, :note, :actor, :now)',
      { id, s: 'detected', note: notes || null, actor: actor?.performedBy || 'system', now });
    if (inboxMessageId) q.run('UPDATE inbox_messages SET incident_id = :id WHERE id = :m', { id, m: inboxMessageId });
  });
  audit(actor, 'incident.create', 'incident', id, { location_id: locationId, level, source });
  bus.emit('incident_updated', { id, location_id: locationId });
  return incidentDetail(id);
}

r.get('/incidents', (req, res) => {
  const where = ['1 = 1'];
  const p = {};
  if (req.query.stage) { where.push('i.stage = :stage'); p.stage = String(req.query.stage); }
  if (req.query.location_id) { where.push('i.location_id = :loc'); p.loc = String(req.query.location_id); }
  if (req.query.open === '1') where.push("i.stage != 'closed'");
  const rows = q.all(`SELECT i.*, l.name_en, l.name_hi, l.district, u.name AS owner_name,
                        (SELECT COUNT(*) FROM incident_resources ir WHERE ir.incident_id = i.id AND ir.released_at IS NULL) AS resource_count,
                        (SELECT COUNT(*) FROM incident_sop_ticks t WHERE t.incident_id = i.id AND t.done = 1) AS sop_done
                      FROM incidents i JOIN locations l ON l.id = i.location_id LEFT JOIN users u ON u.id = i.owner_id
                      WHERE ${where.join(' AND ')} ORDER BY i.updated_at DESC LIMIT 200`, p);
  res.json({ incidents: rows, stages: STAGES });
});

r.get('/incidents/:id', (req, res) => {
  const inc = incidentDetail(req.params.id);
  if (!inc) throw new HttpError(404, 'not_found');
  res.json({ incident: inc, sops: q.all('SELECT * FROM sops WHERE level = :l ORDER BY ord', { l: inc.level }).map((s) => ({ ...s, roles: safeJson(s.roles, []) })) });
});

// { location_id, level, title, notes, inbox_message_id, report_id }
r.post('/incidents', ah(async (req, res) => {
  if (!can(req.actor, 'incidents.manage') && !can(req.actor, 'incidents.respond')) throw new HttpError(403, 'forbidden');
  const b = req.body || {};
  const inc = createIncident({ locationId: b.location_id, level: b.level, title: String(b.title || '').slice(0, 140), notes: b.notes, actor: req.actor,
    source: b.report_id ? 'citizen_report' : 'officer', inboxMessageId: b.inbox_message_id });
  res.status(201).json({ incident: inc });
}));

// { stage, note }
r.post('/incidents/:id/stage', ah(async (req, res) => {
  const inc = q.one('SELECT * FROM incidents WHERE id = :id', { id: req.params.id });
  if (!inc) throw new HttpError(404, 'not_found');
  const stage = req.body?.stage;
  if (!STAGES.includes(stage)) throw new HttpError(400, 'invalid_stage');
  const responder = ['response_underway', 'resolved'].includes(stage) && can(req.actor, 'incidents.respond');
  if (!can(req.actor, 'incidents.manage') && !responder) throw new HttpError(403, 'forbidden');
  const now = nowIso();
  const extra = stage === 'alert_issued' ? ', alert_issued_at = COALESCE(alert_issued_at, :now)'
    : stage === 'resolved' ? ', resolved_at = :now' : stage === 'closed' ? ', closed_at = :now' : '';
  tx(() => {
    q.run(`UPDATE incidents SET stage = :stage, updated_at = :now${extra} WHERE id = :id`, { stage, now, id: inc.id });
    q.run('INSERT INTO incident_events(incident_id, from_stage, to_stage, note, actor, at) VALUES (:id, :f, :t, :note, :actor, :now)',
      { id: inc.id, f: inc.stage, t: stage, note: String(req.body?.note || '').slice(0, 500) || null, actor: req.actor.performedBy, now });
    if (stage === 'closed' || stage === 'resolved') {
      const held = q.all('SELECT resource_id FROM incident_resources WHERE incident_id = :id AND released_at IS NULL', { id: inc.id });
      q.run('UPDATE incident_resources SET released_at = :now WHERE incident_id = :id AND released_at IS NULL', { id: inc.id, now });
      for (const h of held) q.run("UPDATE resources SET status = 'available', updated_at = :now WHERE id = :rid AND status = 'deployed'", { rid: h.resource_id, now });
    }
  });
  audit(req.actor, 'incident.stage', 'incident', inc.id, { from: inc.stage, to: stage });
  bus.emit('incident_updated', { id: inc.id, location_id: inc.location_id });
  res.json({ incident: incidentDetail(inc.id) });
}));

r.post('/incidents/:id/note', ah(async (req, res) => {
  const inc = q.one('SELECT * FROM incidents WHERE id = :id', { id: req.params.id });
  if (!inc) throw new HttpError(404, 'not_found');
  const note = String(req.body?.note || '').trim().slice(0, 500);
  if (!note) throw new HttpError(400, 'note_required');
  q.run('INSERT INTO incident_events(incident_id, from_stage, to_stage, note, actor, at) VALUES (:id, NULL, NULL, :note, :actor, :now)',
    { id: inc.id, note, actor: req.actor.performedBy, now: nowIso() });
  q.run('UPDATE incidents SET updated_at = :now WHERE id = :id', { id: inc.id, now: nowIso() });
  audit(req.actor, 'incident.note', 'incident', inc.id);
  bus.emit('incident_updated', { id: inc.id, location_id: inc.location_id });
  res.json({ incident: incidentDetail(inc.id) });
}));

r.post('/incidents/:id/owner', ah(async (req, res) => {
  if (!can(req.actor, 'incidents.manage')) throw new HttpError(403, 'forbidden');
  const inc = q.one('SELECT id, location_id FROM incidents WHERE id = :id', { id: req.params.id });
  if (!inc) throw new HttpError(404, 'not_found');
  q.run('UPDATE incidents SET owner_id = :u, updated_at = :now WHERE id = :id', { u: req.actor.userId, now: nowIso(), id: inc.id });
  audit(req.actor, 'incident.take_ownership', 'incident', inc.id);
  bus.emit('incident_updated', { id: inc.id, location_id: inc.location_id });
  res.json({ incident: incidentDetail(inc.id) });
}));

// SOP checklist tick: { key, done }
r.post('/incidents/:id/sop', ah(async (req, res) => {
  const inc = q.one('SELECT * FROM incidents WHERE id = :id', { id: req.params.id });
  if (!inc) throw new HttpError(404, 'not_found');
  const sop = q.one('SELECT * FROM sops WHERE key = :k', { k: String(req.body?.key || '') });
  if (!sop) throw new HttpError(400, 'invalid_sop');
  const roles = safeJson(sop.roles, []);
  // Each action belongs to specific roles; District Officer / SDMA (and the developer) can tick everything.
  const lead = can(req.actor, 'alerts.dispatch');
  const allowed = lead || (req.actor.role === 'authority' && roles.includes(req.actor.subRole));
  if (!allowed) throw new HttpError(403, 'forbidden');
  const done = req.body?.done ? 1 : 0;
  q.run(`INSERT INTO incident_sop_ticks(incident_id, sop_key, done, actor, at) VALUES (:id, :k, :d, :a, :now)
         ON CONFLICT(incident_id, sop_key) DO UPDATE SET done = excluded.done, actor = excluded.actor, at = excluded.at`,
  { id: inc.id, k: sop.key, d: done, a: req.actor.performedBy, now: nowIso() });
  audit(req.actor, done ? 'sop.tick' : 'sop.untick', 'incident', inc.id, { sop: sop.key });
  bus.emit('incident_updated', { id: inc.id, location_id: inc.location_id });
  res.json({ incident: incidentDetail(inc.id) });
}));

// Assign / release a resource: { resource_id } / DELETE
r.post('/incidents/:id/resources', requireCap('resources.deploy'), ah(async (req, res) => {
  const inc = q.one('SELECT * FROM incidents WHERE id = :id', { id: req.params.id });
  const rs = q.one('SELECT * FROM resources WHERE id = :id', { id: String(req.body?.resource_id || '') });
  if (!inc || !rs) throw new HttpError(404, 'not_found');
  if (rs.status === 'unavailable') throw new HttpError(409, 'resource_unavailable');
  const now = nowIso();
  tx(() => {
    q.run('INSERT INTO incident_resources(incident_id, resource_id, assigned_by, assigned_at) VALUES (:i, :r, :by, :now)',
      { i: inc.id, r: rs.id, by: req.actor.performedBy, now });
    if (rs.type !== 'shelter') q.run("UPDATE resources SET status = 'deployed', updated_at = :now WHERE id = :r", { r: rs.id, now });
  });
  audit(req.actor, 'resource.assign', 'incident', inc.id, { resource_id: rs.id });
  bus.emit('incident_updated', { id: inc.id, location_id: inc.location_id });
  bus.emit('resource_updated', { id: rs.id });
  res.json({ incident: incidentDetail(inc.id) });
}));

r.delete('/incidents/:id/resources/:rid', requireCap('resources.deploy'), ah(async (req, res) => {
  const now = nowIso();
  q.run('UPDATE incident_resources SET released_at = :now WHERE incident_id = :i AND resource_id = :r AND released_at IS NULL', { i: req.params.id, r: req.params.rid, now });
  q.run("UPDATE resources SET status = 'available', updated_at = :now WHERE id = :r AND status = 'deployed'", { r: req.params.rid, now });
  audit(req.actor, 'resource.release', 'incident', req.params.id, { resource_id: req.params.rid });
  bus.emit('resource_updated', { id: req.params.rid });
  res.json({ incident: incidentDetail(req.params.id) });
}));

export default r;
