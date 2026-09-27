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

// ---------- Confirmed-landslide record + scorecard ----------
const { recordLandslide, retractLandslide } = await import('../src/routes/ml.js');
const { scorecard } = await import('../src/prediction/mlScorecard.js');
const { buildActor } = await import('../src/auth/middleware.js');

test('recording landslides: places, verified reports only, no duplicates, retract (never delete)', () => {
  const officer = buildActor(q.one("SELECT * FROM users WHERE email = 'officer@demo.in'"));
  assert.equal(can(officer, 'landslides.record'), true);
  assert.equal(can(buildActor(q.one("SELECT * FROM users WHERE email = 'citizen@demo.in'")), 'landslides.record'), false);

  const a = recordLandslide({ location_id: 'mangan', date: '2026-09-20', notes: 'Slide above the bridge' }, officer);
  assert.equal(a.location_id, 'mangan');
  assert.equal(a.source, 'officer');
  assert.throws(() => recordLandslide({ location_id: 'mangan', date: '2026-09-21' }, officer), /possible_duplicate/);
  assert.ok(recordLandslide({ location_id: 'mangan', date: '2026-09-21', force: true }, officer));
  assert.throws(() => recordLandslide({ location_id: 'gangtok', date: '2999-01-01' }, officer), /invalid_date/);
  assert.throws(() => recordLandslide({ lat: 12.9, lng: 77.6, date: '2026-09-20' }, officer), /invalid_place/);

  // Reports: only verified ones, once.
  const now = new Date().toISOString();
  q.run("INSERT INTO reports(id, type, lat, lng, location_id, status, created_at) VALUES ('rep_t1', 'debris', 27.06, 88.47, 'kalimpong', 'submitted', :now)", { now });
  assert.throws(() => recordLandslide({ report_id: 'rep_t1' }, officer), /report_not_verified/);
  q.run("UPDATE reports SET status = 'verified' WHERE id = 'rep_t1'");
  const b = recordLandslide({ report_id: 'rep_t1' }, officer);
  assert.equal(b.source, 'report');
  assert.equal(b.accuracy_km, 0.5, 'report GPS point is precise');
  assert.throws(() => recordLandslide({ report_id: 'rep_t1' }, officer), /already_recorded/);

  assert.throws(() => retractLandslide(a.id, '', officer), /reason_required/);
  const r = retractLandslide(a.id, 'Was a road-cutting collapse, not a natural slide', officer);
  assert.ok(r.retracted_at);
  assert.equal(q.one('SELECT COUNT(*) AS n FROM landslide_record WHERE id = :id', { id: a.id }).n, 1, 'kept, not deleted');
  assert.equal(q.one("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('landslide.record','landslide.retract')").n, 4);
});

test('scorecard: warnings count only if issued before the landslide; false alarms on quiet days', () => {
  const places = [{ id: 'a', lat: 27.0, lng: 88.0 }, { id: 'b', lat: 27.5, lng: 88.8 }];
  const P = (loc, forDate, issued, elevated) => ({ location_id: loc, for_date: forDate, issued_on: issued, score: elevated ? 0.5 : 0.1, elevated: elevated ? 1 : 0 });
  const predictions = [
    P('a', '2026-09-10', '2026-09-09', 1), P('a', '2026-09-10', '2026-09-10', 1), // warned a day ahead
    P('a', '2026-09-20', '2026-09-20', 1),                                     // same-day only
    P('b', '2026-09-10', '2026-09-09', 0), P('b', '2026-09-11', '2026-09-11', 1), // quiet day, elevated → false alarm
    P('b', '2026-09-12', '2026-09-12', 0), P('b', '2026-09-13', '2026-09-13', 0),
  ];
  const events = [
    { id: 'e1', date: '2026-09-10', lat: 27.01, lng: 88.01, source: 'officer' },
    { id: 'e2', date: '2026-09-20', lat: 27.02, lng: 88.0, source: 'report' },
    { id: 'e3', date: '2026-09-12', lat: 25.0, lng: 92.0, source: 'officer' }, // far from every place
  ];
  const s = scorecard({ predictions, events, places });
  assert.equal(s.events_scored, 2);
  assert.equal(s.events_outside_area, 1);
  assert.equal(s.warned_ahead, 1);
  assert.equal(s.events_with_ahead_prediction, 1);
  assert.equal(s.warned_on_day_or_before, 2);
  assert.equal(s.quiet_place_days, 4);
  assert.equal(s.quiet_elevated, 1);
  assert.equal(s.false_alarm_rate, 0.25);
});

test('NER preview places: added once to any database, marked as automatic data, scored by the model', async () => {
  const { syncPreviewPlaces } = await import('../src/db/seed.js');
  const n = q.one("SELECT COUNT(*) AS n FROM locations WHERE corridor_id = 'ner_preview'").n;
  assert.equal(n, 8, 'seeding adds the 8 preview places');
  assert.equal(syncPreviewPlaces(), 0, 'running again adds nothing');
  assert.equal(q.one("SELECT COUNT(*) AS n FROM static_layers s JOIN locations l ON l.id = s.location_id WHERE l.corridor_id = 'ner_preview' AND s.source = 'auto_preview'").n, 8);
  assert.equal(q.one("SELECT COUNT(*) AS n FROM static_layers WHERE source = 'static_seed'").n, 17, 'hand-checked Sikkim/Darjeeling data untouched');
  const places = JSON.parse(fs.readFileSync(path.join(here, '../../ml/models/live_locations.json'), 'utf8')).locations;
  for (const id of ['guwahati', 'shillong', 'kohima', 'noney', 'aizawl', 'itanagar', 'tawang', 'haflong']) assert.ok(places[id], `${id} has model inputs`);
});
