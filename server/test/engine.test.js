import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
const { WEIGHTS, levelFromScore, applyHysteresis, scoreFrom, normaliseStatic, normaliseDynamic, exposureScore, priorityOf, confidenceOf, trendOf } = await import('../src/prediction/engine.js');
const { riskConfig } = await import('../src/config/shared.js');

test('weights sum to 1', () => {
  const s = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(s - 1) < 1e-9, `sum=${s}`);
});

test('levels follow shared thresholds', () => {
  const t = riskConfig.thresholds;
  assert.equal(levelFromScore(t.moderate - 0.001), 'low');
  assert.equal(levelFromScore(t.moderate), 'moderate');
  assert.equal(levelFromScore(t.high), 'high');
  assert.equal(levelFromScore(t.critical), 'critical');
});

test('hysteresis: escalates immediately, downgrades only after margin + dwell', () => {
  const t0 = Date.parse('2026-09-24T10:00:00Z');
  const prev = { level: 'high', levelSince: new Date(t0).toISOString() };
  const { margin, minDwellSecondsBeforeDowngrade: dwell } = riskConfig.hysteresis;
  assert.equal(applyHysteresis(riskConfig.thresholds.critical, prev, { nowMs: t0 + 1000 }).level, 'critical');
  // just below threshold: holds
  assert.equal(applyHysteresis(riskConfig.thresholds.high - margin / 2, prev, { nowMs: t0 + dwell * 2000 }).level, 'high');
  // well below but too soon: holds
  assert.equal(applyHysteresis(0.3, prev, { nowMs: t0 + 1000 }).level, 'high');
  // well below after dwell: drops
  assert.equal(applyHysteresis(0.3, prev, { nowMs: t0 + dwell * 1000 + 1 }).level, 'low');
  // forced bypasses dwell
  assert.equal(applyHysteresis(0.3, prev, { nowMs: t0 + 1, force: true }).level, 'low');
});

const steepWeak = { slope_deg: 40, lithology_class: 'daling_phyllite_schist', landslide_history_count: 12, road_cutting: 1, dist_road_m: 10, dist_river_m: 80, fault_distance_km: 2, ndvi: 0.4 };
const dry = { rain_72h: 0, rain_24h: 0, rain_intensity: 0, rain_fc_24h: 0, saturation_index: 0.5 };
const storm = { rain_72h: 260, rain_24h: 150, rain_intensity: 30, rain_fc_24h: 120, saturation_index: 0.98 };

test('dry steep slope stays Low; storm on same slope is Critical', () => {
  const s = normaliseStatic(steepWeak);
  assert.equal(levelFromScore(scoreFrom(s, normaliseDynamic(dry)).score), 'low');
  assert.equal(levelFromScore(scoreFrom(s, normaliseDynamic(storm)).score), 'critical');
});

test('drivers: 3–5 items with integer percentages', () => {
  const r = scoreFrom(normaliseStatic(steepWeak), normaliseDynamic(storm));
  assert.ok(r.drivers.length >= 3 && r.drivers.length <= 5);
  r.drivers.forEach((d) => assert.ok(Number.isInteger(d.contribution)));
  assert.ok(['soil_saturation', 'rain_72h', 'rain_24h'].includes(r.drivers[0].key));
});

test('exposure and priority', () => {
  const town = exposureScore({ population: 60000, facilities: [{ type: 'hospital' }, { type: 'shelter' }], critical_infra: ['x'], roads: ['NH-10'], tourist_zone: 1 });
  const hamlet = exposureScore({ population: 300, facilities: [], critical_infra: [], roads: ['village road'], tourist_zone: 0 });
  assert.ok(town > hamlet);
  assert.ok(priorityOf(0.8, town) > priorityOf(0.8, hamlet));
  assert.ok(priorityOf(0.8, hamlet) > priorityOf(0.4, town) * 0.5);
});

test('confidence is bounded and penalises fallback data', () => {
  const good = confidenceOf({ source: 'open-meteo', ageHours: 0.2, forecastAgrees: true, fieldVerified: false });
  const bad = confidenceOf({ source: 'fallback_climatology', ageHours: 10, forecastAgrees: false, fieldVerified: false });
  assert.ok(good > bad && bad >= 0.5 && good <= 0.93);
});

test('trend detects rising scores', () => {
  const now = Date.now();
  const hist = [0, 5, 10, 15].map((m) => ({ t: now - (15 - m) * 60000, score: 0.3 + m * 0.01 }));
  assert.equal(trendOf(hist, now), 'rising');
  assert.equal(trendOf(hist.map((h) => ({ ...h, score: 0.4 })), now), 'steady');
});
