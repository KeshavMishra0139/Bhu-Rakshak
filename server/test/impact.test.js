import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `br-impact-test-${process.pid}.db`);
for (const s of ['', '-wal', '-shm']) fs.rmSync(process.env.DB_PATH + s, { force: true });

const { seedIfEmpty } = await import('../src/db/seed.js');
const { impactFor } = await import('../src/routes/impact.js');
const { q } = await import('../src/db/index.js');

before(() => seedIfEmpty());

test('every monitored place has OSM exposure counts', () => {
  for (const { id } of q.all('SELECT id FROM locations')) {
    const x = impactFor(id);
    assert.ok(x.osm, `${id} has OSM counts`);
    assert.equal(x.radius_km, 1);
    for (const k of ['buildings', 'schools', 'health', 'hospitals']) assert.ok(Number.isInteger(x.osm[k]) && x.osm[k] >= 0, `${id}.${k}`);
    assert.ok(x.osm.hospitals <= x.osm.health);
    assert.equal(x.source.name, 'OpenStreetMap');
  }
});

test('monitored road segments through a place come with their status', () => {
  const x = impactFor('rangpo');
  assert.ok(x.segments.length >= 2, 'Rangpo sits on two NH-10 segments');
  for (const s of x.segments) assert.ok(['open', 'caution', 'restricted', 'blocked', 'cleared'].includes(s.status));
  assert.equal(impactFor('no_such_place'), null);
});
