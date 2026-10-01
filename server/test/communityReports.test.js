import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `br-community-test-${process.pid}.db`);
for (const s of ['', '-wal', '-shm']) fs.rmSync(process.env.DB_PATH + s, { force: true });

const { seedIfEmpty } = await import('../src/db/seed.js');
const { q } = await import('../src/db/index.js');
const { communityReports } = await import('../src/routes/communityReports.js');

before(() => {
  seedIfEmpty();
  const uid = q.one("SELECT id FROM users WHERE email = 'citizen@demo.in'").id;
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 30 * 86400000).toISOString();
  const add = (id, status, at, desc = 'My house near the school, call 98xxxxxx') => q.run(
    `INSERT INTO reports(id, user_id, type, description, lat, lng, location_id, photo_path, status, created_at)
     VALUES (:id, :uid, 'crack', :desc, 27.331234, 88.612345, 'gangtok', 'uploads/reports/x.jpg', :status, :at)`, { id, uid, desc, status, at });
  add('r_new', 'submitted', now);
  add('r_ok', 'verified', now);
  add('r_bad', 'rejected', now);
  add('r_old', 'verified', old);
});

test('recent, non-rejected reports with a verified flag', () => {
  const list = communityReports(14);
  const ids = list.map((x) => x.id).sort();
  assert.deepEqual(ids, ['r_new', 'r_ok']);
  assert.equal(list.find((x) => x.id === 'r_ok').verified, true);
  assert.equal(list.find((x) => x.id === 'r_new').verified, false);
});

test('anonymised: no person, text or photo, position rounded to ~100 m', () => {
  for (const x of communityReports(14)) {
    for (const k of ['user_id', 'description', 'photo_path', 'reviewed_by']) assert.equal(x[k], undefined, k);
    assert.equal(x.lat, 27.331);
    assert.equal(x.lng, 88.612);
    assert.equal(x.has_photo, true);
    assert.equal(x.place.id, 'gangtok');
  }
});
