// Shared helpers for the dataset scripts: cached HTTP, CSV, seeded randomness, geo and terrain maths.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ML_ROOT = path.dirname(fileURLToPath(import.meta.url));
export const DATA = path.join(ML_ROOT, 'data');
const CACHE = path.join(DATA, 'cache');
const UA = 'Bhu-Rakshak/0.1 (SIH 2026 landslide early warning research; dataset build)';

// ---------- HTTP with an on-disk cache (re-runs are free and resumable) ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Polite pacing per host. Open-Meteo's free tier allows ~600 weighted calls/minute, and a 31-day hourly request
// counts as several calls, so keep well under it.
const PACE_MS = { 'open-meteo.com': 1100, 'power.larc.nasa.gov': 400, 'overpass-api.de': 1500, 'overpass.kumi.systems': 2000, 'maps.mail.ru': 2000, 'modis.ornl.gov': 300 };
const nextSlot = new Map();
async function pace(url) {
  const host = new URL(url).hostname;
  const key = Object.keys(PACE_MS).find((k) => host.endsWith(k));
  if (!key) return;
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(key) || 0);
  nextSlot.set(key, at + PACE_MS[key]);
  if (at > now) await sleep(at - now);
}

/** GET a URL as JSON (or text), cached by URL. Retries on 429/5xx/network errors with backoff. */
export async function getCached(url, { json = true, tries = 7, timeoutMs = 60000, cacheIf = () => true } = {}) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex') + (json ? '.json' : '.txt'));
  if (fs.existsSync(file)) {
    const t = fs.readFileSync(file, 'utf8');
    return json ? JSON.parse(t) : t;
  }
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      await pace(url);
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
      const t = await r.text();
      if (r.status === 429) {
        // Rate limited: wait out the window (Open-Meteo says "try again in one minute"), then retry.
        lastErr = new Error(`HTTP 429: ${t.slice(0, 120)}`);
        await sleep(65000);
        continue;
      }
      if (r.status >= 500) throw new Error(`HTTP ${r.status}: ${t.slice(0, 120)}`);
      if (!r.ok) {
        const err = new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
        err.permanent = true;
        throw err;
      }
      if (json && !cacheIf(JSON.parse(t))) return JSON.parse(t); // valid but incomplete (e.g. data not published yet): don't cache
      fs.writeFileSync(file, t);
      return json ? JSON.parse(t) : t;
    } catch (e) {
      lastErr = e;
      if (e.permanent) break;
      await sleep(2000 * 2 ** i);
    }
  }
  throw lastErr;
}

/** Run `fn` over items with at most `n` in flight; keeps order. */
export async function mapLimit(items, n, fn, onProgress) {
  const out = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
      done++;
      onProgress?.(done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

// ---------- CSV ----------
export function parseCsv(s) {
  const rows = [];
  let row = [];
  let f = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
      continue;
    }
    if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

export function writeCsv(file, rows, columns = Object.keys(rows[0] || {})) {
  const esc = (v) => {
    if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  fs.writeFileSync(file, [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n') + '\n');
}

// ---------- Randomness (seeded, so the dataset is reproducible) ----------
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Geo ----------
export function distanceKm(a, b) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

/** Same shaking estimate as the live site (server/src/ingest/seismic.js): I ≈ 1.5·M − 3.5·log10(R_hypo) + 3. */
export function intensityAt(e, p) {
  const r = Math.max(10, Math.hypot(distanceKm(e, p), e.depth_km || 10));
  return Math.min(12, Math.max(1, 1.5 * e.mag - 3.5 * Math.log10(r) + 3));
}

// ---------- Terrain from a 3×3 elevation window (Horn's method) ----------
/**
 * @param z 3×3 elevations, row-major from north-west: [z1..z9]
 * @param dx east–west spacing (m), dy north–south spacing (m)
 */
export function terrain3x3(z, dx, dy) {
  const [z1, z2, z3, z4, z5, z6, z7, z8, z9] = z;
  const dzdx = ((z3 + 2 * z6 + z9) - (z1 + 2 * z4 + z7)) / (8 * dx);
  const dzdy = ((z1 + 2 * z2 + z3) - (z7 + 2 * z8 + z9)) / (8 * dy); // north minus south
  const slope = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
  // Aspect: direction the slope faces, degrees clockwise from north (downhill direction).
  let aspect = (Math.atan2(-dzdx, -dzdy) * 180) / Math.PI;
  if (aspect < 0) aspect += 360;
  // Curvature (Zevenbergen & Thorne): negative = concave (collects water), positive = convex.
  const D = ((z4 + z6) / 2 - z5) / (dx * dx);
  const E = ((z2 + z8) / 2 - z5) / (dy * dy);
  const curvature = -2 * (D + E) * 100;
  return { slope, aspect, curvature };
}
