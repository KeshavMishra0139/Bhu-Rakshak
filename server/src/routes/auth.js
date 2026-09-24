import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { q } from '../db/index.js';
import { env, SERVER_ROOT } from '../config/env.js';
import { hashPassword, verifyPassword, passwordProblem } from '../auth/password.js';
import { setSessionCookie, clearSessionCookie } from '../auth/jwt.js';
import { publicUser, buildActor, rateLimit, requireAuth } from '../auth/middleware.js';
import { capabilitiesOf } from '../auth/permissions.js';
import { audit } from '../lib/audit.js';
import { ah, HttpError, newId, nowIso } from '../lib/util.js';

const r = Router();
const SUB_ROLES = ['district_officer', 'police', 'bro', 'rescue', 'sdma'];
const DISTRICTS = ['East Sikkim', 'West Sikkim', 'North Sikkim', 'South Sikkim', 'Kalimpong', 'Darjeeling', 'All'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^(\+91)?[6-9]\d{9}$/;

const DEMO_ACCOUNTS = {
  citizen: 'citizen@demo.in',
  officer: 'officer@demo.in',
  admin: 'admin@demo.in',
  dm_north: 'dm.north@demo.in',
  police: 'police@demo.in',
  bro: 'bro@demo.in',
  rescue: 'rescue@demo.in',
};

const normPhone = (p) => (p ? String(p).replace(/[\s-]/g, '') : null);
const normEmail = (e) => (e ? String(e).trim().toLowerCase() : null);
const str = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function sessionPayload(u, viewAs) {
  return viewAs ? { uid: u.id, view_as: viewAs } : { uid: u.id };
}

export function mePayload(user, actor) {
  return {
    user: publicUser(user),
    actor: {
      role: actor.role, sub_role: actor.subRole, district: actor.district, home_location_id: actor.homeLocationId,
      language: actor.language, viewing_as: actor.viewingAs,
    },
    capabilities: capabilitiesOf(actor),
    dev_mode: env.devModeEnabled && user.role === 'developer',
  };
}

function ensureUnique({ email, phone }) {
  if (email && q.one('SELECT 1 AS x FROM users WHERE email = :email', { email })) throw new HttpError(409, 'email_taken');
  if (phone && q.one('SELECT 1 AS x FROM users WHERE phone = :phone', { phone })) throw new HttpError(409, 'phone_taken');
}

function saveIdDocument(dataUrl, userId) {
  if (!dataUrl) return null;
  const m = /^data:(image\/(png|jpeg|webp)|application\/pdf);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, 'invalid_id_document');
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > 2 * 1024 * 1024) throw new HttpError(413, 'id_document_too_large');
  const ext = m[1] === 'application/pdf' ? 'pdf' : m[2] === 'jpeg' ? 'jpg' : m[2];
  const dir = path.join(SERVER_ROOT, 'uploads/id-documents');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${userId}.${ext}`);
  fs.writeFileSync(file, buf);
  return path.relative(SERVER_ROOT, file);
}

// ---------- Citizen sign-up (instant) ----------
r.post('/signup/citizen', rateLimit({ bucket: 'signup', max: 10, windowMs: 10 * 60000 }), ah(async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 80);
  const email = normEmail(b.email);
  const phone = normPhone(b.phone);
  if (!name) throw new HttpError(400, 'name_required');
  if (!email && !phone) throw new HttpError(400, 'email_or_phone_required');
  if (email && !EMAIL_RE.test(email)) throw new HttpError(400, 'invalid_email');
  if (phone && !PHONE_RE.test(phone)) throw new HttpError(400, 'invalid_phone');
  const pp = passwordProblem(b.password);
  if (pp) throw new HttpError(400, pp);
  const home = b.home_location_id && q.one('SELECT id FROM locations WHERE id = :id', { id: b.home_location_id }) ? b.home_location_id : null;
  ensureUnique({ email, phone });
  const id = newId('usr');
  const now = nowIso();
  q.run(`INSERT INTO users(id, name, email, phone, password_hash, role, status, home_location_id, home_village, language, theme, created_at, updated_at)
         VALUES (:id, :name, :email, :phone, :hash, 'citizen', 'active', :home, :village, :lang, :theme, :now, :now)`,
  { id, name, email, phone, hash: await hashPassword(b.password), home, village: str(b.home_village, 80) || null,
    lang: b.language === 'hi' ? 'hi' : 'en', theme: ['light', 'dark', 'system'].includes(b.theme) ? b.theme : 'system', now });
  const u = q.one('SELECT * FROM users WHERE id = :id', { id });
  audit({ userId: id, performedBy: email || phone }, 'auth.signup_citizen', 'user', id);
  setSessionCookie(res, sessionPayload(u));
  res.status(201).json(mePayload(u, buildActor(u)));
}));

// ---------- Authority sign-up (pending until an admin approves) ----------
r.post('/signup/authority', rateLimit({ bucket: 'signup', max: 10, windowMs: 10 * 60000 }), ah(async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 80);
  const email = normEmail(b.email);
  if (!name) throw new HttpError(400, 'name_required');
  if (!email || !EMAIL_RE.test(email)) throw new HttpError(400, 'official_email_required');
  if (!SUB_ROLES.includes(b.sub_role)) throw new HttpError(400, 'invalid_sub_role');
  if (!DISTRICTS.includes(b.district)) throw new HttpError(400, 'invalid_district');
  if (!str(b.badge_id, 40)) throw new HttpError(400, 'badge_id_required');
  if (!str(b.department, 120)) throw new HttpError(400, 'department_required');
  const pp = passwordProblem(b.password);
  if (pp) throw new HttpError(400, pp);
  ensureUnique({ email });
  const id = newId('usr');
  const now = nowIso();
  const docPath = saveIdDocument(b.id_document, id);
  q.run(`INSERT INTO users(id, name, email, password_hash, role, sub_role, status, badge_id, department, district, id_document_path,
           language, theme, created_at, updated_at)
         VALUES (:id, :name, :email, :hash, 'authority', :sub, 'pending', :badge, :dept, :district, :doc, :lang, 'system', :now, :now)`,
  { id, name, email, hash: await hashPassword(b.password), sub: b.sub_role, badge: str(b.badge_id, 40), dept: str(b.department, 120),
    district: b.district, doc: docPath, lang: b.language === 'hi' ? 'hi' : 'en', now });
  const u = q.one('SELECT * FROM users WHERE id = :id', { id });
  audit({ userId: id, performedBy: email }, 'auth.signup_authority', 'user', id, { sub_role: b.sub_role, district: b.district });
  setSessionCookie(res, sessionPayload(u));
  res.status(201).json(mePayload(u, buildActor(u)));
}));

// ---------- Login (email or phone) ----------
r.post('/login', rateLimit({ bucket: 'login', max: 20, windowMs: 10 * 60000 }), ah(async (req, res) => {
  const { identifier, password } = req.body || {};
  const id = String(identifier || '').trim();
  const u = id.includes('@')
    ? q.one('SELECT * FROM users WHERE email = :e', { e: normEmail(id) })
    : q.one('SELECT * FROM users WHERE phone = :p', { p: normPhone(id) });
  // Developer accounts sign in only through the dev dialog (/api/dev/login).
  if (!u || u.role === 'developer' || !(await verifyPassword(String(password || ''), u.password_hash))) {
    throw new HttpError(401, 'invalid_credentials');
  }
  if (u.status === 'rejected') throw new HttpError(403, 'account_rejected');
  setSessionCookie(res, sessionPayload(u));
  audit(buildActor(u), 'auth.login', 'user', u.id);
  res.json(mePayload(u, buildActor(u)));
}));

// ---------- One-tap demo access ----------
r.post('/demo', rateLimit({ bucket: 'demo', max: 60, windowMs: 10 * 60000 }), ah(async (req, res) => {
  if (!env.demoLoginEnabled) throw new HttpError(404, 'not_found');
  const email = DEMO_ACCOUNTS[req.body?.account];
  if (!email) throw new HttpError(400, 'unknown_demo_account');
  const u = q.one('SELECT * FROM users WHERE email = :email', { email });
  if (!u) throw new HttpError(404, 'demo_account_missing');
  setSessionCookie(res, sessionPayload(u));
  audit(buildActor(u), 'auth.demo_login', 'user', u.id);
  res.json(mePayload(u, buildActor(u)));
}));

r.get('/demo-accounts', (_req, res) => {
  res.json({ enabled: env.demoLoginEnabled, accounts: env.demoLoginEnabled ? Object.keys(DEMO_ACCOUNTS) : [], dev_mode: env.devModeEnabled });
});

r.post('/logout', (req, res) => {
  if (req.actor) audit(req.actor, 'auth.logout', 'user', req.user.id);
  clearSessionCookie(res);
  res.json({ ok: true });
});

r.get('/me', requireAuth({ allowPending: true }), (req, res) => {
  res.json(mePayload(req.user, req.actor));
});

export default r;
