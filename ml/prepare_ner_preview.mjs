// NER preview places: 8 monitored places outside Sikkim/Darjeeling, with every value filled AUTOMATICALLY from
// public data and its source recorded. Values that can't be verified automatically (rock type, fault distance,
// population, facilities) get neutral defaults and are listed under "unverified" — that is why they are a preview.
//   node ml/prepare_ner_preview.mjs   → server/src/data/ner_preview.json
import fs from 'node:fs';
import path from 'node:path';
import { ML_ROOT, DATA, getCached, parseCsv, distanceKm, addDays } from './lib.mjs';
import { terrainAt } from './dem.mjs';
import { roadsRiversNear, nearestM } from './osm.mjs';

const REPO = path.resolve(ML_ROOT, '..');
// Coordinates from OpenStreetMap Nominatim (checked against district/state).
const PLACES = [
  { id: 'guwahati', name_en: 'Guwahati (Kharghuli hills)', name_hi: 'गुवाहाटी (खारघुली पहाड़ियाँ)', district: 'Kamrup Metropolitan', state: 'Assam', lat: 26.1949, lng: 91.7635 },
  { id: 'haflong', name_en: 'Haflong', name_hi: 'हाफलोंग', district: 'Dima Hasao', state: 'Assam', lat: 25.1645, lng: 93.0176 },
  { id: 'shillong', name_en: 'Shillong', name_hi: 'शिलांग', district: 'East Khasi Hills', state: 'Meghalaya', lat: 25.576, lng: 91.8828 },
  { id: 'kohima', name_en: 'Kohima', name_hi: 'कोहिमा', district: 'Kohima', state: 'Nagaland', lat: 25.6619, lng: 94.1019 },
  { id: 'noney', name_en: 'Tupul (Noney)', name_hi: 'तुपुल (नोनी)', district: 'Noney', state: 'Manipur', lat: 24.7822, lng: 93.6631 },
  { id: 'aizawl', name_en: 'Aizawl', name_hi: 'आइज़ोल', district: 'Aizawl', state: 'Mizoram', lat: 23.7278, lng: 92.718 },
  { id: 'itanagar', name_en: 'Itanagar', name_hi: 'ईटानगर', district: 'Papum Pare', state: 'Arunachal Pradesh', lat: 27.098, lng: 93.6237 },
  { id: 'tawang', name_en: 'Tawang', name_hi: 'तवांग', district: 'Tawang', state: 'Arunachal Pradesh', lat: 27.5879, lng: 91.8637 },
];

const q = (o) => new URLSearchParams(o).toString();
const adoy = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return `A${d.getUTCFullYear()}${String(Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1).padStart(3, '0')}`; };
const today = new Date().toISOString().slice(0, 10);
const reported = parseCsv(fs.readFileSync(path.join(DATA, 'all_reported.csv'), 'utf8')).map((e) => ({ ...e, lat: +e.lat, lng: +e.lng }));
const sikkim = JSON.parse(fs.readFileSync(path.join(REPO, 'server/src/data/static_layers.json'), 'utf8')).layers;
const median = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v[Math.floor(v.length / 2)]; };
const NEUTRAL_FAULT_KM = median(Object.values(sikkim).map((s) => s.fault_distance_km)); // typical of the 17 checked places

const out = { _comment: 'NER PREVIEW. Filled automatically from public data (sources below); values under "unverified" are neutral defaults, not measurements.', corridor: { id: 'ner_preview', name_en: 'NER preview (outside Sikkim)', name_hi: 'पूर्वोत्तर प्रीव्यू (सिक्किम के बाहर)', color: '#a27ad6' }, sources: {
  coordinates: 'Town centre from OpenStreetMap Nominatim; monitoring point = steepest ~100 m cell within 2 km of it that is within 100 m of a major road (OpenStreetMap), because landslides hit hillside roads, not flat town centres', terrain: 'AWS Terrain Tiles (NASA SRTM ~30 m): slope/aspect/curvature over ~100 m',
  roads_rivers: 'OpenStreetMap (Geofabrik North-Eastern/Eastern zone extracts)', landslide_history: 'NASA Global Landslide Catalog, reports within 10 km',
  ndvi: 'MODIS MOD13Q1 250 m (ORNL DAAC), latest 16-day composite', road_cutting: 'derived: major road within 50 m on a slope over 15°',
}, unverified: ['lithology (rock type) → neutral weakness 0.5', `fault distance → ${NEUTRAL_FAULT_KM} km (median of the 17 checked places)`, 'population, facilities, bridges, critical infrastructure → empty (exposure not assessed)', 'land cover'], places: [] };

