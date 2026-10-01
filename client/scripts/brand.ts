// Regenerate everything made from the shield builder (client/src/brand/shield.ts):
//   public/favicon.svg, public/brand/bhurakshak-{logo,mark,mini}.svg, and the first-paint loader in index.html.
// Run from the repo root:  node client/scripts/brand.ts
// (App icons as PNG are rendered from public/brand/bhurakshak-mark.svg; see the PNG step in the commit notes.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shieldSvg } from '../src/brand/shield.ts';

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = (p: string) => path.join(CLIENT, 'public', p);

fs.mkdirSync(pub('brand'), { recursive: true });
fs.writeFileSync(pub('favicon.svg'), shieldSvg('mini', { id: 'fav' }) + '\n');
fs.writeFileSync(pub('brand/bhurakshak-logo.svg'), shieldSvg('full', { id: 'logo', title: 'Bhu-Rakshak · ByteMatrix' }) + '\n');
fs.writeFileSync(pub('brand/bhurakshak-mark.svg'), shieldSvg('mark', { id: 'mark', title: 'Bhu-Rakshak' }) + '\n');
fs.writeFileSync(pub('brand/bhurakshak-mini.svg'), shieldSvg('mini', { id: 'mini', title: 'Bhu-Rakshak' }) + '\n');

// First-paint loader: shown before any script or stylesheet arrives, so the CSS is inlined.
const css = fs.readFileSync(path.join(CLIENT, 'src/brand/shield.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '').replace(/\s{2,}/g, ' ');
const loader = [
  '<div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;font-family:system-ui,sans-serif">',
  shieldSvg('full', { id: 'boot', className: 'bm bm-intro bm-loop', width: 170 }),
  '</div>',
  `<style>${css}[data-theme='dark'] #root > div{background:#0a151a}</style>`,
].join('\n      ');
const htmlFile = path.join(CLIENT, 'index.html');
const html = fs.readFileSync(htmlFile, 'utf8');
const start = '<!-- brand:loader -->';
const end = '<!-- /brand:loader -->';
const a = html.indexOf(start); const b = html.indexOf(end);
if (a < 0 || b < a) throw new Error('index.html is missing the brand:loader markers');
fs.writeFileSync(htmlFile, `${html.slice(0, a + start.length)}\n      ${loader}\n      ${html.slice(b)}`);
console.log('brand files written; loader', loader.length, 'chars');
