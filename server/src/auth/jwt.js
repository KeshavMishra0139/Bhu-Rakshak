import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const COOKIE = 'br_session';
const TTL_SECONDS = 7 * 24 * 3600;

export const signSession = (payload) => jwt.sign(payload, env.jwtSecret, { expiresIn: TTL_SECONDS, algorithm: 'HS256' });
export function verifySession(token) {
  try { return jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] }); } catch { return null; }
}

export function setSessionCookie(res, payload) {
  res.cookie(COOKIE, signSession(payload), {
    httpOnly: true, sameSite: 'lax', secure: env.isProd, maxAge: TTL_SECONDS * 1000, path: '/',
  });
}
export const clearSessionCookie = (res) => res.clearCookie(COOKIE, { path: '/' });
