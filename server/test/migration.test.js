import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
process.env.NODE_ENV = 'test';
const fileFor = (tag) => path.join(os.tmpdir(), `br-migrate-${tag}-${process.pid}.db`);
const file = fileFor('a');
for (const f of [file, fileFor('b')]) for (const s of ['', '-wal', '-shm']) fs.rmSync(f + s, { force: true });
process.env.DB_PATH = file;

const CURRENT = "CHECK (language IN ('en','hi','ne','as','kha','lus','nag'))";
/** A database built the old way: today's schema but users.language limited to `check`, with a user and a report. */
function oldDatabase(f, check, lang) {
  const schema = fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8').replace(CURRENT, check);
  const old = new DatabaseSync(f);
  old.exec(schema);
  old.exec(`INSERT INTO users(id, name, email, password_hash, role, language, created_at, updated_at) VALUES ('u1', 'A', 'a@x.in', 'h', 'citizen', '${lang}', 'now', 'now')`);
  old.exec("INSERT INTO reports(id, user_id, type, status, created_at) VALUES ('r1', 'u1', 'debris', 'submitted', 'now')");
  assert.throws(() => old.exec("UPDATE users SET language = 'kha' WHERE id = 'u1'"), /CHECK/);
  old.close();
}

test('databases from before Nepali are migrated to allow every language, keeping every user and reference', async () => {
  oldDatabase(file, "CHECK (language IN ('en','hi'))", 'hi');
  const { openDb, q } = await import('../src/db/index.js');
  openDb();
  for (const l of ['ne', 'as', 'kha', 'nag', 'lus']) q.run("UPDATE users SET language = :l WHERE id = 'u1'", { l });
  assert.equal(q.one("SELECT language FROM users WHERE id = 'u1'").language, 'lus');
  assert.equal(q.one("SELECT COUNT(*) AS n FROM reports WHERE user_id = 'u1'").n, 1, 'references kept');
  assert.throws(() => q.run("INSERT INTO users(id, name, email, password_hash, role, language, created_at, updated_at) VALUES ('u2', 'B', 'a@x.in', 'h', 'citizen', 'en', 'now', 'now')"), /UNIQUE/, 'unique email still enforced');
  assert.throws(() => q.run("UPDATE users SET language = 'fr' WHERE id = 'u1'"), /CHECK/, 'still only known languages');
});

test('databases with en/hi/ne are migrated too, and opening again is harmless', async () => {
  const { openDb, closeDb, q } = await import('../src/db/index.js');
  closeDb();
  const f = fileFor('b');
  oldDatabase(f, "CHECK (language IN ('en','hi','ne'))", 'ne');
  openDb(f);
  q.run("UPDATE users SET language = 'as' WHERE id = 'u1'");
  closeDb();
  openDb(f);
  assert.equal(q.one("SELECT language FROM users WHERE id = 'u1'").language, 'as');
  assert.equal(q.one('SELECT COUNT(*) AS n FROM users').n, 1);
  closeDb();
});
