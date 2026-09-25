import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `br-seismic-test-${process.pid}.db`);
for (const s of ['', '-wal', '-shm']) fs.rmSync(process.env.DB_PATH + s, { force: true });

const seismic = await import('../src/ingest/seismic.js');
const { normaliseDynamic, normaliseStatic, scoreFrom } = await import('../src/prediction/engine.js');
const { seedIfEmpty } = await import('../src/db/seed.js');
const { q } = await import('../src/db/index.js');

before(() => seedIfEmpty());

const HOUR = 3600000;
const GANGTOK = { lat: 27.33, lng: 88.61 };
// Shaped like the NCS earthquake page: two embedded GeoJSON collections, a JS comment right after the first array.
const istParts = (ms) => { const d = new Date(ms + 5.5 * HOUR).toISOString(); return { date: d.slice(0, 10), time: d.slice(11, 19) }; };
function ncsPage(nowMs) {
  const q1 = istParts(nowMs - 2 * HOUR);
  const q2 = istParts(nowMs - 40 * HOUR);
  return `<html><script>var eq = {"type":"FeatureCollection","name":"17DaysM57D3370_3","features": [
    {"type":"Feature","properties":{"date":"${q1.date}","time":"${q1.time}","depth":10,"magnitude":5.6,"ID":"901","icon_size":7,"icon_color":"red"},"geometry":{"type":"Point","coordinates":[88.35,27.55]}},
    {"type":"Feature","properties":{"date":"${q2.date}","time":"${q2.time}","depth":80,"magnitude":3.9,"ID":"902","icon_size":7,"icon_color":"red"},"geometry":{"type":"Point","coordinates":[72.8,19.0]}}
  ]/*[{"broken": ]*/ };
  var net = {"type":"FeatureCollection","name":"17DaysM57D3370_3_network","features": [
    {"type":"Feature","properties":{"station":"Gangtok [GTK]","state":"Sikkim"},"geometry":{"type":"Point","coordinates":[88.602,27.319]}},
    {"type":"Feature","properties":{"station":"Campbell Bay [CMBY]","state":"Andaman & Nicobar"},"geometry":{"type":"Point","coordinates":[93.9,7.0]}}
  ]};</script></html>`;
}
const usgsBody = (nowMs) => ({ features: [
  // Same quake as NCS 901 (should be de-duplicated) and one NCS missed.
  { id: 'us1', properties: { time: nowMs - 2 * HOUR + 20000, mag: 5.5, place: 'Sikkim' }, geometry: { coordinates: [88.4, 27.5, 12] } },
  { id: 'us2', properties: { time: nowMs - 30 * HOUR, mag: 4.4, place: 'western Bhutan' }, geometry: { coordinates: [89.6, 27.4, 10] } },
] });

test('NCS page parsing reads both collections despite the trailing JS comment, in IST', () => {
  const now = Date.UTC(2026, 8, 25, 6, 0, 0);
  const { quakes, stations } = seismic.parseNcsPage(ncsPage(now));
  assert.equal(quakes.length, 2);
  assert.equal(quakes[0].mag, 5.6);
  assert.equal(quakes[0].time, new Date(now - 2 * HOUR).toISOString());
  assert.deepEqual(stations.map((s) => s.code), ['GTK', 'CMBY']);
  assert.equal(stations[0].name, 'Gangtok');
});

test('merge keeps NCS, drops far-away quakes and USGS duplicates, adds quakes NCS missed', () => {
  const now = Date.now();
  const merged = seismic.mergeQuakes(seismic.parseNcsPage(ncsPage(now)).quakes, seismic.parseUsgs(usgsBody(now)), now);
  assert.deepEqual(merged.map((e) => e.id), ['ncs-901', 'usgs-us2']);
});

test('shaking intensity falls with distance and severity fades with time', () => {
  const near = seismic.intensityAt({ mag: 5.6, depth_km: 10, lat: 27.55, lng: 88.35 }, GANGTOK);
  const far = seismic.intensityAt({ mag: 5.6, depth_km: 10, lat: 27.3, lng: 91.5 }, GANGTOK);
  assert.ok(near > 5.5 && far < 4, `near ${near}, far ${far}`);
  assert.equal(seismic.shakingSeverity(3.5), 0);
  assert.equal(seismic.shakingSeverity(7.5), 1);
  const now = Date.now();
  seismic.setSeismicCache({ quakes: [{ id: 'x', mag: 5.6, depth_km: 10, lat: 27.55, lng: 88.35, time: new Date(now).toISOString() }] });
  const today = seismic.seismicSeverity(GANGTOK, now);
  const week = seismic.seismicSeverity(GANGTOK, now + 7 * 24 * HOUR);
  assert.ok(today > 0.5);
  assert.ok(Math.abs(week - today / 2) < 0.01);
  assert.equal(seismic.seismicSeverity(GANGTOK, now + 40 * 24 * HOUR), 0);
});

test('engine: no shaking leaves the score unchanged; strong shaking raises it and shows as a driver', () => {
  const st = normaliseStatic({ slope_deg: 38, lithology_class: 'daling_phyllite_schist', landslide_history_count: 3, ndvi: 0.5 });
  const f = { rain_72h: 40, rain_24h: 15, rain_intensity: 1, saturation_index: 0.7 };
  const quiet = scoreFrom(st, normaliseDynamic(f));
  const quiet2 = scoreFrom(st, normaliseDynamic({ ...f, seismic_shaking: 0 }));
  const shaken = scoreFrom(st, normaliseDynamic({ ...f, seismic_shaking: 1 }));
  assert.equal(quiet2.score, quiet.score);
  assert.ok(!quiet.drivers.some((d) => d.key === 'seismic'));
  assert.ok(shaken.score - quiet.score > 0.12);
  assert.equal(shaken.drivers[0].key, 'seismic');
});

test('refresh stores data, reports feeds, and falls back to USGS when NCS is down', async () => {
  const now = Date.now();
  const ok = async (url) => ({ ok: true, status: 200, text: async () => (url.startsWith(seismic.NCS_URL) ? ncsPage(now) : JSON.stringify(usgsBody(now))) });
  const r = await seismic.refreshSeismic({ fetchImpl: ok, nowMs: now });
  assert.deepEqual(r, { ok: true, quakes: 2, stations: 2 });
  assert.equal(q.one("SELECT status FROM feed_status WHERE feed = 'seismic'").status, 'ok');
  assert.match(q.one("SELECT message FROM feed_status WHERE feed = 'sensors'").message, /2 stations, 1 within 150 km \(Gangtok\)/);
  const sum = seismic.seismicSummary(GANGTOK, now);
  assert.equal(sum.strongest.mag, 5.6);
  assert.equal(sum.nearest_station.code, 'GTK');

  const ncsDown = async (url) => (url.startsWith(seismic.NCS_URL) ? { ok: false, status: 503, text: async () => '' } : ok(url));
  const r2 = await seismic.refreshSeismic({ fetchImpl: ncsDown, nowMs: now });
  assert.equal(r2.ok, true);
  assert.equal(q.one("SELECT status FROM feed_status WHERE feed = 'seismic'").status, 'degraded');
  assert.equal(seismic.seismicData().stations.length, 2, 'keeps the last station list');

  const allDown = async () => { throw new Error('offline'); };
  const r3 = await seismic.refreshSeismic({ fetchImpl: allDown, nowMs: now });
  assert.equal(r3.ok, false);
  assert.match(q.one("SELECT message FROM feed_status WHERE feed = 'seismic'").message, /^Serving last earthquake data/);
});
