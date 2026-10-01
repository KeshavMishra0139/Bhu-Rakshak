// Dependency-free reader for OpenStreetMap .osm.pbf extracts that keeps tags, for scripts that need more than the
// road/river geometry osm_pbf.mjs extracts (e.g. build_exposure_osm.mjs counts buildings, schools and hospitals).
// Format: https://wiki.openstreetmap.org/wiki/PBF_Format
import fs from 'node:fs';
import zlib from 'node:zlib';

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

/** Decompressed primitive blocks of a .osm.pbf file. */
export function* blocks(file) {
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

/**
 * Parse one block. Calls onNode(id, lat, lng, tags|null) for every dense node and onWay(id, tags, refs) for every way.
 * Tags are only decoded when the callback asks for them via `wantNodeTags` / always for ways (ways are fewer).
 */
export function parseBlock(buf, { onNode, onWay }) {
  const r = new Reader(buf);
  const strings = [];
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
  for (const [gs, ge] of groups) {
    const g = new Reader(buf, gs, ge);
    for (const [f, w] of g.fields()) {
      if (f === 3 && w === 2 && onWay) {
        const [s, e] = g.bytes(); const wr = new Reader(buf, s, e);
        let id = 0; let keys = []; let vals = []; let refs = null;
        for (const [ff, ww] of wr.fields()) {
          if (ff === 1 && ww === 0) id = wr.varint();
          else if (ff === 2 && ww === 2) keys = packed(buf, wr.bytes(), false);
          else if (ff === 3 && ww === 2) vals = packed(buf, wr.bytes(), false);
          else if (ff === 8 && ww === 2) refs = wr.bytes();
          else wr.skip(ww);
        }
        const tags = {};
        for (let i = 0; i < keys.length; i++) tags[strings[keys[i]]] = strings[vals[i]];
        let ref = 0;
        onWay(id, tags, refs ? packed(buf, refs, true).map((x) => (ref += x)) : []);
      } else if (f === 2 && w === 2 && onNode) {
        const [s, e] = g.bytes(); const dr = new Reader(buf, s, e);
        let ids = []; let lats = []; let lons = []; let kv = null;
        for (const [ff, ww] of dr.fields()) {
          if (ff === 1 && ww === 2) ids = packed(buf, dr.bytes(), true);
          else if (ff === 8 && ww === 2) lats = packed(buf, dr.bytes(), true);
          else if (ff === 9 && ww === 2) lons = packed(buf, dr.bytes(), true);
          else if (ff === 10 && ww === 2) kv = packed(buf, dr.bytes(), false);
          else dr.skip(ww);
        }
        let id = 0; let la = 0; let lo = 0; let k = 0;
        for (let i = 0; i < ids.length; i++) {
          id += ids[i]; la += lats[i]; lo += lons[i];
          // keys_vals: k,v,k,v,…,0 per node (0 alone = no tags).
          let tags = null;
          if (kv) {
            while (k < kv.length && kv[k] !== 0) { (tags ||= {})[strings[kv[k]]] = strings[kv[k + 1]]; k += 2; }
            k++;
          }
          onNode(id, 1e-9 * (latOff + gran * la), 1e-9 * (lonOff + gran * lo), tags);
        }
      } else g.skip(w);
    }
  }
}
