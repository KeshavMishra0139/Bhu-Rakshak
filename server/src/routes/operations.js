// Roads board, resource registry, SOP library and stakeholder directory.
import { Router } from 'express';
import { q } from '../db/index.js';
import { requireAuth, requireCap, requireRealRole } from '../auth/middleware.js';
import { can } from '../auth/permissions.js';
import { bus } from '../events/bus.js';
import { audit } from '../lib/audit.js';
import { ah, HttpError, nowIso, safeJson } from '../lib/util.js';

const r = Router();
const ROAD_STATUSES = ['open', 'caution', 'restricted', 'blocked', 'cleared'];

const roadOut = (x) => ({ ...x, path: safeJson(x.path_json, []), path_json: undefined, tourist_advisory: !!x.tourist_advisory, heavy_vehicle_advisory: !!x.heavy_vehicle_advisory });

r.get('/roads', (_req, res) => res.json({ roads: q.all('SELECT * FROM roads ORDER BY corridor_id, name_en').map(roadOut) }));

// Police: closures, diversions, advisories. BRO: blocked / cleared and ETA. DO / SDMA: everything.
r.put('/roads/:id', requireAuth(), ah(async (req, res) => {
  const road = q.one('SELECT * FROM roads WHERE id = :id', { id: req.params.id });
  if (!road) throw new HttpError(404, 'not_found');
  const b = req.body || {};
  const canClose = can(req.actor, 'roads.close');
  const canStatus = can(req.actor, 'roads.status');
  if (!canClose && !canStatus) throw new HttpError(403, 'forbidden');
  const patch = {};
  if (b.status !== undefined) {
    if (!ROAD_STATUSES.includes(b.status)) throw new HttpError(400, 'invalid_status');
    const statusAllowed = canClose || ['blocked', 'cleared', 'open', 'caution'].includes(b.status);
    if (!statusAllowed) throw new HttpError(403, 'forbidden');
    patch.status = b.status;
  }
  if (b.eta_clear_hours !== undefined) patch.eta_clear_hours = b.eta_clear_hours === null || b.eta_clear_hours === '' ? null : Math.max(0, Number(b.eta_clear_hours));
  if (canClose) {
    if (typeof b.diversion_en === 'string') patch.diversion_en = b.diversion_en.slice(0, 300);
    if (typeof b.diversion_hi === 'string') patch.diversion_hi = b.diversion_hi.slice(0, 300);
    if (b.tourist_advisory !== undefined) patch.tourist_advisory = b.tourist_advisory ? 1 : 0;
    if (b.heavy_vehicle_advisory !== undefined) patch.heavy_vehicle_advisory = b.heavy_vehicle_advisory ? 1 : 0;
  }
  const keys = Object.keys(patch);
  if (!keys.length) throw new HttpError(400, 'nothing_to_update');
  q.run(`UPDATE roads SET ${keys.map((k) => `${k} = :${k}`).join(', ')}, updated_by = :by, updated_at = :now WHERE id = :id`,
    { ...patch, by: req.actor.performedBy, now: nowIso(), id: road.id });
  audit(req.actor, 'road.update', 'road', road.id, patch);
  const out = roadOut(q.one('SELECT * FROM roads WHERE id = :id', { id: road.id }));
  bus.emit('road_updated', out);
  res.json({ road: out });
}));

r.get('/resources', requireAuth(), requireCap('incidents.view'), (_req, res) => {
  res.json({ resources: q.all(`SELECT r.*, l.name_en AS location_en, l.name_hi AS location_hi, l.lat, l.lng,
      (SELECT i.id FROM incident_resources ir JOIN incidents i ON i.id = ir.incident_id WHERE ir.resource_id = r.id AND ir.released_at IS NULL LIMIT 1) AS incident_id
      FROM resources r LEFT JOIN locations l ON l.id = r.location_id ORDER BY r.type, r.name`) });
});

r.put('/resources/:id', requireAuth(), requireCap('resources.deploy'), ah(async (req, res) => {
  const rs = q.one('SELECT * FROM resources WHERE id = :id', { id: req.params.id });
  if (!rs) throw new HttpError(404, 'not_found');
  const patch = {};
  if (req.body?.status) {
    if (!['available', 'deployed', 'unavailable'].includes(req.body.status)) throw new HttpError(400, 'invalid_status');
    patch.status = req.body.status;
  }
  if (req.body?.occupancy !== undefined && rs.type === 'shelter') patch.occupancy = Math.max(0, Math.min(rs.capacity || 0, Number(req.body.occupancy) || 0));
  const keys = Object.keys(patch);
  if (!keys.length) throw new HttpError(400, 'nothing_to_update');
  q.run(`UPDATE resources SET ${keys.map((k) => `${k} = :${k}`).join(', ')}, updated_at = :now WHERE id = :id`, { ...patch, now: nowIso(), id: rs.id });
  audit(req.actor, 'resource.update', 'resource', rs.id, patch);
  bus.emit('resource_updated', { id: rs.id });
  res.json({ resource: q.one('SELECT * FROM resources WHERE id = :id', { id: rs.id }) });
}));

r.get('/sops', requireAuth(), (_req, res) => {
  res.json({ sops: q.all('SELECT * FROM sops ORDER BY level, ord').map((s) => ({ ...s, roles: safeJson(s.roles, []) })) });
});

r.put('/admin/sops/:level/:key', requireAuth(), requireRealRole('admin', 'developer'), ah(async (req, res) => {
  const s = q.one('SELECT * FROM sops WHERE level = :l AND key = :k', { l: req.params.level, k: req.params.key });
  if (!s) throw new HttpError(404, 'not_found');
  const en = String(req.body?.text_en || s.text_en).slice(0, 200);
  const hi = String(req.body?.text_hi || s.text_hi).slice(0, 200);
  q.run('UPDATE sops SET text_en = :en, text_hi = :hi WHERE level = :l AND key = :k', { en, hi, l: s.level, k: s.key });
  audit(req.actor, 'sop.edit', 'sop', `${s.level}:${s.key}`);
  res.json({ ok: true });
}));

// Public: citizens need emergency numbers. Placeholders only; never invented.
r.get('/stakeholders', (_req, res) => res.json({ stakeholders: q.all('SELECT * FROM stakeholders ORDER BY district, role') }));

r.put('/admin/stakeholders/:id', requireAuth(), requireRealRole('admin', 'developer'), ah(async (req, res) => {
  const s = q.one('SELECT * FROM stakeholders WHERE id = :id', { id: Number(req.params.id) });
  if (!s) throw new HttpError(404, 'not_found');
  const phone = String(req.body?.phone ?? s.phone ?? '').replace(/[^\d+\s-]/g, '').slice(0, 20);
  const name = String(req.body?.name ?? s.name ?? '').slice(0, 80);
  q.run('UPDATE stakeholders SET name = :name, phone = :phone WHERE id = :id', { name, phone, id: s.id });
  audit(req.actor, 'stakeholder.edit', 'stakeholder', String(s.id));
  res.json({ stakeholder: q.one('SELECT * FROM stakeholders WHERE id = :id', { id: s.id }) });
}));

export default r;
