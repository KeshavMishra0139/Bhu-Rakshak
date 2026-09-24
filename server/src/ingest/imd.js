// IMD ingestion (backend only): district-wise warnings (5 days) and district-wise nowcast (next ~3 h)
// from the IMD API portal (api.imd.gov.in). Requests carry `x-api-key` and `Authorization: Bearer <JWT>`,
// both issued by the portal. Without them the feed reports 'not_configured' and the engine falls back to
// the Open-Meteo rain forecast, so risk behaves exactly as before.
// IMD's API guidelines require attribution to IMD wherever the data is shown.
import { q, tx } from '../db/index.js';
import { riskConfig, seedData } from '../config/shared.js';
import { env } from '../config/env.js';
import { nowIso, safeJson } from '../lib/util.js';
import { bus } from '../events/bus.js';
import { setFeed } from './openMeteo.js';

const DAY_MS = 86400000;
const IST_MS = 5.5 * 3600000;

/** District-warning codes that matter for landslides → rain severity 0..1. Other hazards (heat, fog…) score 0. */
export const WARNING_RAIN_SEVERITY = { 2: 0.45, 4: 0.2, 5: 0.2, 16: 0.75, 17: 1 };
/** Nowcast categories → rain severity 0..1 (rain, thunderstorms and hail). */
export const NOWCAST_RAIN_SEVERITY = { 2: 0.15, 4: 0.2, 7: 0.45, 9: 0.35, 12: 0.8, 14: 0.5, 15: 0.6, 31: 0.5 };
const COLOR_RANK = { green: 0, yellow: 1, orange: 2, red: 3 };
// The two products number their colours in opposite directions (IMD API reference).
const WARNING_COLOR = { 1: 'red', 2: 'orange', 3: 'yellow', 4: 'green' };
const NOWCAST_COLOR = { 1: 'green', 2: 'yellow', 3: 'orange', 4: 'red' };

const norm = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z]/g, '');
const pick = (row, ...keys) => {
  for (const k of keys) {
    const hit = Object.keys(row).find((x) => x.toLowerCase() === k.toLowerCase());
    if (hit && row[hit] != null && row[hit] !== '') return row[hit];
  }
  return null;
};
const codesOf = (v) => String(v ?? '').split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
const worstColor = (a, b) => ((COLOR_RANK[b] ?? -1) > (COLOR_RANK[a] ?? -1) ? b : a);

/** Rows from any IMD response shape: a bare array, { data: [...] }, or a single object. */
export function rowsOf(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.data)) return body.data;
  if (body && typeof body === 'object' && !body.error) return [body];
  return [];
}

/** Which of our districts an IMD row belongs to (null if none). */
export function matchDistrict(row, map = seedData.imdDistricts.districts) {
  const name = norm(pick(row, 'District', 'District_Name', 'DISTRICT', 'Station', 'Name'));
  const state = pick(row, 'State', 'STATE', 'State_Name');
  if (!name) return null;
  for (const [ours, d] of Object.entries(map)) {
    if (state && norm(state) !== norm(d.state)) continue;
    if (d.names.some((n) => norm(n) === name)) return ours;
  }
  return null;
}

export function warningSeverity(codes, color) {
  const s = Math.max(0, ...codes.map((c) => WARNING_RAIN_SEVERITY[c] || 0));
  if (!s) return 0;
  if (color === 'red') return Math.max(s, 0.85);
  if (color === 'orange') return Math.max(s, 0.6);
  return s;
}

/** Normalise one district-warning row. */
export function parseWarning(row) {
  const days = [];
  for (let d = 1; d <= 5; d++) {
    const codes = codesOf(pick(row, `Day_${d}`, `Day${d}`));
    const color = WARNING_COLOR[Number(pick(row, `Day${d}_Color`, `Day_${d}_Color`))] || null;
    days.push({ day: d, codes: codes.filter((c) => c !== 1), color, severity: warningSeverity(codes, color) });
  }
  return { date: pick(row, 'Date'), utc: pick(row, 'UTC', 'Time'), imd_district: pick(row, 'District'), days };
}

/** Parse "YYYY-mm-dd" + "HHmm" (IST) to epoch ms. */
function istToMs(date, hhmm) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ''));
  const t = /^(\d{1,2}):?(\d{2})/.exec(String(hhmm ?? '').padStart(4, '0'));
  if (!m || !t) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]) - IST_MS;
}

