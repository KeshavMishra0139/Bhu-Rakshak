// Session → req.user (the real account) and req.actor (the effective role, which differs only when a
// developer is using "View as"). Every route checks req.actor on the server; the UI is never the only gate.
import { q } from '../db/index.js';
import { env } from '../config/env.js';
import { COOKIE, verifySession } from './jwt.js';
import { can } from './permissions.js';
import { HttpError, safeJson } from '../lib/util.js';

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, sub_role: u.sub_role, status: u.status,
    badge_id: u.badge_id, department: u.department, district: u.district, home_location_id: u.home_location_id,
    home_village: u.home_village, language: u.language, theme: u.theme, text_size: u.text_size,
    prefs: safeJson(u.prefs_json, {}), rejection_reason: u.rejection_reason, created_at: u.created_at,
  };
}

export function buildActor(user, viewAs) {
  const base = {
    userId: user.id, role: user.role, subRole: user.sub_role, district: user.district, status: user.status,
    homeLocationId: user.home_location_id, language: user.language, performedBy: user.email || user.phone || user.id,
    isDeveloper: user.role === 'developer', viewingAs: null,
  };
  if (user.role === 'developer' && viewAs && env.devModeEnabled) {
    const label = viewAs.role + (viewAs.sub_role ? `/${viewAs.sub_role}` : '');
    return {
      ...base,
      role: viewAs.role, subRole: viewAs.sub_role || null, district: viewAs.district || (viewAs.role === 'authority' ? 'All' : null),
      status: 'active', homeLocationId: viewAs.home_location_id || base.homeLocationId, language: viewAs.language || base.language,
      performedBy: `developer (as ${label})`, viewingAs: viewAs,
    };
  }
  return base;
}

const SUB_ROLES = ['district_officer', 'police', 'bro', 'rescue', 'sdma'];
/** Validate a developer "view as" description. Returns null when invalid. */
export function sanitizeViewAs(v) {
  if (!v || typeof v !== 'object' || !['authority', 'citizen', 'admin'].includes(v.role)) return null;
  if (v.role === 'authority' && !SUB_ROLES.includes(v.sub_role)) return null;
  const home = v.home_location_id && q.one('SELECT id FROM locations WHERE id = :id', { id: v.home_location_id }) ? v.home_location_id : null;
  return {
    role: v.role,
    sub_role: v.role === 'authority' ? v.sub_role : null,
    district: v.role === 'authority' ? (typeof v.district === 'string' ? v.district.slice(0, 40) : 'All') : null,
    home_location_id: v.role === 'citizen' ? (home || 'mangan') : null,
    language: ['en', 'hi'].includes(v.language) ? v.language : null,
  };
}

/** Per-request override (split view panes): header X-BR-View-As or ?view_as=, base64url JSON. Developers only. */
function paneOverride(req) {
  const raw = req.headers['x-br-view-as'] || req.query?.view_as;
  if (!raw) return undefined;
  try { return sanitizeViewAs(JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'))); } catch { return undefined; }
}

/** Non-failing: attaches req.user / req.actor when a valid session cookie is present. */
export function attachUser(req, _res, next) {
  const claims = verifySession(req.cookies?.[COOKIE]);
  if (claims?.uid) {
    const u = q.one('SELECT * FROM users WHERE id = :id', { id: claims.uid });
    if (u && !(u.role === 'developer' && !env.devModeEnabled)) {
      req.user = u;
      req.session = claims;
      const pane = u.role === 'developer' && env.devModeEnabled ? paneOverride(req) : undefined;
      req.actor = buildActor(u, pane === undefined ? claims.view_as : pane);
    }
  }
  next();
}

export function requireAuth({ allowPending = false } = {}) {
  return (req, _res, next) => {
    if (!req.actor) return next(new HttpError(401, 'not_signed_in'));
    if (!allowPending && req.user.status === 'pending') return next(new HttpError(403, 'pending_verification'));
    if (req.user.status === 'rejected') return next(new HttpError(403, 'account_rejected'));
    next();
  };
}

export const requireCap = (cap) => (req, _res, next) => {
  if (!req.actor) return next(new HttpError(401, 'not_signed_in'));
  if (!can(req.actor, cap)) return next(new HttpError(403, 'forbidden'));
  next();
};

/** Checks the REAL account role (used for admin + dev routes so "View as" never locks the developer out). */
export const requireRealRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'not_signed_in'));
  if (!roles.includes(req.user.role)) return next(new HttpError(403, 'forbidden'));
  next();
};

// ---- Simple in-memory rate limiter (per IP + bucket) ----
const hits = new Map();
export function rateLimit({ bucket, max, windowMs }) {
  return (req, _res, next) => {
    const key = `${bucket}:${req.ip}`;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return next(new HttpError(429, 'too_many_attempts'));
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}
export const resetRateLimits = () => hits.clear();
