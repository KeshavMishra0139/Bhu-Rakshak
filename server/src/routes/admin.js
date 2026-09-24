import path from 'node:path';
import { Router } from 'express';
import { q } from '../db/index.js';
import { SERVER_ROOT } from '../config/env.js';
import { requireAuth, requireCap, requireRealRole, publicUser } from '../auth/middleware.js';
import { audit } from '../lib/audit.js';
import { ah, HttpError, nowIso } from '../lib/util.js';

const r = Router();
const adminOnly = [requireAuth(), requireRealRole('admin', 'developer')];

r.get('/admin/pending', ...adminOnly, (_req, res) => {
  res.json({ users: q.all("SELECT * FROM users WHERE role = 'authority' AND status = 'pending' ORDER BY created_at").map((u) => ({ ...publicUser(u), has_id_document: !!u.id_document_path })) });
});

r.get('/admin/users', ...adminOnly, (req, res) => {
  const s = String(req.query.q || '').trim();
  const rows = q.all(`SELECT * FROM users WHERE role != 'developer' ${s ? 'AND (name LIKE :s OR email LIKE :s OR phone LIKE :s)' : ''} ORDER BY created_at DESC LIMIT 300`, s ? { s: `%${s}%` } : {});
  res.json({ users: rows.map(publicUser) });
});

r.get('/admin/users/:id/id-document', ...adminOnly, (req, res) => {
  const u = q.one('SELECT id_document_path FROM users WHERE id = :id', { id: req.params.id });
  if (!u?.id_document_path) throw new HttpError(404, 'not_found');
  res.sendFile(path.join(SERVER_ROOT, u.id_document_path));
});

r.post('/admin/users/:id/approve', ...adminOnly, ah(async (req, res) => {
  const u = q.one("SELECT * FROM users WHERE id = :id AND role = 'authority'", { id: req.params.id });
  if (!u) throw new HttpError(404, 'not_found');
  q.run("UPDATE users SET status = 'active', approved_by = :by, approved_at = :now, rejection_reason = NULL, updated_at = :now WHERE id = :id",
    { by: req.user.id, now: nowIso(), id: u.id });
  audit(req.actor, 'admin.approve_user', 'user', u.id, { email: u.email });
  res.json({ user: publicUser(q.one('SELECT * FROM users WHERE id = :id', { id: u.id })) });
}));

r.post('/admin/users/:id/reject', ...adminOnly, ah(async (req, res) => {
  const u = q.one("SELECT * FROM users WHERE id = :id AND role = 'authority'", { id: req.params.id });
  if (!u) throw new HttpError(404, 'not_found');
  q.run("UPDATE users SET status = 'rejected', rejection_reason = :reason, updated_at = :now WHERE id = :id",
    { reason: String(req.body?.reason || '').slice(0, 200) || null, now: nowIso(), id: u.id });
  audit(req.actor, 'admin.reject_user', 'user', u.id, { email: u.email });
  res.json({ user: publicUser(q.one('SELECT * FROM users WHERE id = :id', { id: u.id })) });
}));

// Audit log: admins, developers, and District Officer / SDMA (audit.read).
r.get(['/admin/audit', '/audit'], requireAuth(), requireCap('audit.read'), (req, res) => {
  const where = [];
  const p = {};
  if (req.query.entity_id) { where.push('entity_id = :eid'); p.eid = String(req.query.entity_id); }
  if (req.query.q) { where.push('(action LIKE :s OR performed_by LIKE :s)'); p.s = `%${String(req.query.q).slice(0, 40)}%`; }
  const limit = Math.min(500, Number(req.query.limit) || 150);
  const rows = q.all(`SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${limit}`, p);
  res.json({ entries: rows });
});

export default r;
