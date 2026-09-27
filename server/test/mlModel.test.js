import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `br-ml-test-${process.pid}.db`);
for (const s of ['', '-wal', '-shm']) fs.rmSync(process.env.DB_PATH + s, { force: true });

const here = path.dirname(fileURLToPath(import.meta.url));
const { liveFeatures } = await import('../../ml/live_features.mjs');
const ml = await import('../src/prediction/mlModel.js');
const { seedIfEmpty } = await import('../src/db/seed.js');
const { q } = await import('../src/db/index.js');
const { can } = await import('../src/auth/permissions.js');

before(() => seedIfEmpty());

const fixture = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/ml_parity.json'), 'utf8'));
const num = (v) => (v === '' || v == null ? null : Number(v));

test('live inputs reproduce the training data exactly (real rows from ml/data/clean.csv)', () => {
  const { features } = ml.loadModel();
  assert.ok(fixture.cases.length >= 3);
  for (const c of fixture.cases) {
    const r = c.row;
    const place = {
      lat: +r.lat, lng: +r.lng,
      terrain: Object.fromEntries(['elev_m', 'slope_deg', 'northness', 'eastness', 'curvature', 'relief_1km'].map((k) => [k, num(r[k])])),
      clim_month_mm_day: Array(12).fill(num(r.clim_month_mm_day)), clim_annual_mm_day: num(r.clim_annual_mm_day),
    };
    const f = liveFeatures({ daily: c.daily, hourly: c.hourly, n: c.daily.time.length - 1, place, quakes: c.quakes });
    for (const k of features) {
      const want = num(r[k]);
      if (want == null) { assert.equal(f[k], null, `${r.date} ${k}`); continue; }
      assert.ok(Math.abs(f[k] - want) <= 0.002 * Math.max(1, Math.abs(want)), `${r.sample_type} ${r.date} ${k}: live ${f[k]} vs training ${want}`);
    }
  }
});

test('scores are valid and follow the rain: a very wet week scores above a dry one', () => {
  const c = fixture.cases[0];
  const place = { lat: 27.33, lng: 88.61, terrain: { elev_m: 1600, slope_deg: 25, northness: 0, eastness: 1, curvature: 0, relief_1km: 400 }, clim_month_mm_day: Array(12).fill(8), clim_annual_mm_day: 7 };
  const series = (mm) => ({ ...c.daily, precipitation_sum: c.daily.precipitation_sum.map(() => mm) });
  const hourly = (mm) => ({ precipitation: c.hourly.precipitation.map(() => mm / 24) });
  const n = c.daily.time.length - 1;
  const dry = ml.scoreFeatures(liveFeatures({ daily: series(0), hourly: hourly(0), n, place, quakes: [] }));
  const wet = ml.scoreFeatures(liveFeatures({ daily: series(60), hourly: hourly(60), n, place, quakes: [] }));
  for (const s of [dry, wet]) assert.ok(s > 0 && s < 1);
  assert.ok(wet > dry, `wet ${wet} should exceed dry ${dry}`);
});

test('refresh scores every place for today and tomorrow and logs predictions', async () => {
  const places = JSON.parse(fs.readFileSync(path.join(here, '../../ml/models/live_locations.json'), 'utf8')).locations;
  const now = Date.parse('2026-09-24T06:00:00Z');
  const days = Array.from({ length: 33 }, (_, i) => new Date(Date.parse('2026-08-24T00:00:00Z') + i * 86400000).toISOString().slice(0, 10));
  const one = { daily: { time: days, precipitation_sum: days.map((_, i) => (i > 28 ? 40 : 5)), snowfall_sum: days.map(() => 0), temperature_2m_max: days.map(() => 20), temperature_2m_min: days.map(() => 14) }, hourly: { precipitation: Array(33 * 24).fill(0.5) } };
  const fetchImpl = async () => ({ ok: true, json: async () => Object.keys(places).map(() => one) });
  const r = await ml.refreshMl({ fetchImpl, now });
  assert.deepEqual(r, { ok: true, places: Object.keys(places).length });
  const latest = ml.latestMl();
  assert.equal(latest.predictions.gangtok.today.date, '2026-09-24');
  assert.equal(latest.predictions.gangtok.tomorrow.date, '2026-09-25');
  assert.equal(q.one('SELECT COUNT(*) AS n FROM ml_predictions').n, Object.keys(places).length * 2);
  assert.equal(q.one("SELECT status FROM feed_status WHERE feed = 'ml_model'").status, 'ok');
  // A later run on the same day updates, never duplicates.
  await ml.refreshMl({ fetchImpl, now: now + 3600000 });
  assert.equal(q.one('SELECT COUNT(*) AS n FROM ml_predictions').n, Object.keys(places).length * 2);
});

test('a failed refresh keeps the last predictions and marks the feed degraded', async () => {
  const r = await ml.refreshMl({ fetchImpl: async () => ({ ok: false, status: 503 }) });
  assert.equal(r.ok, false);
  assert.ok(ml.latestMl().predictions.gangtok);
  assert.equal(q.one("SELECT status FROM feed_status WHERE feed = 'ml_model'").status, 'degraded');
});

test('only officers (not citizens) may see the experimental model', () => {
  assert.equal(can({ role: 'citizen' }, 'risk.details'), false);
  assert.equal(can({ role: 'authority', subRole: 'district_officer', status: 'active' }, 'risk.details'), true);
});
