// Read Geofabrik OpenStreetMap extracts (.osm.pbf) and keep only what the model needs: major roads and rivers,
// cut into 0.5° tiles (ml/data/osm_tiles/<lat>,<lng>.json) that osm.mjs reads. Dependency-free PBF reader.
//   node ml/osm_pbf.mjs ml/data/raw/north-eastern-zone.osm.pbf ml/data/raw/eastern-zone.osm.pbf
// Format: https://wiki.openstreetmap.org/wiki/PBF_Format
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA } from './lib.mjs';

const ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']); // same classes as before
const BOX = { minLat: 19.5, maxLat: 32, minLng: 85, maxLng: 100 };
const TILE = 0.5;
const OUT = path.join(DATA, 'osm_tiles');

// ---------- Minimal protobuf reader ----------
class Reader {
  constructor(buf, start = 0, end = buf.length) { this.b = buf; this.p = start; this.end = end; }
  varint() {
    let r = 0; let mul = 1; let byte;
    do { byte = this.b[this.p++]; r += (byte & 0x7f) * mul; mul *= 128; } while (byte & 0x80);
    return r;
  }
  svarint() { const z = this.varint(); return z % 2 === 0 ? z / 2 : -(z + 1) / 2; }
  bytes() { const n = this.varint(); const s = this.p; this.p += n; return [s, this.p]; }
  skip(wire) {
    if (wire === 0) this.varint(); else if (wire === 2) { const n = this.varint(); this.p += n; } else if (wire === 1) this.p += 8; else if (wire === 5) this.p += 4; else throw new Error(`wire ${wire}`);
  }
  *fields() { while (this.p < this.end) { const key = this.varint(); yield [Math.floor(key / 8), key & 7]; } }
}
const packed = (buf, [s, e], signed) => { const r = new Reader(buf, s, e); const out = []; while (r.p < r.end) out.push(signed ? r.svarint() : r.varint()); return out; };

/** Iterate the decompressed primitive blocks of a .osm.pbf file. */
function* blocks(file) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  let pos = 0;
  const lenBuf = Buffer.alloc(4);
  try {
    while (pos < size) {
      fs.readSync(fd, lenBuf, 0, 4, pos); pos += 4;
      const hLen = lenBuf.readUInt32BE(0);
      const header = Buffer.alloc(hLen); fs.readSync(fd, header, 0, hLen, pos); pos += hLen;
      let type = ''; let dataSize = 0;
      const hr = new Reader(header);
      for (const [f, w] of hr.fields()) {
        if (f === 1 && w === 2) { const [s, e] = hr.bytes(); type = header.toString('utf8', s, e); } else if (f === 3 && w === 0) dataSize = hr.varint(); else hr.skip(w);
      }
      const blob = Buffer.alloc(dataSize); fs.readSync(fd, blob, 0, dataSize, pos); pos += dataSize;
      if (type !== 'OSMData') continue;
      const br = new Reader(blob);
      let data = null;
      for (const [f, w] of br.fields()) {
        if (f === 1 && w === 2) { const [s, e] = br.bytes(); data = blob.subarray(s, e); } else if (f === 3 && w === 2) { const [s, e] = br.bytes(); data = zlib.inflateSync(blob.subarray(s, e)); } else br.skip(w);
      }
      if (data) yield data;
    }
  } finally { fs.closeSync(fd); }
}

