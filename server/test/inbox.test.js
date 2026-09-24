import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `br-test-${process.pid}.db`);
for (const s of ['', '-wal', '-shm']) fs.rmSync(process.env.DB_PATH + s, { force: true });

const { seedIfEmpty } = await import('../src/db/seed.js');
const { q } = await import('../src/db/index.js');
const inbox = await import('../src/notifications/inbox.js');
const { can } = await import('../src/auth/permissions.js');

before(() => seedIfEmpty());

const ev = (location_id, to = 'critical') => ({ location_id, from: 'moderate', to, score: 0.8, confidence: 0.7, drivers: [{ key: 'rain_24h', contribution: 40 }], trend: 'rising', forecast: [], priority: 0.6 });
const visible = (actor) => { const v = inbox.visibilitySql(actor); return q.all(`SELECT m.location_id FROM inbox_messages m WHERE ${v.where}`, v.params).map((r) => r.location_id); };

test('routing: road + populated location reaches every authority role', () => {
  const r = inbox.routingFor('mangan');
  assert.deepEqual([...r.roles].sort(), ['bro', 'district_officer', 'police', 'rescue', 'sdma']);
});

test('visibility by role and district', () => {
  inbox.onEscalation(ev('mangan'));   // North Sikkim
  inbox.onEscalation(ev('gangtok'));  // East Sikkim
  assert.deepEqual(visible({ role: 'authority', subRole: 'sdma', district: 'All' }).sort(), ['gangtok', 'mangan']);
  assert.deepEqual(visible({ role: 'authority', subRole: 'police', district: 'East Sikkim' }), ['gangtok']);
  assert.deepEqual(visible({ role: 'authority', subRole: 'bro', district: 'North Sikkim' }), ['mangan']);
  assert.deepEqual(visible({ role: 'citizen' }), []);
});

test('unacknowledged Critical re-escalates; acknowledging closes the chain', () => {
  q.run("INSERT INTO risk_state(location_id, score, level, confidence, drivers_json, trend, forecast_json, priority, model_version, level_since, updated_at) VALUES ('mangan', 0.8, 'critical', 0.7, '[]', 'rising', '[]', 0.6, 't', :now, :now)", { now: new Date().toISOString() });
  const later = Date.now() + 11 * 60000;
  const re = inbox.checkEscalations(later).filter((m) => m.location_id === 'mangan');
  assert.equal(re.length, 1);
  assert.equal(re[0].escalated, 1);
  const officer = q.one("SELECT id FROM users WHERE email = 'officer@demo.in'");
  inbox.acknowledge(re[0].id, { userId: officer.id, performedBy: 'officer@demo.in' });
  const open = q.one("SELECT COUNT(*) AS n FROM inbox_messages WHERE location_id = 'mangan' AND acknowledged_at IS NULL").n;
  assert.equal(open, 0);
});

test('permissions: pending authority has no capabilities; only DO/SDMA dispatch alerts', () => {
  assert.equal(can({ role: 'authority', subRole: 'sdma', status: 'pending' }, 'inbox.read'), false);
  assert.equal(can({ role: 'authority', subRole: 'police', status: 'active' }, 'alerts.dispatch'), false);
  assert.equal(can({ role: 'authority', subRole: 'district_officer', status: 'active' }, 'alerts.dispatch'), true);
  assert.equal(can({ role: 'citizen' }, 'inbox.read'), false);
});
