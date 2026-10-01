import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `br-corridor-test-${process.pid}.db`);
for (const s of ['', '-wal', '-shm']) fs.rmSync(process.env.DB_PATH + s, { force: true });

const { seedIfEmpty } = await import('../src/db/seed.js');
const { splitRoute, diversionPlaces, osrm, km } = await import('../src/routes/corridor.js');

before(() => seedIfEmpty());

// A straight 30 km line north from Sevoke, sampled every ~100 m.
const line = Array.from({ length: 271 }, (_, i) => [26.905 + i * 0.001, 88.475]);
const places = [{ id: 'sevoke', lat: 26.905, lng: 88.475 }, { id: 'far', lat: 28, lng: 92 }];

test('a route is cut into ~2 km segments that cover its whole length', () => {
  const segs = splitRoute(line, places);
  const total = line.slice(1).reduce((s, p, i) => s + km(line[i], p), 0);
  assert.ok(segs.length >= 14 && segs.length <= 16, `${segs.length} segments for ${total.toFixed(1)} km`);
  assert.ok(Math.abs(segs.reduce((s, x) => s + x.km, 0) - total) < 0.05);
  for (const s of segs) assert.ok(s.km > 1 && s.km < 3);
  assert.deepEqual(segs[0].coords[0], line[0]);
  assert.deepEqual(segs.at(-1).coords.at(-1), line.at(-1));
});

test('segments link to the nearest monitored place only within 8 km', () => {
  const segs = splitRoute(line, places);
  assert.equal(segs[0].place_id, 'sevoke');
  assert.ok(segs[0].place_km < 2);
  assert.equal(segs.at(-1).place_id, null, 'the far end is ~30 km away: not monitored');
  assert.equal(segs[5].place_id, null, '~11 km away is beyond the 8 km reach');
});

test('officer diversion notes become waypoints; anything else gives none', () => {
  assert.deepEqual(diversionPlaces('Via Lava – Algarah – Pedong – Rorathang (NH-717A)'), ['Lava', 'Algarah', 'Pedong', 'Rorathang']);
  assert.deepEqual(diversionPlaces('No alternative road. Hold vehicles at Mangan if closed.'), []);
});

test('OSRM responses are parsed to [lat, lng] and NoRoute gives no routes', async () => {
  const ok = async () => ({ ok: true, status: 200, json: async () => ({ code: 'Ok', routes: [{ distance: 1234.4, duration: 99.6, geometry: { coordinates: [[88.1, 27.1], [88.2, 27.2]] } }] }) });
  const routes = await osrm([[27.1, 88.1], [27.2, 88.2]], { fetchImpl: ok });
  assert.deepEqual(routes[0].coords, [[27.1, 88.1], [27.2, 88.2]]);
  assert.equal(routes[0].distance_m, 1234);
  const none = async () => ({ ok: false, status: 400, json: async () => ({ code: 'NoRoute' }) });
  assert.deepEqual(await osrm([[27.3, 88.3], [27.4, 88.4]], { fetchImpl: none }), []);
});
