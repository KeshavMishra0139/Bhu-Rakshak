import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `br-forecast-test-${process.pid}.db`);
process.env.DISABLE_INGEST = 'true';
process.env.SITE_PASSWORD = ''; // no preview gate here, whatever the local .env says
for (const s of ['', '-wal', '-shm']) fs.rmSync(process.env.DB_PATH + s, { force: true });

const { createApp } = await import('../src/index.js');
const { seedIfEmpty } = await import('../src/db/seed.js');
const { ensureFallback } = await import('../src/ingest/openMeteo.js');

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
