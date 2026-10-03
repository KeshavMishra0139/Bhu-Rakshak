import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `br-weather-test-${process.pid}.db`);
process.env.DISABLE_INGEST = 'true';
process.env.SITE_PASSWORD = ''; // no preview gate here, whatever the local .env says
for (const s of ['', '-wal', '-shm']) fs.rmSync(process.env.DB_PATH + s, { force: true });

const { createApp } = await import('../src/index.js');
const { seedIfEmpty } = await import('../src/db/seed.js');
const { q } = await import('../src/db/index.js');
const { refreshWeather, openMeteoRefused, ensureFallback } = await import('../src/ingest/openMeteo.js');
const { refreshMl } = await import('../src/prediction/mlModel.js');

let server;
let base;
before(async () => {
  seedIfEmpty();
  ensureFallback();
  const app = await createApp();
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

// Open-Meteo's real answer when an internet address is over its limit.
const limited = (reason) => async () => ({ ok: false, status: 429, text: async () => JSON.stringify({ error: true, reason }) });

test('a refused weather request says which Open-Meteo limit was hit', async () => {
  const r = await refreshWeather({ fetchImpl: limited('Daily API request limit exceeded. Please try again tomorrow.') });
  assert.equal(r.ok, false);
  assert.match(r.reason, /^HTTP 429 \(Daily API request limit exceeded/);
  assert.equal(openMeteoRefused(), true);
  assert.match(q.one("SELECT message FROM feed_status WHERE feed = 'open_meteo'").message, /Daily API request limit/);
  // Any other failure (here a server error with no readable body) is not a usage-limit refusal.
  const down = await refreshWeather({ fetchImpl: async () => ({ ok: false, status: 503 }) });
  assert.equal(down.reason, 'HTTP 503');
  assert.equal(openMeteoRefused(), false);
});

test('the AI model reports the same reason when Open-Meteo refuses it', async () => {
  const r = await refreshMl({ fetchImpl: limited('Minutely API request limit exceeded. Please try one more time in the next minute.') });
  assert.equal(r.ok, false);
  assert.match(r.reason, /^Open-Meteo HTTP 429 \(Minutely API request limit exceeded/);
});

test('hourly rain is labelled with whole IST clock hours, starting with the next hour', async () => {
  const before = Date.now();
  const res = await fetch(`${base}/api/risk/forecast?location_id=gangtok`);
  assert.equal(res.status, 200);
  const { hourly_rain: rain, best_travel: best } = await res.json();
  assert.equal(rain.length, 48);
  const onTheHour = (iso) => (Date.parse(iso) + 5.5 * 3600000) % 3600000 === 0;
  assert.ok(rain.every((x) => onTheHour(x.time)), 'every slot starts on an IST hour');
  const first = Date.parse(rain[0].time);
  assert.ok(first > before && first <= before + 3600000, 'the first slot is the next clock hour');
  rain.slice(1).forEach((x, k) => assert.equal(Date.parse(x.time) - Date.parse(rain[k].time), 3600000));
  if (best) assert.ok(onTheHour(best.start) && onTheHour(best.end));
});
