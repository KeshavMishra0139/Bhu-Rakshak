// SQLite access via Node's built-in node:sqlite (Node >= 22.13) — no native build step needed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { env } from '../config/env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let db;

export function openDb(file = env.dbPath) {
  if (db) return db;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  return db;
}

export function closeDb() {
  if (db) { db.close(); db = undefined; stmtCache.clear(); }
}

const stmtCache = new Map();
function prep(sql) {
  const d = openDb();
  let s = stmtCache.get(sql);
  if (!s) {
    // node:sqlite rejects unknown named parameters, so remember which ones this statement uses.
    const names = new Set([...sql.replace(/'[^']*'/g, '').matchAll(/[:@$]([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]));
    s = { stmt: d.prepare(sql), names };
    stmtCache.set(sql, s);
  }
  return s;
}
const bind = (s, params) => {
  const out = {};
  for (const k of s.names) out[k] = params[k] === undefined ? null : params[k];
  return out;
};

// Plain-object copies (node:sqlite rows have a null prototype).
const plain = (r) => (r ? { ...r } : undefined);

export const q = {
  one: (sql, params = {}) => { const s = prep(sql); return plain(s.stmt.get(bind(s, params))); },
  all: (sql, params = {}) => { const s = prep(sql); return s.stmt.all(bind(s, params)).map(plain); },
  run: (sql, params = {}) => { const s = prep(sql); return s.stmt.run(bind(s, params)); },
  exec: (sql) => openDb().exec(sql),
};

/** Run fn inside a transaction. Nested calls join the outer transaction. */
let depth = 0;
export function tx(fn) {
  const d = openDb();
  if (depth > 0) return fn();
  d.exec('BEGIN');
  depth++;
  try {
    const out = fn();
    d.exec('COMMIT');
    return out;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  } finally {
    depth--;
  }
}

export const settings = {
  get(key, fallback = null) {
    const r = q.one('SELECT value FROM app_settings WHERE key = :key', { key });
    if (!r) return fallback;
    try { return JSON.parse(r.value); } catch { return fallback; }
  },
  set(key, value) {
    q.run('INSERT INTO app_settings(key, value) VALUES (:key, :value) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      { key, value: JSON.stringify(value) });
  },
};
