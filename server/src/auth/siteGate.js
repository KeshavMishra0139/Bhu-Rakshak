// Site-wide access password for private previews (SITE_PASSWORD in .env). When set, every page and API call
// needs a signed cookie that the /__access form grants; without it pages redirect to the form and the API
// answers 401. When unset, the gate is off. This sits in front of the app's own sign-in, not instead of it.
import crypto from 'node:crypto';
import express from 'express';
import { env } from '../config/env.js';

const COOKIE = 'br_site';
const MAX_AGE_MS = 7 * 24 * 3600000;
const ATTEMPTS = { max: 10, windowMs: 10 * 60000 };
const attempts = new Map();

// The cookie holds an HMAC of the password, so changing SITE_PASSWORD (or JWT_SECRET) signs everyone out.
const token = () => crypto.createHmac('sha256', env.jwtSecret).update(`site:${env.sitePassword}`).digest('base64url');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/__access') ? n : '/');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page(next, error) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Bhu-Rakshak · Private preview</title>
<link rel="icon" href="/favicon.svg">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: #0a151a; color: #e4edef;
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { width: 100%; max-width: 380px; background: #102028; border: 1px solid #243e4a; border-radius: 16px; padding: 28px; }
  h1 { margin: 0 0 4px; font-size: 1.35rem; } .hi { margin: 0; color: #96a8ae; font-size: .95rem; }
  p.lead { color: #96a8ae; margin: 14px 0 20px; font-size: .95rem; }
  label { display: block; font-weight: 600; font-size: .9rem; margin-bottom: 6px; }
  input { width: 100%; min-height: 44px; border-radius: 10px; border: 1px solid #243e4a; background: #0a151a; color: inherit; padding: 10px 12px; font-size: 1rem; }
  input:focus-visible, button:focus-visible { outline: 2px solid #7cc4cf; outline-offset: 2px; }
  button { margin-top: 14px; width: 100%; min-height: 44px; border: 0; border-radius: 10px; background: #5cb6c4; color: #071419; font-weight: 700; font-size: 1rem; cursor: pointer; }
  .err { margin: 12px 0 0; color: #ef5350; font-size: .9rem; }
</style></head>
<body><main>
  <h1>Bhu-Rakshak</h1><p class="hi">भू-रक्षक · Private preview</p>
  <p class="lead">This preview is for the team. Enter the access password to continue.<br>पूर्वावलोकन देखने के लिए पासवर्ड दर्ज करें।</p>
  <form method="post" action="/__access">
    <input type="hidden" name="next" value="${esc(next)}">
    <label for="pw">Access password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
    <button type="submit">Continue</button>
    ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
  </form>
</main></body></html>`;
}

export function siteGate() {
  const router = express.Router();
  if (!env.sitePassword) return router; // gate off

  router.get('/__access', (req, res) => {
    res.set('Cache-Control', 'no-store').type('html').send(page(safeNext(req.query.next), null));
  });

  router.post('/__access', express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
    const next = safeNext(req.body?.next);
    const key = req.ip;
    const now = Date.now();
    const recent = (attempts.get(key) || []).filter((t) => now - t < ATTEMPTS.windowMs);
    if (recent.length >= ATTEMPTS.max) {
      return res.status(429).type('html').send(page(next, 'Too many attempts. Try again in a few minutes.'));
    }
    if (!safeEqual(req.body?.password || '', env.sitePassword)) {
      attempts.set(key, [...recent, now]);
      return res.status(401).type('html').send(page(next, 'Wrong password.'));
    }
    attempts.delete(key);
    res.cookie(COOKIE, token(), { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: MAX_AGE_MS, path: '/' });
    res.redirect(303, next);
  });

  router.use((req, res, next) => {
    if (safeEqual(req.cookies?.[COOKIE] || '', token())) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'site_locked' });
    if (req.path === '/favicon.svg') return next();
    res.redirect(302, `/__access?next=${encodeURIComponent(req.originalUrl)}`);
  });
  return router;
}
