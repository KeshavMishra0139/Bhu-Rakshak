import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `br-imd-test-${process.pid}.db`);
process.env.IMD_API_KEY = 'test-key';
process.env.IMD_TOKEN = 'test-jwt';
for (const s of ['', '-wal', '-shm']) fs.rmSync(process.env.DB_PATH + s, { force: true });

const imd = await import('../src/ingest/imd.js');
const { normaliseDynamic, scoreFrom, normaliseStatic } = await import('../src/prediction/engine.js');
const { seedIfEmpty } = await import('../src/db/seed.js');
const { q } = await import('../src/db/index.js');

before(() => seedIfEmpty());

const HOUR = 3600000;
const istDate = (ms = Date.now()) => new Date(ms + 5.5 * HOUR).toISOString().slice(0, 10);
const istHHmm = (ms) => new Date(ms + 5.5 * HOUR).toISOString().slice(11, 16).replace(':', '');
const warningRow = (District, days, extra = {}) => ({
  Obj_id: '1', Date: istDate(), UTC: '0630', District,
  ...Object.fromEntries(days.flatMap(([codes, color], i) => [[`Day_${i + 1}`, codes], [`Day${i + 1}_Color`, String(color)]])),
  ...extra,
});
const NO_WARNING = ['1', 4];

test('district matching uses old and new Sikkim names and respects the state', () => {
  assert.equal(imd.matchDistrict({ District: 'GANGTOK' }), 'East Sikkim');
  assert.equal(imd.matchDistrict({ District: 'Mangan', State: 'Sikkim' }), 'North Sikkim');
  assert.equal(imd.matchDistrict({ District: 'DARJEELING', State: 'WEST BENGAL' }), 'Darjeeling');
  assert.equal(imd.matchDistrict({ District: 'DARJEELING', State: 'SIKKIM' }), null);
  assert.equal(imd.matchDistrict({ District: 'NEW DELHI' }), null);
});

test('warning colours and rain severity follow the IMD codes', () => {
  const w = imd.parseWarning(warningRow('GANGTOK', [['2,4', 2], ['17', 1], ['9', 1], NO_WARNING, NO_WARNING]));
  assert.deepEqual(w.days[0], { day: 1, codes: [2, 4], color: 'orange', severity: 0.6 });
  assert.equal(w.days[1].color, 'red');
  assert.equal(w.days[1].severity, 1);
  assert.equal(w.days[2].severity, 0, 'a red heat-wave warning is not a rain warning');
  assert.deepEqual(w.days[3].codes, [], 'code 1 (no warning) is dropped');
});

test('several IMD districts mapping to one of ours keep the worst warning', () => {
  const { warnings } = imd.summarise([
    warningRow('GANGTOK', [['2', 3], NO_WARNING, NO_WARNING, NO_WARNING, NO_WARNING]),
    warningRow('PAKYONG', [['16', 2], NO_WARNING, NO_WARNING, NO_WARNING, NO_WARNING]),
  ], []);
  assert.equal(warnings['East Sikkim'].days[0].color, 'orange');
  assert.equal(warnings['East Sikkim'].days[0].severity, 0.75);
  assert.deepEqual(warnings['East Sikkim'].days[0].codes.sort(), [16, 2]);
});

