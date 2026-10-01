import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';

const { gridPoints, windowSums, refreshRain, GRID } = await import('../src/routes/layers.js');

test('the grid covers the North East box at 0.5°', () => {
  const pts = gridPoints();
  assert.equal(pts.length, 16 * 20);
  assert.deepEqual(pts[0], [GRID.minLat, GRID.minLng]);
  assert.deepEqual(pts.at(-1), [GRID.maxLat, GRID.maxLng]);
});

test('3/7/15-day sums end on today and skip missing days', () => {
  const time = Array.from({ length: 16 }, (_, i) => `2026-09-${String(16 + i).padStart(2, '0')}`); // 16 Sep … 1 Oct
  const values = time.map((_, i) => (i === 3 ? null : 1));
  assert.deepEqual(windowSums(time, values, '2026-10-01'), [3, 7, 14]); // 19 Sep is missing
  assert.deepEqual(windowSums(time, values, '2026-09-20'), [2, 4, 4]);
});

test('batched fetch builds one cell per grid point', async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    const n = new URL(url).searchParams.get('latitude').split(',').length;
    const daily = { time: ['2026-09-30', '2026-10-01'], precipitation_sum: [2, 3] };
    return { ok: true, json: async () => Array.from({ length: n }, () => ({ daily })) };
  };
  const out = await refreshRain({ fetchImpl, nowMs: Date.parse('2026-10-01T06:00:00Z') });
  assert.equal(calls, 4);
  assert.equal(out.cells.length, 320);
  assert.deepEqual(out.cells[0].slice(2), [5, 5, 5]);
  assert.equal(out.through, '2026-10-01');
});
