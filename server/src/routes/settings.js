import { Router } from 'express';
import { q } from '../db/index.js';
import { requireAuth, publicUser } from '../auth/middleware.js';
import { hashPassword, verifyPassword, passwordProblem } from '../auth/password.js';
import { clearSessionCookie } from '../auth/jwt.js';
import { riskConfig } from '../config/shared.js';
import { audit } from '../lib/audit.js';
import { ah, HttpError, nowIso, safeJson } from '../lib/util.js';

const r = Router();

export const DEFAULT_PREFS = {
  alerts_my_area: true,
  road_closures: true,
  alarm_sound: true,
  alarm_volume: riskConfig.citizenAlarm.defaultVolume,
  vibration: true,
  browser_notifications: false,
  inbox_chime: true,
  sound_unlocked_prompt_seen: false,
};

const PREF_TYPES = {
  alerts_my_area: 'boolean', road_closures: 'boolean', alarm_sound: 'boolean', alarm_volume: 'number', vibration: 'boolean',
  browser_notifications: 'boolean', inbox_chime: 'boolean', sound_unlocked_prompt_seen: 'boolean',
};

r.get('/settings', requireAuth({ allowPending: true }), (req, res) => {
  const u = publicUser(req.user);
  res.json({ profile: u, prefs: { ...DEFAULT_PREFS, ...u.prefs } });
});

r.put('/settings', requireAuth({ allowPending: true }), ah(async (req, res) => {
  const b = req.body || {};
  const u = req.user;
  const patch = {};
  if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim().slice(0, 80);
  if (b.language && ['en', 'hi'].includes(b.language)) patch.language = b.language;
  if (b.theme && ['light', 'dark', 'system'].includes(b.theme)) patch.theme = b.theme;
  if (b.text_size && ['normal', 'large'].includes(b.text_size)) patch.text_size = b.text_size;
  if (b.home_location_id !== undefined) {
    if (b.home_location_id && !q.one('SELECT id FROM locations WHERE id = :id', { id: b.home_location_id })) throw new HttpError(400, 'invalid_location');
    patch.home_location_id = b.home_location_id || null;
  }
  if (typeof b.home_village === 'string') patch.home_village = b.home_village.trim().slice(0, 80) || null;
  if (typeof b.phone === 'string') {
    const phone = b.phone.replace(/[\s-]/g, '') || null;
    if (phone && !/^(\+91)?[6-9]\d{9}$/.test(phone)) throw new HttpError(400, 'invalid_phone');
    if (phone && q.one('SELECT 1 AS x FROM users WHERE phone = :p AND id != :id', { p: phone, id: u.id })) throw new HttpError(409, 'phone_taken');
    patch.phone = phone;
  }
  if (b.prefs && typeof b.prefs === 'object') {
    const cur = { ...DEFAULT_PREFS, ...safeJson(u.prefs_json, {}) };
    for (const [k, v] of Object.entries(b.prefs)) {
      if (PREF_TYPES[k] && typeof v === PREF_TYPES[k]) cur[k] = k === 'alarm_volume' ? Math.min(1, Math.max(0, v)) : v;
    }
    patch.prefs_json = JSON.stringify(cur);
  }
  const keys = Object.keys(patch);
  if (keys.length) {
    q.run(`UPDATE users SET ${keys.map((k) => `${k} = :${k}`).join(', ')}, updated_at = :now WHERE id = :id`, { ...patch, now: nowIso(), id: u.id });
    audit(req.actor, 'settings.update', 'user', u.id, { fields: keys });
  }
  const fresh = publicUser(q.one('SELECT * FROM users WHERE id = :id', { id: u.id }));
  res.json({ profile: fresh, prefs: { ...DEFAULT_PREFS, ...fresh.prefs } });
}));

r.post('/settings/password', requireAuth({ allowPending: true }), ah(async (req, res) => {
  const { current, next } = req.body || {};
  if (!(await verifyPassword(String(current || ''), req.user.password_hash))) throw new HttpError(400, 'wrong_current_password');
  const pp = passwordProblem(next);
  if (pp) throw new HttpError(400, pp);
  q.run('UPDATE users SET password_hash = :h, updated_at = :now WHERE id = :id', { h: await hashPassword(next), now: nowIso(), id: req.user.id });
  audit(req.actor, 'settings.change_password', 'user', req.user.id);
  res.json({ ok: true });
}));

r.delete('/settings/account', requireAuth({ allowPending: true }), ah(async (req, res) => {
  if (['admin', 'developer'].includes(req.user.role)) throw new HttpError(400, 'cannot_delete_admin');
  if (!(await verifyPassword(String(req.body?.password || ''), req.user.password_hash))) throw new HttpError(400, 'wrong_current_password');
  audit(req.actor, 'settings.delete_account', 'user', req.user.id);
  q.run('UPDATE reports SET user_id = NULL WHERE user_id = :id', { id: req.user.id });
  q.run('DELETE FROM users WHERE id = :id', { id: req.user.id });
  clearSessionCookie(res);
  res.json({ ok: true });
}));

export default r;