test('severity picks the right day, adds an active nowcast, and is null without data', () => {
  const now = Date.now();
  const w = imd.parseWarning(warningRow('MANGAN', [NO_WARNING, ['16', 2], NO_WARNING, NO_WARNING, NO_WARNING]));
  const active = imd.parseNowcast({ District: 'MANGAN', Date: istDate(now - HOUR), toi: istHHmm(now - HOUR), Vupto: istHHmm(now + 2 * HOUR), Cat12: '12', color: '4', message: 'Heavy rain likely' });
  imd.setImdCache({ warnings: { 'North Sikkim': w }, nowcasts: { 'North Sikkim': active } });

  assert.equal(imd.imdSeverity('North Sikkim', now), 0.8, 'today has no warning, but the heavy-rain nowcast applies');
  assert.equal(imd.imdSeverity('North Sikkim', now + 24 * HOUR), 0.75, 'tomorrow: very heavy rain, orange');
  assert.equal(imd.imdSeverity('North Sikkim', now + 10 * 24 * HOUR), null, 'beyond the 5-day warning');
  assert.equal(imd.imdSeverity('West Sikkim', now), null, 'no IMD data for this district');

  const s = imd.imdSummary('North Sikkim', now);
  assert.equal(s.source, 'IMD');
  assert.equal(s.nowcast.color, 'red');
  assert.deepEqual(s.days.map((d) => d.color), ['green', 'orange', 'green']);

  const expired = { ...active, valid_until: new Date(now - HOUR).toISOString() };
  imd.setImdCache({ warnings: { 'North Sikkim': w }, nowcasts: { 'North Sikkim': expired } });
  assert.equal(imd.imdSeverity('North Sikkim', now), 0, 'an expired nowcast is ignored');
});

test('engine: without IMD data scores are unchanged and the share is credited to the model forecast', () => {
  const st = normaliseStatic({ slope_deg: 38, landslide_history_count: 4, lithology_class: 'phyllite', dist_river_m: 400, ndvi: 0.4 });
  const f = { rain_72h: 90, rain_24h: 50, rain_intensity: 6, rain_fc_24h: 70, saturation_index: 0.85 };
  const fallback = scoreFrom(st, normaliseDynamic(f));
  const sameAsForecast = scoreFrom(st, normaliseDynamic({ ...f, imd_rain_severity: normaliseDynamic(f).rain_forecast }));
  assert.ok(Math.abs(fallback.score - sameAsForecast.score) < 1e-12);
  assert.ok(!fallback.drivers.some((d) => d.key === 'imd_warning'));

  const red = scoreFrom(st, normaliseDynamic({ ...f, rain_fc_24h: 0, imd_rain_severity: 1 }));
  const none = scoreFrom(st, normaliseDynamic({ ...f, rain_fc_24h: 0, imd_rain_severity: 0 }));
  assert.ok(red.score - none.score > 0.039, 'a red IMD warning adds its full weight');
});

test('refresh sends both IMD credentials and stores matched districts', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push({ url, headers: opts.headers });
    const body = url.endsWith('/districtwarning')
      ? [warningRow('GANGTOK', [['2', 3], NO_WARNING, NO_WARNING, NO_WARNING, NO_WARNING]), warningRow('JAIPUR', [['9', 1], NO_WARNING, NO_WARNING, NO_WARNING, NO_WARNING])]
      : [];
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  const out = await imd.refreshImd({ fetchImpl });
  assert.deepEqual(out, { ok: true, districts: 1 });
  assert.equal(seen.length, 2);
  for (const s of seen) {
    assert.equal(s.headers['x-api-key'], 'test-key');
    assert.equal(s.headers.Authorization, 'Bearer test-jwt');
  }
  assert.equal(q.one("SELECT COUNT(*) AS n FROM imd_cache WHERE product = 'warning'").n, 1);
  assert.equal(q.one("SELECT status FROM feed_status WHERE feed = 'imd'").status, 'ok');
  assert.equal(imd.imdSeverity('East Sikkim', Date.now()), 0.45);
});

test('refresh failure keeps the cached data and reports the IMD error', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => '{"error":"Invalid or expired JWT token"}' });
  const out = await imd.refreshImd({ fetchImpl });
  assert.equal(out.ok, false);
  assert.match(out.reason, /expired JWT/);
  const f = q.one("SELECT status, message FROM feed_status WHERE feed = 'imd'");
  assert.equal(f.status, 'degraded');
  assert.equal(imd.imdSeverity('East Sikkim', Date.now()), 0.45, 'last good data still served');
});
