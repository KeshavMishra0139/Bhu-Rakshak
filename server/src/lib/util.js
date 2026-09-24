import crypto from 'node:crypto';

export const nowIso = () => new Date().toISOString();
export const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round = (v, d = 3) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
export const safeJson = (s, fallback = null) => {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};

/** Small async error wrapper for express routes. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}
