import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `br-geocode-test-${process.pid}.db`);

const { geocode, simplifyPlace, NOMINATIM_URL } = await import('../src/routes/map.js');

const place = { name: 'Rumtek', display_name: 'Rumtek, Gangtok, Gangtok subdivision, Gangtok, Sikkim, 737101, India', lat: '27.2900', lon: '88.5620', type: 'village' };

test('places are simplified to name, short detail and coordinates', () => {
  assert.deepEqual(simplifyPlace(place), { name: 'Rumtek', detail: 'Gangtok, Gangtok subdivision, Gangtok', lat: 27.29, lng: 88.562, kind: 'village' });
});

test('search stays inside the region, identifies the app, caches, and keeps to one request per second', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), at: Date.now(), ua: opts.headers['User-Agent'] });
    return { ok: true, json: async () => [place] };
  };
  const first = await geocode('Rumtek monastery', fetchImpl);
  assert.equal(first[0].name, 'Rumtek');
  const u = new URL(calls[0].url);
  assert.equal(`${u.origin}${u.pathname}`, NOMINATIM_URL);
  assert.equal(u.searchParams.get('bounded'), '1');
  assert.equal(u.searchParams.get('countrycodes'), 'in');
  assert.match(calls[0].ua, /Bhu-Rakshak/);

  await geocode('RUMTEK MONASTERY', fetchImpl);
  assert.equal(calls.length, 1, 'the same query (any case) is served from the cache');

  await geocode('Mangan bazaar', fetchImpl);
  await geocode('Singtam bridge', fetchImpl);
  assert.equal(calls.length, 3);
  assert.ok(calls[2].at - calls[1].at >= 1000, 'back-to-back searches are spaced at least a second apart');
});
