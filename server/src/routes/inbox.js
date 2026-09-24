import { Router } from 'express';
import { q } from '../db/index.js';
import { requireAuth, requireCap } from '../auth/middleware.js';
import { visibilitySql, toPublic, acknowledge, markRead } from '../notifications/inbox.js';
import { ah, HttpError } from '../lib/util.js';

const r = Router();
r.use('/inbox', requireAuth(), requireCap('inbox.read'));

// GET /api/inbox?filter=all|critical|high|unread|my_district|escalated&corridor=nh10&q=mangan&sort=newest|priority&limit=50
r.get('/inbox', (req, res) => {
  const vis = visibilitySql(req.actor);
  const where = [vis.where];
  const params = { ...vis.params, uid: req.user.id };
  const { filter = 'all', corridor, q: search, sort = 'newest' } = req.query;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  if (filter === 'critical') where.push("m.level = 'critical'");
  if (filter === 'high') where.push("m.level = 'high'");
  if (filter === 'escalated') where.push('m.escalated = 1');
  if (filter === 'unread') where.push('NOT EXISTS (SELECT 1 FROM inbox_reads rd WHERE rd.message_id = m.id AND rd.user_id = :uid)');
  if (filter === 'my_district' && req.actor.district && req.actor.district !== 'All') {
    where.push('m.target_district = :my_district');
    params.my_district = req.actor.district;
  }
  if (corridor) { where.push('l.corridor_id = :corridor'); params.corridor = String(corridor); }
  if (search) { where.push('(l.name_en LIKE :s OR l.name_hi LIKE :s OR l.district LIKE :s)'); params.s = `%${String(search).slice(0, 40)}%`; }
  const order = sort === 'priority' ? 'm.priority DESC, m.created_at DESC' : 'm.created_at DESC';
  const rows = q.all(`SELECT m.*, u.name AS ack_name FROM inbox_messages m
                      JOIN locations l ON l.id = m.location_id
                      LEFT JOIN users u ON u.id = m.acknowledged_by
                      WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${limit}`, params);
  res.json({ messages: rows.map((m) => toPublic(m, req.user.id)) });
});

r.get('/inbox/unread-count', (req, res) => {
  const vis = visibilitySql(req.actor);
  const row = q.one(`SELECT COUNT(*) AS n,
                            SUM(CASE WHEN m.level = 'critical' THEN 1 ELSE 0 END) AS critical
                     FROM inbox_messages m
                     WHERE ${vis.where} AND m.type != 'deescalation'
                       AND NOT EXISTS (SELECT 1 FROM inbox_reads rd WHERE rd.message_id = m.id AND rd.user_id = :uid)`,
  { ...vis.params, uid: req.user.id });
  res.json({ unread: row.n || 0, critical: row.critical || 0 });
});

function loadVisible(req, id) {
  const vis = visibilitySql(req.actor);
  const m = q.one(`SELECT m.* FROM inbox_messages m WHERE m.id = :id AND ${vis.where}`, { ...vis.params, id });
  if (!m) throw new HttpError(404, 'message_not_found');
  return m;
}

r.post('/inbox/:id/ack', ah(async (req, res) => {
  loadVisible(req, req.params.id);
  const m = acknowledge(req.params.id, req.actor);
  res.json({ message: toPublic(m, req.user.id) });
}));

r.post('/inbox/:id/read', ah(async (req, res) => {
  loadVisible(req, req.params.id);
  markRead([req.params.id], req.user.id);
  res.json({ ok: true });
}));

// Bulk mark read: { ids: [...] } or { all: true }
r.post('/inbox/read', ah(async (req, res) => {
  const vis = visibilitySql(req.actor);
  let ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 500).map(String) : [];
  if (req.body?.all) ids = q.all(`SELECT m.id FROM inbox_messages m WHERE ${vis.where}`, vis.params).map((x) => x.id);
  const allowed = ids.filter((id) => q.one(`SELECT 1 AS x FROM inbox_messages m WHERE m.id = :id AND ${vis.where}`, { ...vis.params, id }));
  markRead(allowed, req.user.id);
  res.json({ ok: true, count: allowed.length });
}));

export default r;
