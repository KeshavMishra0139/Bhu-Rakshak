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
const { answer, intentOf, INTENTS } = await import('../src/routes/insights.js');
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

const setRisk = (id, level, updatedAt, confidence = 0.7) => q.run("INSERT OR REPLACE INTO risk_state(location_id, score, level, confidence, drivers_json, trend, forecast_json, priority, model_version, level_since, updated_at) VALUES (:id, 0.8, :level, :c, '[{\"key\":\"rain_24h\",\"contribution\":40}]', 'rising', '[]', 0.6, 't', :n, :n)", { id, level, c: confidence, n: updatedAt });
const setWeather = (id, source, fetchedAt) => q.run('UPDATE weather_cache SET source = :source, fetched_at = :fetchedAt WHERE location_id = :id', { id, source, fetchedAt });
const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();

test('assistant answers from live data in the chosen language', () => {
  setRisk('gangtok', 'critical', new Date().toISOString());
  setWeather('gangtok', 'open-meteo', new Date().toISOString());
  const en = answer({ intent: 'travel', locationId: 'gangtok', lang: 'en' });
  assert.match(en.text, /Don't travel near Gangtok/);
  assert.ok(en.sources.includes('risk_model'));
  assert.ok(en.basis.risk_updated_at);
  const hi = answer({ intent: 'why', locationId: 'gangtok', lang: 'hi' });
  assert.match(hi.text, /गंगटोक/);
  assert.match(hi.text, /आज भारी बारिश/);
});

test('assistant never states a level without current data from the model', () => {
  // No risk record at all: no level, no "low".
  q.run("DELETE FROM risk_state WHERE location_id = 'mangan'");
  setWeather('mangan', 'open-meteo', new Date().toISOString());
  for (const intent of ['status', 'travel', 'why', 'prepare']) {
    const a = answer({ intent, locationId: 'mangan', lang: 'en' });
    assert.equal(a.level, null, intent);
    assert.match(a.text, /don't have up-to-date risk information for Mangan/, intent);
    assert.doesNotMatch(a.text, /risk (at|near) Mangan is|risk is (low|moderate|high|critical)/i, intent);
    assert.ok(!a.sources.includes('risk_model'), intent);
  }
  // Old risk record, old weather, or weather from the climatology fallback: same.
  setRisk('mangan', 'low', hoursAgo(5));
  assert.equal(answer({ intent: 'status', locationId: 'mangan', lang: 'en' }).level, null);
  setRisk('mangan', 'low', new Date().toISOString());
  setWeather('mangan', 'open-meteo', hoursAgo(4));
  assert.equal(answer({ intent: 'travel', locationId: 'mangan', lang: 'en' }).level, null);
  assert.match(answer({ intent: 'rain', locationId: 'mangan', lang: 'en' }).text, /don't have up-to-date rain data/);
  setWeather('mangan', 'fallback_climatology', new Date().toISOString());
  assert.match(answer({ intent: 'status', locationId: 'mangan', lang: 'hi' }).text, /ताज़ा जानकारी नहीं है/);
  // Emergency advice is always given; the level line only with current data.
  const em = answer({ intent: 'emergency', locationId: 'mangan', lang: 'en' });
  assert.match(em.text, /call 112 now/);
  assert.doesNotMatch(em.text, /risk at Mangan is/);
  // Fresh again: the level is stated, with its source.
  setWeather('mangan', 'open-meteo', new Date().toISOString());
  const ok = answer({ intent: 'status', locationId: 'mangan', lang: 'en' });
  assert.equal(ok.level, 'low');
  assert.match(ok.text, /risk at Mangan is low/);
  assert.deepEqual(ok.sources, ['risk_model']);
});

test('assistant flags low confidence', () => {
  setRisk('mangan', 'moderate', new Date().toISOString(), 0.45);
  setWeather('mangan', 'open-meteo', new Date().toISOString());
  assert.match(answer({ intent: 'status', locationId: 'mangan', lang: 'en' }).text, /rough guide: we are not very sure/);
});

test('assistant recognises safety questions in English and Hindi, danger first', () => {
  assert.equal(intentOf('What should I do if I see cracks?'), 'signs');
  assert.equal(intentOf('How do I report an incident?'), 'report');
  assert.equal(intentOf('Help me, my family is trapped near the road'), 'emergency');
  assert.equal(intentOf('दीवार में दरार दिख रही है'), 'signs');
  assert.equal(intentOf('मदद चाहिए'), 'emergency');
  assert.equal(intentOf('Is it safe to travel today?'), 'travel');
  assert.equal(intentOf('Should I clean the drains?'), 'prepare');
  assert.equal(intentOf('Am I safe?'), 'status');
  assert.equal(intentOf('Is my road open?'), 'roads');
  assert.equal(intentOf('क्या सड़क खुली है?'), 'roads');
  assert.match(answer({ intent: 'roads', locationId: 'gangtok', lang: 'en' }).text, /Roads near Gangtok: NH-10/);
});

test('assistant offers actions: road check for named places, report flow for what someone sees', () => {
  const q1 = 'Is my road to Mangan safe?';
  const a = answer({ intent: intentOf(q1), locationId: 'gangtok', lang: 'en', question: q1 });
  assert.deepEqual(a.action, { type: 'route_check', from: 'gangtok', to: 'mangan' });
  assert.match(a.text, /Check this road/);
  const q2 = 'is the road from Rangpo to Nathula open';
  assert.deepEqual(answer({ intent: intentOf(q2), locationId: 'gangtok', lang: 'en', question: q2 }).action, { type: 'route_check', from: 'rangpo', to: 'nathula_rd' });
  assert.equal(answer({ intent: 'travel', locationId: 'gangtok', lang: 'en' }).action, null);
  const q3 = "There's a crack in my wall";
  const b = answer({ intent: intentOf(q3), locationId: 'gangtok', lang: 'en', question: q3 });
  assert.deepEqual(b.action, { type: 'report', report_type: 'crack', ask_danger: true });
  const q4 = 'What should I do if I see cracks?';
  assert.equal(answer({ intent: intentOf(q4), locationId: 'gangtok', lang: 'en', question: q4 }).action, null);
  assert.equal(answer({ intent: 'report', locationId: 'gangtok', lang: 'en' }).action.type, 'report');
});

test('assistant explains each home card in plain words', () => {
  setRisk('gangtok', 'high', new Date().toISOString());
  setWeather('gangtok', 'open-meteo', new Date().toISOString());
  const s = answer({ intent: 'explain_status', locationId: 'gangtok', lang: 'en' });
  assert.match(s.text, /four levels/);
  assert.match(s.text, /Right now it is \*\*high\*\*/);
  assert.match(answer({ intent: 'explain_status', locationId: 'gangtok', lang: 'hi' }).text, /अभी स्तर \*\*उच्च\*\*/);
  assert.match(answer({ intent: 'explain_rain', locationId: 'gangtok', lang: 'en' }).text, /Taller bars mean heavier rain/);
  assert.match(answer({ intent: 'explain_roads', locationId: 'gangtok', lang: 'en' }).text, /Right now: NH-10/);
  assert.match(answer({ intent: 'explain_contacts', locationId: 'gangtok', lang: 'en' }).text, /\*\*112\*\* is free/);
  q.run("DELETE FROM risk_state WHERE location_id = 'mangan'");
  assert.doesNotMatch(answer({ intent: 'explain_status', locationId: 'mangan', lang: 'en' }).text, /Right now it is/);
});

test('assistant answers in Nepali, with the same safety rules', () => {
  setRisk('gangtok', 'high', new Date().toISOString());
  setWeather('gangtok', 'open-meteo', new Date().toISOString());
  const s = answer({ intent: 'status', locationId: 'gangtok', lang: 'ne' });
  assert.match(s.text, /गंगटोक मा पहिरोको जोखिम उच्च छ/);
  assert.match(s.text, /यात्रा नगर्नुहोस्/);
  assert.match(answer({ intent: 'travel', locationId: 'gangtok', lang: 'ne' }).text, /सडकहरू: NH-10/);
  assert.match(answer({ intent: 'emergency', locationId: 'gangtok', lang: 'ne' }).text, /११२ मा फोन गर्नुहोस्/);
  assert.match(answer({ intent: 'status', locationId: 'mangan', lang: 'ne' }).text, /ताजा जानकारी छैन/);
  assert.equal(intentOf('के म सुरक्षित छु?'), 'status');
  assert.equal(intentOf('मेरो सडक खुला छ?'), 'roads');
  // Every intent gives a Nepali answer (no English left over).
  for (const intent of INTENTS) assert.doesNotMatch(answer({ intent, locationId: 'gangtok', lang: 'ne' }).text, /\b(the|is|and|you)\b/i, intent);
  for (const s of ['the hill is falling', 'Help', 'rocks are falling on the road', "there's a landslide on NH10", 'पहाड़ गिर रहा है', 'भूस्खलन हो रहा है', 'पहिरो गयो', 'bachao']) assert.equal(intentOf(s), 'emergency', s);
  for (const s of ['What is the landslide risk?', 'is there a landslide risk today', 'Am I in danger?', 'क्या मैं खतरे में हूँ?', 'पहिरोको जोखिम कति छ?']) assert.notEqual(intentOf(s), 'emergency', s);
  const em = answer({ intent: 'emergency', locationId: 'gangtok', lang: 'en' });
  assert.match(em.text, /\*\*call 112 now\*\*/);
  assert.match(answer({ intent: 'report', locationId: 'gangtok', lang: 'hi' }).text, /रिपोर्ट/);
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
