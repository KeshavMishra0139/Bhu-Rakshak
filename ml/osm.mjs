// OpenStreetMap roads and rivers in 0.5° tiles, read from ml/data/osm_tiles (built by osm_pbf.mjs from the
// Geofabrik North-Eastern and Eastern zone extracts). Roads = motorway|trunk|primary|secondary|tertiary;
// rivers = waterway=river. A missing tile means OSM has no such roads/rivers there.
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './lib.mjs';

export const TILE = 0.5;
const DIR = path.join(DATA, 'osm_tiles');
const tiles = new Map();
if (!fs.existsSync(path.join(DIR, '_index.json'))) throw new Error('ml/data/osm_tiles missing — run: node ml/osm_pbf.mjs ml/data/raw/north-eastern-zone.osm.pbf ml/data/raw/eastern-zone.osm.pbf');

export const tileKey = (lat, lng) => `${Math.floor(lat / TILE)},${Math.floor(lng / TILE)}`;
export async function tile(key) {
  if (!tiles.has(key)) {
    const f = path.join(DIR, `${key}.json`);
    tiles.set(key, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { roads: [], rivers: [] });
  }
  return tiles.get(key);
}

/** Tile keys covering a box of ±`deg` around a point. */
export function tilesAround(lat, lng, deg) {
  const out = new Set();
  for (let a = Math.floor((lat - deg) / TILE); a <= Math.floor((lat + deg) / TILE); a++) {
    for (let b = Math.floor((lng - deg) / TILE); b <= Math.floor((lng + deg) / TILE); b++) out.add(`${a},${b}`);
  }
  return [...out];
}

function segDistM(p, a, b) {
  const kx = 111320 * Math.cos((p.lat * Math.PI) / 180); const ky = 110574;
  const ax = (a[1] - p.lng) * kx; const ay = (a[0] - p.lat) * ky; const bx = (b[1] - p.lng) * kx; const by = (b[0] - p.lat) * ky;
  const dx = bx - ax; const dy = by - ay; const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}
/** Distance (m) from p to the nearest line in `lines`, capped at `cap`. */
export function nearestM(p, lines, cap = 3000) {
  const dLat = cap / 110574 + 0.001; const dLng = cap / (111320 * Math.cos((p.lat * Math.PI) / 180)) + 0.001;
  let d = cap;
  for (const g of lines) {
    for (let i = 1; i < g.length; i++) {
      const a = g[i - 1]; const b = g[i];
      if (Math.min(a[0], b[0]) > p.lat + dLat || Math.max(a[0], b[0]) < p.lat - dLat || Math.min(a[1], b[1]) > p.lng + dLng || Math.max(a[1], b[1]) < p.lng - dLng) continue;
      d = Math.min(d, segDistM(p, a, b));
    }
  }
  return d;
}

/** Roads and rivers near a point (loads the surrounding tiles). */
export async function roadsRiversNear(p, deg = 0.05) {
  const ts = await Promise.all(tilesAround(p.lat, p.lng, deg).map(tile));
  return { roads: ts.flatMap((t) => t.roads), rivers: ts.flatMap((t) => t.rivers) };
}
