import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `br-poll-test-${process.pid}.db`);
for (const s of ['', '-wal', '-shm']) fs.rmSync(process.env.DB_PATH + s, { force: true });

const { seedIfEmpty } = await import('../src/db/seed.js');
const { q } = await import('../src/db/index.js');
const { bus } = await import('../src/events/bus.js');
const { wireSse, eventsSince, currentSeq } = await import('../src/events/sse.js');
const { buildActor } = await import('../src/auth/middleware.js');

let officer;
let citizen;
before(() => {
  seedIfEmpty();
  wireSse();
  officer = buildActor(q.one("SELECT * FROM users WHERE email = 'officer@demo.in'"));
  citizen = buildActor(q.one("SELECT * FROM users WHERE email = 'citizen@demo.in'"));
});

test('polled events follow the same visibility rules as the stream', () => {
  const since = currentSeq();
  bus.emit('road_updated', { id: 'r1', status: 'blocked' });
  bus.emit('incident_updated', { id: 'inc1', location_id: 'mangan' });
  bus.emit('risk_update', [{ location_id: 'mangan', score: 0.8, level: 'critical', drivers: [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }], conditions: { rain_24h: 90, sm_0_1: 0.4 } }]);

  const off = eventsSince(since, officer, officer.userId);
  assert.equal(off.complete, true);
  assert.deepEqual(off.events.map((e) => e.type), ['road_updated', 'incident_updated', 'risk_update']);
  assert.equal(off.events[2].data[0].drivers.length, 4, 'officers get full risk detail');

  const cit = eventsSince(since, citizen, null);
  assert.deepEqual(cit.events.map((e) => e.type), ['road_updated', 'risk_update'], 'citizens do not see incidents');
  assert.equal(cit.events[1].data[0].drivers.length, 3, 'citizens get the top three reasons');
  assert.equal(cit.events[1].data[0].conditions.sm_0_1, undefined);
});

test('a client resumes after its last sequence number, and resyncs after a server restart', () => {
  const since = currentSeq();
  bus.emit('road_updated', { id: 'r2', status: 'open' });
  const first = eventsSince(since, officer, officer.userId);
  assert.equal(first.events.length, 1);
  assert.equal(eventsSince(first.seq, officer, officer.userId).events.length, 0);
  const ahead = eventsSince(first.seq + 1000, officer, officer.userId);
  assert.equal(ahead.complete, false, 'a sequence from before a restart forces a fresh snapshot');
});
