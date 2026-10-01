// SQLite access via Node's built-in node:sqlite (Node >= 22.13) — no native build step needed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { env } from '../config/env.js';
import { LANGUAGES, LANGUAGE_CHECK } from '../config/languages.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let db;

export function openDb(file = env.dbPath) {
  if (db) return db;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  migrateUserLanguages(db);
  return db;
}

/**
 * Migration: older databases limit users.language to fewer languages (en/hi, then en/hi/ne). SQLite can't change
 * a CHECK in place, so the table is rebuilt (same columns, rows and indexes) inside one transaction, and rolled back
 * if the row count changes or any foreign key would break. No-op once the CHECK lists every language in LANGUAGES.
 */
function migrateUserLanguages(d) {
  const row = d.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  const m = row?.sql.match(/CHECK \(language IN \(([^)]*)\)\)/);
  if (!m) return;
  const have = m[1].split(',').map((x) => x.trim().replace(/'/g, ''));
  if (LANGUAGES.every((l) => have.includes(l))) return;
  const indexes = d.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'users' AND sql IS NOT NULL").all().map((r) => r.sql);
  const createNew = row.sql.replace(m[0], LANGUAGE_CHECK).replace(/^CREATE TABLE (IF NOT EXISTS )?"?users"?/, 'CREATE TABLE users_new');
  const before = d.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  d.exec('PRAGMA foreign_keys = OFF');
  try {
    d.exec('BEGIN');
    d.exec(createNew);
    d.exec('INSERT INTO users_new SELECT * FROM users');
    d.exec('DROP TABLE users');
    d.exec('ALTER TABLE users_new RENAME TO users');
    for (const sql of indexes) d.exec(sql);
    const after = d.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    const broken = d.prepare('PRAGMA foreign_key_check').all();
    if (after !== before || broken.length) throw new Error(`users migration check failed (${before}→${after} rows, ${broken.length} broken references)`);
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  } finally {
    d.exec('PRAGMA foreign_keys = ON');
  }
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