/** Normalise one district-nowcast row. */
export function parseNowcast(row) {
  const cats = [];
  for (const [k, v] of Object.entries(row)) {
    if (/^cat\d+$/i.test(k)) cats.push(...codesOf(v).filter((c) => c !== 1));
  }
  const date = pick(row, 'Date');
  const issued = istToMs(date, pick(row, 'toi'));
  let validUntil = istToMs(date, pick(row, 'Vupto', 'vupto'));
  if (issued != null && validUntil != null && validUntil < issued) validUntil += DAY_MS;
  const severity = Math.max(0, ...cats.map((c) => NOWCAST_RAIN_SEVERITY[c] || 0));
  return {
    imd_district: pick(row, 'District', 'Station'),
    color: NOWCAST_COLOR[Number(pick(row, 'color', 'Color'))] || null,
    cats: [...new Set(cats)],
    message: pick(row, 'message', 'Message'),
    issued_at: issued == null ? null : new Date(issued).toISOString(),
    valid_until: validUntil == null ? null : new Date(validUntil).toISOString(),
    severity,
  };
}

/** Several IMD districts can map to one of ours (e.g. Gangtok + Pakyong → East Sikkim): keep the worst. */
function mergeWarnings(a, b) {
  if (!a) return b;
  return {
    ...a,
    imd_district: [a.imd_district, b.imd_district].filter(Boolean).join(', '),
    days: a.days.map((d, i) => {
      const e = b.days[i];
      return { day: d.day, codes: [...new Set([...d.codes, ...e.codes])], color: worstColor(d.color, e.color), severity: Math.max(d.severity, e.severity) };
    }),
  };
}
const mergeNowcasts = (a, b) => (!a || b.severity > a.severity ? b : a);

/** Group parsed rows by our district. */
export function summarise(warningRows, nowcastRows) {
  const warnings = {};
  const nowcasts = {};
  for (const row of warningRows) {
    const d = matchDistrict(row);
    if (d) warnings[d] = mergeWarnings(warnings[d], parseWarning(row));
  }
  for (const row of nowcastRows) {
    const d = matchDistrict(row);
    if (d) nowcasts[d] = mergeNowcasts(nowcasts[d], parseNowcast(row));
  }
  return { warnings, nowcasts };
}

// ---------- In-memory view (read on every risk tick, so no DB access here) ----------
const cache = { warning: new Map(), nowcast: new Map() };

export function loadImdCache() {
  cache.warning.clear();
  cache.nowcast.clear();
  for (const r of q.all('SELECT product, district, data_json, fetched_at FROM imd_cache')) {
    cache[r.product]?.set(r.district, { ...safeJson(r.data_json, {}), fetched_at: r.fetched_at });
  }
}

/** Test hook: replace the in-memory view directly. */
export function setImdCache({ warnings = {}, nowcasts = {} }, fetchedAt = nowIso()) {
  cache.warning = new Map(Object.entries(warnings).map(([k, v]) => [k, { ...v, fetched_at: fetchedAt }]));
  cache.nowcast = new Map(Object.entries(nowcasts).map(([k, v]) => [k, { ...v, fetched_at: fetchedAt }]));
}

/** 1-based IMD day index of `atMs` for a warning issued on `date` (IST calendar days). */
function dayIndex(date, atMs) {
  const issued = istToMs(date, '0000');
  if (issued == null) return null;
  return Math.floor((atMs - issued) / DAY_MS) + 1;
}

const nowcastActive = (n, atMs) => n && n.valid_until && atMs <= new Date(n.valid_until).getTime()
  && (!n.issued_at || atMs >= new Date(n.issued_at).getTime() - 3600000);

/**
 * IMD rain severity 0..1 for a district at a moment, or null when IMD has nothing current for it
 * (the engine then falls back to the model rain forecast).
 */
export function imdSeverity(district, atMs) {
  const w = cache.warning.get(district);
  const n = cache.nowcast.get(district);
  let s = null;
  const idx = w ? dayIndex(w.date, atMs) : null;
  if (idx != null && idx >= 1 && idx <= 5) s = w.days[idx - 1].severity;
  if (nowcastActive(n, atMs)) s = Math.max(s ?? 0, n.severity);
  return s;
}

