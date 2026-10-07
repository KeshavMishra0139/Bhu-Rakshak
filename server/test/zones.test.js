import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `br-zones-test-${process.pid}.db`);
process.env.DISABLE_INGEST = 'true';
process.env.SITE_PASSWORD = ''; // no preview gate here, whatever the local .env says
for (const s of ['', '-wal', '-shm']) fs.rmSync(process.env.DB_PATH + s, { force: true });

const { createApp } = await import('../src/index.js');
const { seedIfEmpty } = await import('../src/db/seed.js');
const { exposureAll } = await import('../src/routes/zones.js');

let server;
let base;
before(async () => {
  seedIfEmpty();
  const app = await createApp();
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

test('red-zone exposure: real OSM counts, with seed values kept separate and named as such', () => {
  const ex = exposureAll();
  assert.equal(ex.osm.radius_km, 1);
  const mangan = ex.places.mangan;
  assert.equal(typeof mangan.osm.buildings, 'number');
  assert.ok('schools' in mangan.osm && 'health' in mangan.osm);
  // Seed placeholders are separate fields whose names say what they are.
  assert.ok('population_estimate' in mangan && 'slope_deg_sample' in mangan);
});

test('red-zone exposure is for signed-in officials only', async () => {
  const res = await fetch(`${base}/api/zones/exposure`);
  assert.equal(res.status, 401);
});