function parseBlock(buf, { wantWays, wantNodes }) {
  const r = new Reader(buf);
  let strings = [];
  const groups = [];
  let gran = 100; let latOff = 0; let lonOff = 0;
  for (const [f, w] of r.fields()) {
    if (f === 1 && w === 2) {
      const [s, e] = r.bytes(); const sr = new Reader(buf, s, e);
      for (const [ff, ww] of sr.fields()) { if (ff === 1 && ww === 2) { const [a, b] = sr.bytes(); strings.push(buf.toString('utf8', a, b)); } else sr.skip(ww); }
    } else if (f === 2 && w === 2) groups.push(r.bytes());
    else if (f === 17) gran = r.varint(); else if (f === 19) latOff = r.varint(); else if (f === 20) lonOff = r.varint();
    else r.skip(w);
  }
  const ways = []; const nodes = [];
  for (const [gs, ge] of groups) {
    const g = new Reader(buf, gs, ge);
    for (const [f, w] of g.fields()) {
      if (f === 3 && w === 2 && wantWays) {
        const [s, e] = g.bytes(); const wr = new Reader(buf, s, e);
        let keys = []; let vals = []; let refs = null;
        for (const [ff, ww] of wr.fields()) {
          if (ff === 2 && ww === 2) keys = packed(buf, wr.bytes(), false);
          else if (ff === 3 && ww === 2) vals = packed(buf, wr.bytes(), false);
          else if (ff === 8 && ww === 2) refs = wr.bytes();
          else wr.skip(ww);
        }
        let kind = null;
        for (let i = 0; i < keys.length; i++) {
          const k = strings[keys[i]]; const v = strings[vals[i]];
          if (k === 'highway' && ROADS.has(v)) kind = 'road';
          else if (k === 'waterway' && v === 'river') kind = 'river';
        }
        if (kind && refs) { const d = packed(buf, refs, true); let id = 0; ways.push({ kind, refs: d.map((x) => (id += x)) }); }
      } else if (f === 2 && w === 2 && wantNodes) {
        const [s, e] = g.bytes(); const dr = new Reader(buf, s, e);
        let ids = []; let lats = []; let lons = [];
        for (const [ff, ww] of dr.fields()) {
          if (ff === 1 && ww === 2) ids = packed(buf, dr.bytes(), true);
          else if (ff === 8 && ww === 2) lats = packed(buf, dr.bytes(), true);
          else if (ff === 9 && ww === 2) lons = packed(buf, dr.bytes(), true);
          else dr.skip(ww);
        }
        let id = 0; let la = 0; let lo = 0;
        for (let i = 0; i < ids.length; i++) {
          id += ids[i]; la += lats[i]; lo += lons[i];
          nodes.push(id, 1e-9 * (latOff + gran * la), 1e-9 * (lonOff + gran * lo));
        }
      } else g.skip(w);
    }
  }
  return { ways, nodes };
}

// ---------- Two passes: ways first (to know which nodes matter), then their coordinates ----------
const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node ml/osm_pbf.mjs <file.osm.pbf> …'); process.exit(1); }
const ways = [];
for (const file of files) {
  let n = 0;
  for (const b of blocks(file)) { ways.push(...parseBlock(b, { wantWays: true }).ways); if (++n % 500 === 0) console.log(`  ${path.basename(file)}: ${n} blocks, ${ways.length} ways`); }
}
const needed = new Map();
for (const w of ways) for (const id of w.refs) needed.set(id, -1);
console.log(`${ways.length} road/river ways, ${needed.size} nodes to locate`);
const lat = new Float64Array(needed.size); const lng = new Float64Array(needed.size);
let k = 0;
for (const file of files) {
  let n = 0;
  for (const b of blocks(file)) {
    const { nodes } = parseBlock(b, { wantNodes: true });
    for (let i = 0; i < nodes.length; i += 3) {
      if (needed.get(nodes[i]) === -1) { needed.set(nodes[i], k); lat[k] = nodes[i + 1]; lng[k] = nodes[i + 2]; k++; }
    }
    if (++n % 500 === 0) console.log(`  ${path.basename(file)}: ${n} blocks, ${k} nodes located`);
  }
}

// ---------- Cut into tiles ----------
const tiles = new Map();
let missingNodes = 0;
for (const w of ways) {
  const g = [];
  for (const id of w.refs) { const i = needed.get(id); if (i >= 0) g.push([+lat[i].toFixed(6), +lng[i].toFixed(6)]); else missingNodes++; }
  if (g.length < 2) continue;
  const keys = new Set(g.filter(([a, b]) => a >= BOX.minLat && a <= BOX.maxLat && b >= BOX.minLng && b <= BOX.maxLng).map(([a, b]) => `${Math.floor(a / TILE)},${Math.floor(b / TILE)}`));
  for (const key of keys) {
    if (!tiles.has(key)) tiles.set(key, { roads: [], rivers: [] });
    tiles.get(key)[w.kind === 'road' ? 'roads' : 'rivers'].push(g);
  }
}
fs.mkdirSync(OUT, { recursive: true });
for (const [key, t] of tiles) fs.writeFileSync(path.join(OUT, `${key}.json`), JSON.stringify(t));
fs.writeFileSync(path.join(OUT, '_index.json'), JSON.stringify({ built_at: new Date().toISOString(), sources: files.map((f) => path.basename(f)), tiles: tiles.size, ways: ways.length, missing_nodes: missingNodes }, null, 2));
console.log(`wrote ${tiles.size} tiles to ml/data/osm_tiles (${missingNodes} way nodes outside the extracts)`);
