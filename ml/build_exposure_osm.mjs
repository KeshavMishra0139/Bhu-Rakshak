// Count what is exposed around each monitored place, from OpenStreetMap: buildings, schools, health facilities and
// roads within RADIUS_KM of the place's point. Writes server/src/data/exposure_osm.json (read by the impact API).
//   node ml/build_exposure_osm.mjs ml/data/raw/north-eastern-zone.osm.pbf ml/data/raw/eastern-zone.osm.pbf
// These are counts of what volunteers have mapped, not a census: OSM coverage is patchy in parts of the North East,
// so true numbers can be higher. Features are de-duplicated by OSM id across overlapping extracts.
import fs from 'node:fs';
import path from 'node:path';
import { blocks, parseBlock } from './pbf.mjs';
import { ML_ROOT } from './lib.mjs';

const RADIUS_KM = 1;
const ROOT = path.resolve(ML_ROOT, '..');
const OUT = path.join(ROOT, 'server/src/data/exposure_osm.json');
const ROAD_RANK = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, unclassified: 5, residential: 6 };
const SCHOOL = new Set(['school', 'college', 'university', 'kindergarten']);
const HEALTH_AMENITY = new Set(['hospital', 'clinic', 'doctors']);
const HEALTH_CARE = new Set(['hospital', 'clinic', 'centre', 'doctor']);

const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/src/data/locations.json'), 'utf8')).locations;
const ner = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/src/data/ner_preview.json'), 'utf8')).places.map((p) => p.location);
const places = [...seed, ...ner].map((p) => ({ id: p.id, lat: p.lat, lng: p.lng }));

const toRad = Math.PI / 180;
const km = (a, b, c, d) => {
  const x = (d - b) * toRad * Math.cos(((a + c) / 2) * toRad); const y = (c - a) * toRad;
  return 6371 * Math.sqrt(x * x + y * y);
};
// Coarse grid of 0.05° cells touching any place's search box, so most nodes are rejected with one lookup.
const CELL = 20;
const cellKey = (lat, lng) => Math.floor(lat * CELL) * 100000 + Math.floor(lng * CELL);
const cells = new Set();
for (const p of places) {
  const dLat = (RADIUS_KM * 1.3) / 111; const dLng = dLat / Math.cos(p.lat * toRad);
  for (let a = Math.floor((p.lat - dLat) * CELL); a <= Math.floor((p.lat + dLat) * CELL); a++) {
    for (let b = Math.floor((p.lng - dLng) * CELL); b <= Math.floor((p.lng + dLng) * CELL); b++) cells.add(a * 100000 + b);
  }
}
const near = (lat, lng) => places.filter((p) => km(p.lat, p.lng, lat, lng) <= RADIUS_KM);

const out = Object.fromEntries(places.map((p) => [p.id, { buildings: 0, schools: [], health: [], roads: new Map(), road_km: 0 }]));
const seen = new Set();
const coords = new Map();
const nameOf = (t) => t['name:en'] || t.name || null;
const isBuilding = (t) => t.building && t.building !== 'no';
const healthKind = (t) => (HEALTH_AMENITY.has(t.amenity) ? t.amenity : HEALTH_CARE.has(t.healthcare) ? t.healthcare : null);

function count(kind, id, lat, lng, t) {
  for (const p of near(lat, lng)) {
    const key = `${p.id}|${kind}${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const o = out[p.id];
    if (isBuilding(t)) o.buildings++;
    if (SCHOOL.has(t.amenity)) o.schools.push({ name: nameOf(t), kind: t.amenity });
    const h = healthKind(t);
    if (h) o.health.push({ name: nameOf(t), kind: h === 'centre' ? 'clinic' : h === 'doctor' ? 'doctors' : h });
  }
}

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node ml/build_exposure_osm.mjs <file.osm.pbf> …'); process.exit(1); }
for (const file of files) {
  let n = 0;
  for (const b of blocks(file)) {
    parseBlock(b, {
      onNode(id, lat, lng, t) {
        if (!cells.has(cellKey(lat, lng))) return;
        coords.set(id, [lat, lng]);
        if (t && (isBuilding(t) || SCHOOL.has(t.amenity) || healthKind(t))) count('n', id, lat, lng, t);
      },
      onWay(id, t, refs) {
        const road = ROAD_RANK[t.highway] != null;
        if (!road && !isBuilding(t) && !SCHOOL.has(t.amenity) && !healthKind(t)) return;
        const pts = refs.map((r) => coords.get(r)).filter(Boolean);
        if (!pts.length) return;
        if (!road) {
          const lat = pts.reduce((s, p) => s + p[0], 0) / pts.length; const lng = pts.reduce((s, p) => s + p[1], 0) / pts.length;
          count('w', id, lat, lng, t);
          return;
        }
        // Road length inside the radius, per place (segments whose midpoint is inside).
        for (const p of places) {
          const key = `${p.id}|w${id}`;
          if (seen.has(key)) continue;
          let len = 0;
          for (let i = 1; i < refs.length; i++) {
            const a = coords.get(refs[i - 1]); const c = coords.get(refs[i]);
            if (!a || !c) continue;
            if (km(p.lat, p.lng, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2) <= RADIUS_KM) len += km(a[0], a[1], c[0], c[1]);
          }
          if (len <= 0) continue;
          seen.add(key);
          const o = out[p.id];
          o.road_km += len;
          const label = t.ref || nameOf(t) || null;
          const k = `${t.highway}|${label}`;
          const prev = o.roads.get(k) || { name: nameOf(t), ref: t.ref || null, class: t.highway, km: 0 };
          prev.km += len;
          o.roads.set(k, prev);
        }
      },
    });
    if (++n % 500 === 0) console.log(`  ${path.basename(file)}: ${n} blocks, ${coords.size} nearby nodes`);
  }
}

const result = {
  _comment: `Features mapped in OpenStreetMap within ${RADIUS_KM} km of each monitored point. Generated by ml/build_exposure_osm.mjs. OSM coverage is incomplete in parts of the North East, so real numbers can be higher. Data © OpenStreetMap contributors, ODbL.`,
  generated_at: new Date().toISOString(),
  radius_km: RADIUS_KM,
  sources: files.map((f) => ({ file: path.basename(f), downloaded: fs.statSync(f).mtime.toISOString().slice(0, 10) })),
  places: Object.fromEntries(Object.entries(out).map(([id, o]) => {
    const roads = [...o.roads.values()].map((r) => ({ ...r, km: +r.km.toFixed(2) }))
      .filter((r) => r.km >= 0.05)
      .sort((a, b) => ROAD_RANK[a.class] - ROAD_RANK[b.class] || b.km - a.km);
    return [id, {
      buildings: o.buildings,
      schools: o.schools.length, school_names: o.schools.map((s) => s.name).filter(Boolean).slice(0, 8),
      health: o.health.length, hospitals: o.health.filter((h) => h.kind === 'hospital').length,
      health_names: o.health.map((h) => h.name).filter(Boolean).slice(0, 8),
      road_km: +o.road_km.toFixed(1),
      roads: roads.filter((r) => r.name || r.ref).slice(0, 6),
    }];
  })),
};
fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
for (const [id, p] of Object.entries(result.places)) console.log(id.padEnd(14), `bldg ${String(p.buildings).padStart(5)}  school ${String(p.schools).padStart(3)}  health ${String(p.health).padStart(3)} (hosp ${p.hospitals})  road ${p.road_km} km  ${p.roads.slice(0, 2).map((r) => r.ref || r.name).join(', ')}`);
console.log(`wrote ${path.relative(ROOT, OUT)}`);
