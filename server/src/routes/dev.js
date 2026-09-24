// Developer / Admin mode. This router is only mounted when DEV_MODE_ENABLED=true; otherwise every
// /api/dev/* path falls through to the JSON 404 handler. All routes except /login require the REAL
// account to be a developer (so "View as" never locks the developer out).
import { Router } from 'express';
import { q } from '../db/index.js';
import { env } from '../config/env.js';
import { verifyPassword } from '../auth/password.js';
import { setSessionCookie } from '../auth/jwt.js';
import { rateLimit, requireRealRole, buildActor, sanitizeViewAs } from '../auth/middleware.js';
import { getControls, setForced, setSpeed, setPaused, resetControls, setScenario } from '../prediction/controls.js';
import { resetLiveInputs } from '../prediction/liveInputs.js';
import { riskService } from '../prediction/liveLoop.js';
import { resetDemoData } from '../db/seed.js';
import { mePayload } from './auth.js';
import { audit } from '../lib/audit.js';
import { ah, HttpError } from '../lib/util.js';
import crypto from 'node:crypto';

const r = Router();
const LEVELS = ['low', 'moderate', 'high', 'critical'];

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

r.post('/dev/login', rateLimit({ bucket: 'dev-login', max: 5, windowMs: 10 * 60000 }), ah(async (req, res) => {
  if (!env.devPassword) throw new HttpError(403, 'dev_account_not_configured');
  const { email, password, access_code } = req.body || {};
  const u = q.one("SELECT * FROM users WHERE email = :e AND role = 'developer'", { e: String(email || '').trim().toLowerCase() });
  const okPw = u && (await verifyPassword(String(password || ''), u.password_hash));
  const okCode = !env.devAccessCode || safeEqual(access_code || '', env.devAccessCode);
  if (!okPw || !okCode) throw new HttpError(401, 'invalid_credentials');
  setSessionCookie(res, { uid: u.id });
  audit(buildActor(u), 'dev.login', 'user', u.id);
  res.json(mePayload(u, buildActor(u)));
}));

r.use('/dev', requireRealRole('developer'));

r.get('/dev/state', (_req, res) => res.json({ controls: getControls() }));

// { role: 'authority'|'citizen'|'admin'|null, sub_role, district, home_location_id, language }
r.post('/dev/view-as', ah(async (req, res) => {
  const b = req.body || {};
  let viewAs = null;
  if (b.role) {
    viewAs = sanitizeViewAs(b);
    if (!viewAs) throw new HttpError(400, 'invalid_role');
  }
  setSessionCookie(res, viewAs ? { uid: req.user.id, view_as: viewAs } : { uid: req.user.id });
  const actor = buildActor(req.user, viewAs);
  audit(buildActor(req.user), 'dev.view_as', 'user', req.user.id, viewAs || { role: 'developer' });
  res.json(mePayload(req.user, actor));
}));

r.post('/dev/force-risk', ah(async (req, res) => {
  const { location_id, level } = req.body || {};
  if (!q.one('SELECT id FROM locations WHERE id = :id', { id: location_id })) throw new HttpError(400, 'invalid_location');
  if (level != null && !LEVELS.includes(level)) throw new HttpError(400, 'invalid_level');
  const c = setForced(location_id, level || null);
  audit(req.actor, 'dev.force_risk', 'location', location_id, { level: level || 'released' });
  res.json({ controls: c });
}));

r.post('/dev/speed', ah(async (req, res) => {
  try {
    const c = setSpeed(req.body?.speed);
    audit(req.actor, 'dev.speed', null, null, { speed: c.speed });
    res.json({ controls: c });
  } catch { throw new HttpError(400, 'invalid_speed'); }
}));

r.post('/dev/pause', ah(async (req, res) => {
  const c = setPaused(!!req.body?.paused);
  audit(req.actor, c.paused ? 'dev.pause' : 'dev.resume');
  res.json({ controls: c });
}));

r.post('/dev/scenario', ah(async (req, res) => {
  const { active, corridors = [], intensity = 1 } = req.body || {};
  const c = setScenario({ active: !!active, corridors, intensity }, req.actor.performedBy);
  audit(req.actor, active ? 'tools.scenario_start' : 'tools.scenario_stop', 'scenario', null, { corridors });
  res.json({ controls: c });
}));

r.post('/dev/reset', ah(async (req, res) => {
  resetDemoData();
  resetControls();
  resetLiveInputs();
  riskService.resetMemory();
  await riskService.computeMany(riskService.locations.map((l) => l.id), new Date(), { emitEvents: false });
  riskService.flush();
  audit(req.actor, 'dev.reset_demo_data');
  res.json({ ok: true, controls: getControls() });
}));

export default r;
