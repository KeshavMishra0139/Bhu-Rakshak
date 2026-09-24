import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `br-gate-test-${process.pid}.db`);
process.env.SITE_PASSWORD = 'team-preview-123';
process.env.DISABLE_INGEST = 'true';
for (const s of ['', '-wal', '-shm']) fs.rmSync(process.env.DB_PATH + s, { force: true });

const { createApp } = await import('../src/index.js');
const { seedIfEmpty } = await import('../src/db/seed.js');

let server;
let base;
before(async () => {
  seedIfEmpty();
  const app = await createApp();
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

const login = (password, next = '/authority') => fetch(`${base}/__access`, {
  method: 'POST', redirect: 'manual',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ password, next }).toString(),
});

test('without the access cookie, pages redirect to the access form and the API is locked', async () => {
  const page = await fetch(`${base}/authority?x=1`, { redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), '/__access?next=%2Fauthority%3Fx%3D1');
  const api = await fetch(`${base}/api/locations`);
  assert.equal(api.status, 401);
  assert.deepEqual(await api.json(), { error: 'site_locked' });
  const form = await fetch(`${base}/__access`);
  assert.equal(form.status, 200);
  assert.match(await form.text(), /Access password/);
});

test('a wrong password is refused', async () => {
  const res = await login('nope');
  assert.equal(res.status, 401);
  assert.match(await res.text(), /Wrong password/);
});

test('the right password sets a cookie that opens pages and the API', async () => {
  const res = await login('team-preview-123');
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/authority');
  const cookie = res.headers.get('set-cookie').split(';')[0];
  assert.match(res.headers.get('set-cookie'), /HttpOnly/i);
  const api = await fetch(`${base}/api/locations`, { headers: { cookie } });
  assert.equal(api.status, 200);
  const forged = await fetch(`${base}/api/locations`, { headers: { cookie: 'br_site=forged' } });
  assert.equal(forged.status, 401);
});

test('the redirect after login never leaves the site', async () => {
  const res = await login('team-preview-123', '//evil.example/steal');
  assert.equal(res.headers.get('location'), '/');
});
