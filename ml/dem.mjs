// Terrain from AWS Terrain Tiles (Registry of Open Data on AWS, "Terrain Tiles"; Terrarium PNG encoding).
// In this region the tiles come mainly from NASA SRTM (~30 m). Keyless, no rate limit; tiles are cached on disk.
// elevation (m) = R·256 + G + B/256 − 32768
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA } from './lib.mjs';
import { terrain3x3 } from './lib.mjs';

const Z = 12; // ~34 m pixels at 27° N
const TILE_URL = (x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`;
const DIR = path.join(DATA, 'cache', 'terrarium');
const tiles = new Map(); // "x/y" -> Promise<Float32Array 256×256>

/** Minimal PNG decoder for 8-bit RGB/RGBA, non-interlaced (what Terrarium tiles are). */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8; let w; let h; let colorType; let bitDepth; let interlace;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace) throw new Error(`unsupported PNG (depth ${bitDepth}, type ${colorType}, interlace ${interlace})`);
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let yy = 0; yy < h; yy++) {
    const f = raw[yy * (stride + 1)];
    const src = yy * (stride + 1) + 1;
    const dst = yy * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const b = yy > 0 ? out[dst - stride + i] : 0;
      const c = yy > 0 && i >= bpp ? out[dst - stride + i - bpp] : 0;
      let v;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      else throw new Error(`bad PNG filter ${f}`);
      out[dst + i] = v & 0xff;
    }
  }
  return { w, h, bpp, pixels: out };
}

async function fetchTile(x, y) {
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, `${Z}_${x}_${y}.png`);
  let buf;
  if (fs.existsSync(file)) buf = fs.readFileSync(file);
  else {
    for (let i = 0; ; i++) {
      try {
        const r = await fetch(TILE_URL(x, y), { signal: AbortSignal.timeout(60000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        buf = Buffer.from(await r.arrayBuffer());
        fs.writeFileSync(file, buf);
        break;
      } catch (e) { if (i >= 4) throw e; await new Promise((res) => setTimeout(res, 2000 * 2 ** i)); }
    }
  }
  const png = decodePng(buf);
  const elev = new Float32Array(png.w * png.h);
  for (let i = 0; i < elev.length; i++) {
    const p = i * png.bpp;
    elev[i] = png.pixels[p] * 256 + png.pixels[p + 1] + png.pixels[p + 2] / 256 - 32768;
  }
  return elev;
}
const tile = (x, y) => {
  const k = `${x}/${y}`;
  if (!tiles.has(k)) tiles.set(k, fetchTile(x, y));
  return tiles.get(k);
};

/** Global pixel coordinates (Web Mercator) of a point at zoom Z. */
function pixelOf(lat, lng) {
  const n = 256 * 2 ** Z;
  const s = Math.sin((lat * Math.PI) / 180);
  return { px: ((lng + 180) / 360) * n, py: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}
async function elevAtPixel(px, py) {
  const X = Math.floor(px); const Y = Math.floor(py);
  const t = await tile(Math.floor(X / 256), Math.floor(Y / 256));
  return t[(Y % 256) * 256 + (X % 256)];
}

/**
 * Terrain factors at a point: elevation, slope/aspect/curvature over ~100 m (3×3 window, 3-pixel spacing),
 * and local relief over ~1 km (height range in a 31×31-pixel window).
 */
export async function terrainAt(lat, lng) {
  const { px, py } = pixelOf(lat, lng);
  const pixM = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** Z);
  const step = 3;
  const z = [];
  for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) z.push(await elevAtPixel(px + dx * step, py + dy * step)); // row 0 = north
  const t = terrain3x3(z, step * pixM, step * pixM);
  let lo = Infinity; let hi = -Infinity;
  for (let dy = -15; dy <= 15; dy += 3) for (let dx = -15; dx <= 15; dx += 3) {
    const v = await elevAtPixel(px + dx, py + dy);
    if (v < lo) lo = v; if (v > hi) hi = v;
  }
  return { elev: z[4], slope: t.slope, aspect: t.aspect, curvature: t.curvature, relief: hi - lo, pixel_m: pixM };
}
