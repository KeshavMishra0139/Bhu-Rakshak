import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
process.env.NODE_ENV = 'test';
const file = path.join(os.tmpdir(), `br-migrate-${process.pid}.db`);
for (const s of ['', '-wal', '-shm']) fs.rmSync(file + s, { force: true });
process.env.DB_PATH = file;

test('databases from before Nepali are migrated to allow it, keeping every user and reference', async () => {
  // Build a database the old way: the current schema, but users.language limited to en/hi, with data in it.
  const schema = fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8').replace("CHECK (language IN ('en','hi','ne'))", "CHECK (language IN ('en','hi'))");
  const old = new DatabaseSync(file);
  old.exec(schema);
  old.exec("INSERT INTO users(id, name, email, password_hash, role, language, created_at, updated_at) VALUES ('u1', 'A', 'a@x.in', 'h', 'citizen', 'hi', 'now', 'now')");
  old.exec("INSERT INTO reports(id, user_id, type, status, created_at) VALUES ('r1', 'u1', 'debris', 'submitted', 'now')");
  assert.throws(() => old.exec("UPDATE users SET language = 'ne' WHERE id = 'u1'"), /CHECK/);
  old.close();

  const { openDb, q } = await import('../src/db/index.js');
  openDb();
  q.run("UPDATE users SET language = 'ne' WHERE id = 'u1'");
  assert.equal(q.one("SELECT language FROM users WHERE id = 'u1'").language, 'ne');
  assert.equal(q.one("SELECT COUNT(*) AS n FROM reports WHERE user_id = 'u1'").n, 1, 'references kept');
  assert.throws(() => q.run("INSERT INTO users(id, name, email, password_hash, role, language, created_at, updated_at) VALUES ('u2', 'B', 'a@x.in', 'h', 'citizen', 'en', 'now', 'now')"), /UNIQUE/, 'unique email still enforced');
  assert.throws(() => q.run("UPDATE users SET language = 'fr' WHERE id = 'u1'"), /CHECK/, 'still only known languages');
});