// Monitoring point: town centres are usually flat, but landslides hit the hillside roads. Rule (documented in the
// output): the steepest ~100 m cell within 2 km of the town centre that is within 100 m of a major road.
async function monitoringPoint(town) {
  const { roads } = await roadsRiversNear(town, 0.05);
  let best = null;
  const step = 0.0015; // ≈ 150 m
  for (let dy = -13; dy <= 13; dy++) for (let dx = -13; dx <= 13; dx++) {
    const c = { lat: town.lat + dy * step, lng: town.lng + dx * step };
    if (distanceKm(c, town) > 2 || nearestM(c, roads, 500) > 100) continue;
    const t = await terrainAt(c.lat, c.lng);
    if (!best || t.slope > best.t.slope) best = { c, t };
  }
  return best ? { lat: +best.c.lat.toFixed(4), lng: +best.c.lng.toFixed(4) } : { lat: town.lat, lng: town.lng };
}

for (const town of PLACES) {
  const pt = await monitoringPoint(town);
  const p = { ...town, ...pt };
  const t = await terrainAt(p.lat, p.lng);
  const { roads, rivers } = await roadsRiversNear(p);
  const road = nearestM(p, roads, 5000); const river = nearestM(p, rivers, 5000);
  const near = reported.filter((e) => distanceKm(e, p) <= 10).sort((a, b) => b.date.localeCompare(a.date));
  let ndvi = null;
  try {
    const j = await getCached(`https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?${q({ latitude: p.lat, longitude: p.lng, band: '250m_16_days_NDVI', startDate: adoy(addDays(today, -60)), endDate: adoy(today), kmAboveBelow: 0, kmLeftRight: 0 })}`, { timeoutMs: 90000 });
    const s = (j.subset || []).filter((x) => x.data?.[0] > -3000).sort((a, b) => a.calendar_date.localeCompare(b.calendar_date));
    if (s.length) ndvi = +(s[s.length - 1].data[0] * 0.0001).toFixed(3);
  } catch { /* stays null → neutral 0.5 below */ }
  const place = {
    location: { id: p.id, name_en: p.name_en, name_hi: p.name_hi, district: p.district, state: p.state, corridor: 'ner_preview', lat: p.lat, lng: p.lng, road: null, town_centre: [town.lat, town.lng] },
    static: {
      slope_deg: Math.round(t.slope), aspect_deg: Math.round(t.aspect), elevation_m: Math.round(t.elev), curvature: +t.curvature.toFixed(2),
      lithology_class: 'unverified', fault_distance_km: NEUTRAL_FAULT_KM, ndvi: ndvi ?? 0.5, land_cover: 'unverified',
      dist_road_m: Math.round(road), dist_river_m: Math.round(river), river: null,
      road_cutting: road < 50 && t.slope > 15 ? 1 : 0, landslide_history_count: near.length, last_event_date: near[0]?.date || null,
    },
    exposure: { population: null, roads: [], bridges: [], facilities: [], critical_infra: [], tourist_zone: 0 },
  };
  out.places.push(place);
  console.log(p.id.padEnd(9), `point ${p.lat},${p.lng} (${distanceKm(p, town).toFixed(1)} km from centre)`, JSON.stringify(place.static));
}
fs.writeFileSync(path.join(REPO, 'server/src/data/ner_preview.json'), JSON.stringify(out, null, 2) + '\n');
console.log('wrote server/src/data/ner_preview.json');
