import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `br-ops-${process.pid}.db`);
for (const s of ['', '-wal', '-shm']) fs.rmSync(process.env.DB_PATH + s, { force: true });

const { seedIfEmpty } = await import('../src/db/seed.js');
const { draftAlert } = await import('../src/routes/alerts.js');
const { answer } = await import('../src/routes/insights.js');
const { ensureFallback } = await import('../src/ingest/openMeteo.js');
const { q } = await import('../src/db/index.js');
const { can } = await import('../src/auth/permissions.js');

before(() => { seedIfEmpty(); ensureFallback(); });

test('alert drafts are bilingual and fill place and road', () => {
  const d = draftAlert({ targetType: 'location', targetId: 'mangan', severity: 'critical' });
  assert.match(d.title_en, /Critical.*Mangan/);
  assert.match(d.title_hi, /मंगन/);
  assert.match(d.body_en, /North Sikkim Highway/);
  assert.doesNotMatch(d.body_hi, /\{/);
  const clear = draftAlert({ targetType: 'corridor', targetId: 'north', severity: 'high', kind: 'all_clear' });
  assert.match(clear.title_en, /^All clear/);
});

test('assistant answers from live data in the chosen language', () => {
  q.run("INSERT OR REPLACE INTO risk_state(location_id, score, level, confidence, drivers_json, trend, forecast_json, priority, model_version, level_since, updated_at) VALUES ('gangtok', 0.8, 'critical', 0.7, '[{\"key\":\"rain_24h\",\"contribution\":40}]', 'rising', '[]', 0.6, 't', :n, :n)", { n: new Date().toISOString() });
  const en = answer({ intent: 'travel', locationId: 'gangtok', lang: 'en' });
  assert.match(en.text, /Don't travel near Gangtok/);
  const hi = answer({ intent: 'why', locationId: 'gangtok', lang: 'hi' });
  assert.match(hi.text, /गंगटोक/);
  assert.match(hi.text, /आज भारी बारिश/);
});

test('role-aware tools follow the permissions map', () => {
  const A = (subRole) => ({ role: 'authority', subRole, status: 'active' });
  assert.equal(can(A('police'), 'roads.close'), true);
  assert.equal(can(A('bro'), 'roads.close'), false);
  assert.equal(can(A('bro'), 'roads.status'), true);
  assert.equal(can(A('rescue'), 'resources.deploy'), true);
  assert.equal(can(A('rescue'), 'alerts.dispatch'), false);
  assert.equal(can(A('sdma'), 'scenario.control'), true);
  assert.equal(can({ role: 'citizen' }, 'reports.submit'), true);
});