/** What people see: today's and the next two days' warnings plus any active nowcast. */
export function imdSummary(district, atMs) {
  const w = cache.warning.get(district);
  const n = cache.nowcast.get(district);
  const idx = w ? dayIndex(w.date, atMs) : null;
  const days = idx != null && idx >= 1 && idx <= 5 ? w.days.slice(idx - 1, idx + 2) : [];
  const nowcast = nowcastActive(n, atMs) && (n.cats.length || n.message)
    ? { color: n.color, cats: n.cats, message: n.message, valid_until: n.valid_until } : null;
  if (!days.length && !nowcast) return null;
  return {
    days: days.map((d) => ({ codes: d.codes, color: d.color })),
    nowcast,
    issued: w ? { date: w.date, utc: w.utc } : null,
    fetched_at: w?.fetched_at || n?.fetched_at || null,
    source: 'IMD',
  };
}

// ---------- Fetch ----------
async function getJson(path, fetchImpl, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${env.imdBaseUrl}/${path}`, {
      signal: ctrl.signal,
      headers: { 'x-api-key': env.imdApiKey, Authorization: `Bearer ${env.imdToken}`, Accept: 'application/json', 'User-Agent': 'Bhu-Rakshak/0.1 (SIH 2026 prototype)' },
    });
    const text = await res.text();
    const body = safeJson(text, null);
    if (!res.ok || body?.error) throw new Error(body?.error || `HTTP ${res.status}`);
    if (body == null) throw new Error('response was not JSON');
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export const imdConfigured = () => !!(env.imdApiKey && env.imdToken);

/** Fetch warnings and nowcasts for all districts. Keeps the last cached data on any failure. */
export async function refreshImd({ fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  if (!imdConfigured()) {
    setFeed('imd', 'not_configured', 'Set IMD_API_KEY and IMD_TOKEN (from api.imd.gov.in)', false);
    return { ok: false, reason: 'not_configured' };
  }
  try {
    const [warnBody, nowBody] = await Promise.all([
      getJson('districtwarning', fetchImpl, timeoutMs),
      getJson('districtnowcast', fetchImpl, timeoutMs).catch((e) => ({ __error: e.message })),
    ]);
    const { warnings, nowcasts } = summarise(rowsOf(warnBody), nowBody.__error ? [] : rowsOf(nowBody));
    const matched = Object.keys(warnings).length;
    if (!matched) throw new Error('no Sikkim / Darjeeling / Kalimpong districts found in the IMD response');
    const fetchedAt = nowIso();
    tx(() => {
      for (const [district, data] of Object.entries(warnings)) {
        q.run(`INSERT INTO imd_cache(product, district, data_json, fetched_at) VALUES ('warning', :d, :j, :at)
               ON CONFLICT(product, district) DO UPDATE SET data_json = excluded.data_json, fetched_at = excluded.fetched_at`,
        { d: district, j: JSON.stringify(data), at: fetchedAt });
      }
      if (!nowBody.__error) {
        q.run("DELETE FROM imd_cache WHERE product = 'nowcast'");
        for (const [district, data] of Object.entries(nowcasts)) {
          q.run("INSERT INTO imd_cache(product, district, data_json, fetched_at) VALUES ('nowcast', :d, :j, :at)",
            { d: district, j: JSON.stringify(data), at: fetchedAt });
        }
      }
    });
    loadImdCache();
    const note = nowBody.__error ? ` (nowcast unavailable: ${nowBody.__error})` : '';
    setFeed('imd', nowBody.__error ? 'degraded' : 'ok', `${matched} districts${note}`, true);
    bus.emit('weather_refreshed', { at: fetchedAt, source: 'imd' });
    return { ok: true, districts: matched };
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'timeout' : e.message;
    const cached = q.one('SELECT COUNT(*) AS n FROM imd_cache').n;
    setFeed('imd', cached ? 'degraded' : 'error', cached ? `Serving last IMD data (${msg})` : msg, false);
    if (process.env.NODE_ENV !== 'test') console.warn(`[imd] refresh failed: ${msg}`);
    return { ok: false, reason: msg };
  }
}

let cronTask;
let intervalHandle;
export async function startImdSchedule() {
  loadImdCache();
  if (env.disableIngest) {
    setFeed('imd', 'degraded', 'Ingest disabled by DISABLE_INGEST', false);
    return;
  }
  refreshImd();
  if (!imdConfigured()) return;
  const minutes = riskConfig.live.imdRefreshMinutes || 30;
  try {
    const cron = (await import('node-cron')).default;
    cronTask = cron.schedule(`*/${minutes} * * * *`, () => refreshImd(), { timezone: 'Asia/Kolkata' });
  } catch {
    intervalHandle = setInterval(() => refreshImd(), minutes * 60000);
  }
}
export function stopImdSchedule() {
  cronTask?.stop();
  if (intervalHandle) clearInterval(intervalHandle);
}
