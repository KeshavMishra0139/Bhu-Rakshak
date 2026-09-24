import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
const { featuresAt, istHourKey, hourIndex, fallbackHourly } = await import('../src/ingest/features.js');
const { buildForecastUrl } = await import('../src/ingest/openMeteo.js');

test('IST hour key matches Open-Meteo local time format', () => {
  assert.equal(istHourKey(Date.parse('2026-09-24T10:40:00Z')), '2026-09-24T16:00');
});

test('rain windows and cloudburst flag', () => {
  const n = 240;
  const hourly = { time: Array.from({ length: n }, (_, k) => istHourKey(Date.parse('2026-09-17T00:00:00Z') + k * 3600000)), precipitation: Array(n).fill(1), temperature_2m: Array(n).fill(10) };
  hourly.precipitation[168] = 120;
  const f = featuresAt(hourly, 168);
  assert.equal(f.rain_intensity, 120);
  assert.equal(f.rain_24h, 23 + 120);
  assert.equal(f.rain_72h, 71 + 120);
  assert.equal(f.rain_fc_24h, 24);
  assert.equal(f.cloudburst, 1);
  assert.equal(f.saturation_index, 0.5); // no soil data → neutral default
});

test('fallback climatology covers now and the next 48 h', () => {
  const now = Date.now();
  const h = fallbackHourly({ id: 'mangan', district: 'North Sikkim' }, 950, now);
  const i = hourIndex(h, now);
  assert.ok(h.time[i] === istHourKey(now));
  assert.ok(h.time.length - 1 - i >= 48);
  const f = featuresAt(h, i);
  assert.ok(f.saturation_index > 0 && f.saturation_index <= 1);
});

test('Open-Meteo URL is batched with the verified hourly variables', () => {
  const url = buildForecastUrl([{ lat: 27.5, lng: 88.5 }, { lat: 27.3, lng: 88.6 }]);
  assert.match(url, /latitude=27\.5000%2C27\.3000/);
  for (const v of ['soil_moisture_27_to_81cm', 'freezing_level_height', 'snow_depth', 'weather_code']) assert.ok(url.includes(v), v);
  assert.match(url, /past_days=7/);
});
