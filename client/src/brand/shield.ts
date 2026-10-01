// The Bhu-Rakshak shield (ByteMatrix), redrawn as SVG from the team's logo so each part can animate: the segmented
// brown shield, three snow-capped peaks, the AI "brain" badge, circuit traces in the sky and down the mountain, and the
// warning "!" with its signal waves. One builder feeds the app (BrandShield), the first-paint loader in index.html,
// the favicon and the app icons (client/scripts/brand.ts), so they never drift apart.
//
// Variants: 'full' (with BHURAKSHAK / BYTEMATRIX), 'mark' (no text, curved base) and 'mini' (simplified for ≤ 40 px).
// Animation hooks are CSS classes (see "Brand shield" in styles/index.css): bm-draw, bm-rise, bm-fade, bm-pop, bm-drop,
// bm-wave (with --w), bm-flow and bm-glow, timed with --d.

export type ShieldVariant = 'full' | 'mark' | 'mini';

export const BRAND = {
  brown: '#7d522d', blue: '#3f86c9', green: '#2e6a3d', greenLight: '#3f8048', greenDark: '#24583a', greenSide: '#2a6239',
  outline: '#1d4a2a', snow: '#f5f6f7', snowShade: '#c3c8cc', ink: '#333333', inkSoft: '#6f6f6f',
};

const f = (n: number) => +n.toFixed(1);
/** Mirror an "x y" path across the shield's centre line (x = 300). */
const mirror = (d: string) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_m, x, y) => `${f(600 - Number(x))} ${y}`);
// ---------- Geometry (viewBox 0 -10 600 690; the mark and mini end higher) ----------
const OUT = {
  full: 'M 0 64 L 205 6 L 395 6 L 600 64 L 600 430 C 600 540 470 610 300 676 C 130 610 0 540 0 430 Z',
  mark: 'M 0 64 L 205 6 L 395 6 L 600 64 L 600 380 C 600 470 480 545 300 600 C 120 545 0 470 0 380 Z',
};
const FRAME = {
  full: 'M 205 52 L 48 96 L 48 478 L 552 478 L 552 96 L 395 52',
  mark: 'M 205 52 L 48 96 L 48 380 C 48 452 150 512 300 556 C 450 512 552 452 552 380 L 552 96 L 395 52',
};
const WINDOW = {
  full: 'M 53 99 L 300 40 L 547 99 L 547 473 L 53 473 Z',
  mark: 'M 53 99 L 300 40 L 547 99 L 547 380 C 547 448 447 506 300 550 C 153 506 53 448 53 380 Z',
};
const CUTS = {
  full: ['M -4 60 L 40 100', 'M -6 292 L 44 284', 'M 6 522 L 52 502', 'M 184 642 L 214 606'],
  mark: ['M -4 60 L 40 100', 'M -6 260 L 44 252', 'M 14 470 L 58 450', 'M 196 574 L 220 538'],
};
const CHEVRON = 'M 214 566 Q 300 584 386 566 L 300 620 Z';

// Mountains (bottom edge B is pushed below the window and clipped).
const peaks = (B: number) => ({
  left: `M 36 410 L 120 300 L 140 292 L 162 246 L 186 270 L 200 262 L 240 330 L 240 ${B} L 36 ${B} Z`,
  leftLight: `M 162 246 L 140 292 L 120 300 L 36 410 L 36 ${B} L 104 ${B} L 140 360 Z`,
  centre: `M 300 164 L 318 186 L 330 182 L 372 248 L 400 268 L 492 ${B} L 108 ${B} L 200 268 L 228 248 L 270 182 L 282 186 Z`,
  centreLight: `M 300 164 L 282 186 L 270 182 L 228 248 L 200 268 L 108 ${B} L 198 ${B} L 214 400 L 246 330 L 268 262 L 286 212 Z`,
  centreDark: `M 300 164 L 318 186 L 330 182 L 372 248 L 400 268 L 492 ${B} L 424 ${B} L 382 330 L 348 252 Z`,
});
const SNOW_CENTRE = 'M 300 160 L 342 210 L 328 206 L 316 220 L 306 206 L 294 222 L 284 206 L 266 214 Z';
const SNOW_CENTRE_SHADE = 'M 300 160 L 342 210 L 328 206 L 316 220 L 306 206 L 300 213 Z';
const SNOW_LEFT = 'M 162 242 L 192 280 L 182 278 L 172 292 L 162 280 L 152 294 L 144 282 L 132 288 Z';
const SNOW_LEFT_SHADE = 'M 162 242 L 192 280 L 182 278 L 172 292 L 166 284 Z';

// Circuit traces: [path from the mountain outward, terminal node or null]. The right side mirrors the left.
const SKY: [string, [number, number] | null][] = [
  ['M 258 210 L 234 186 L 132 186 L 118 172 L 118 145', [118, 138]],
  ['M 248 226 L 226 204 L 176 204 L 164 192 L 164 182', [164, 175]],
  ['M 236 240 L 220 224 L 90 224', [83, 224]],
];
// Roots: a fan of traces from under the brain down and out across the whole mountain, with nodes on short stubs.
const ROOTS = (B: number): [string, [number, number] | null][] => [
  [`M 290 302 L 290 ${B}`, null],
  [`M 280 298 L 280 316 L 272 324 L 272 ${B}`, null],
  [`M 270 292 L 262 300 L 262 336 L 252 346 L 252 ${B}`, null],
  [`M 262 286 L 244 304 L 244 322 L 230 336 L 230 ${B}`, null],
  [`M 230 386 L 208 408 L 208 ${B}`, null],
  [`M 208 440 L 184 464 L 184 ${B}`, null],
  ['M 258 280 L 224 280 L 212 292', [207, 297]],
  ['M 230 356 L 202 356 L 190 368', [185, 373]],
  ['M 252 404 L 238 418', [233, 423]],
  ['M 208 420 L 182 420 L 168 434', [163, 439]],
];

// Brain badge.
const BRAIN_L = 'M 296 234 C 284 230 272 236 272 246 C 262 250 262 264 268 270 C 264 282 276 292 288 288 C 291 293 296 292 296 288 Z';
const BRAIN_L_LINES = 'M 296 248 L 282 242 L 274 256 L 284 268 L 296 264 M 284 268 L 280 282 M 282 242 L 288 234 M 274 256 L 266 262';

// Warning "!" and three signal waves each side, centred on (300, 92).
const WAVE_R = [46, 76, 106];
const wave = (r: number, side: -1 | 1) => {
  const x = f(300 + side * r * 0.53); const dy = f(r * 0.848);
  return `M ${x} ${f(92 - dy)} A ${r} ${r} 0 0 ${side === 1 ? 1 : 0} ${x} ${f(92 + dy)}`;
};

const attrs = (o: Record<string, string | number | undefined>) => Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}="${v}"`).join(' ');
const d = (s: number) => `--d:${s}s`;

/** Inner SVG markup (no <svg> wrapper). `id` keeps clip/mask ids unique when several shields are on one page. */
export function shieldInner(variant: ShieldVariant = 'full', id = 'bm'): string {
  const C = BRAND;
  if (variant === 'mini') return miniInner(id);
  const v = variant === 'full' ? 'full' : 'mark';
  const B = v === 'full' ? 480 : 600;
  const P = peaks(B);
  const out: string[] = [];
  out.push(`<defs><clipPath id="${id}-out"><path d="${OUT[v]}"/></clipPath><clipPath id="${id}-win"><path d="${WINDOW[v]}"/></clipPath>`
    + `<mask id="${id}-band" maskUnits="userSpaceOnUse" x="-20" y="-20" width="640" height="720"><rect x="-20" y="-20" width="640" height="720" fill="#fff"/><rect x="205" y="-20" width="190" height="96" fill="#000"/></mask></defs>`);

  // Shield: white field, band (a thick stroke clipped to the outline), segment cuts, inner frame.
  out.push(`<path d="${OUT[v]}" fill="#fff"/>`);
  out.push(`<g mask="url(#${id}-band)"><path class="bm-draw" style="${d(0)}" pathLength="1" d="${OUT[v]}" fill="none" stroke="${C.brown}" stroke-width="68" clip-path="url(#${id}-out)"/></g>`);
  out.push(`<g class="bm-fade" style="${d(0.7)}" stroke="#fff" stroke-width="10" stroke-linecap="butt" clip-path="url(#${id}-out)">${CUTS[v].flatMap((c) => [c, mirror(c)]).map((c) => `<path d="${c}"/>`).join('')}</g>`);
  out.push(`<path class="bm-draw" style="${d(0.25)}" pathLength="1" d="${FRAME[v]}" fill="none" stroke="${C.brown}" stroke-width="9" stroke-linejoin="miter"/>`);
  if (v === 'full') out.push(`<path class="bm-pop" style="${d(0.8)}" d="${CHEVRON}" fill="${C.brown}"/>`);

  // Mountains and the circuits inside them, clipped to the window.
  out.push(`<g clip-path="url(#${id}-win)">`);
  out.push(`<g class="bm-rise" style="${d(0.35)}"><path d="${P.left}" fill="${C.greenSide}" stroke="${C.outline}" stroke-width="4" stroke-linejoin="round"/><path d="${P.leftLight}" fill="${C.greenLight}" opacity=".75"/>`
    + `<path d="${SNOW_LEFT}" fill="${C.snow}"/><path d="${SNOW_LEFT_SHADE}" fill="${C.snowShade}"/></g>`);
  out.push(`<g class="bm-rise" style="${d(0.42)}"><path d="${mirror(P.left)}" fill="${C.greenSide}" stroke="${C.outline}" stroke-width="4" stroke-linejoin="round"/><path d="${mirror(P.leftLight)}" fill="${C.greenDark}" opacity=".6"/>`
    + `<path d="${mirror(SNOW_LEFT)}" fill="${C.snow}"/><path d="${mirror(SNOW_LEFT_SHADE)}" fill="${C.snowShade}"/></g>`);
  out.push(`<g class="bm-rise" style="${d(0.5)}"><path d="${P.centre}" fill="${C.green}" stroke="${C.outline}" stroke-width="4" stroke-linejoin="round"/>`
    + `<path d="${P.centreLight}" fill="${C.greenLight}" opacity=".85"/><path d="${P.centreDark}" fill="${C.greenDark}" opacity=".55"/>`
    + `<path d="${SNOW_CENTRE}" fill="${C.snow}"/><path d="${SNOW_CENTRE_SHADE}" fill="${C.snowShade}"/></g>`);
  out.push(traces(ROOTS(B), 1.0, 'root'));
  out.push(`<circle class="bm-pop" style="${d(1.0)}" cx="300" cy="318" r="6" fill="${C.blue}"/>`);
  out.push(`<path class="bm-draw" style="${d(0.95)}" pathLength="1" d="M 300 304 L 300 ${B}" fill="none" stroke="${C.blue}" stroke-width="4"/>`);
  out.push(`<path class="bm-flow" style="${d(0.2)}" pathLength="1" d="M 300 ${B} L 300 304" fill="none" stroke="#bfe0ff" stroke-width="4" stroke-linecap="round" opacity="0"/>`);
  out.push('</g>');

  // Sky circuits (the sensor network), the brain, the warning and its waves.
  out.push(traces(SKY, 1.15, 'sky'));
  out.push(`<g class="bm-glow" opacity="0"><circle cx="300" cy="262" r="50" fill="${C.blue}" opacity=".2"/></g>`);
  out.push(`<g class="bm-pop" style="${d(1.05)}"><circle cx="300" cy="262" r="40" fill="#fff" stroke="${C.blue}" stroke-width="5"/>`
    + `<g fill="none" stroke="${C.blue}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"><path d="${BRAIN_L}"/><path d="${mirror(BRAIN_L)}"/><path d="${BRAIN_L_LINES}"/><path d="${mirror(BRAIN_L_LINES)}"/></g></g>`);
  out.push(`<g class="bm-drop bm-bang" style="${d(1.25)}" fill="${C.blue}"><path d="M 285 20 L 300 10 L 315 20 L 310 104 L 290 104 Z"/><path d="M 297 30 L 303 30 L 302 84 L 298 84 Z" fill="#fff"/><circle cx="300" cy="124" r="12"/></g>`);
  out.push(`<g fill="none" stroke="${C.blue}" stroke-width="12" stroke-linecap="round">${WAVE_R.map((r, i) => {
    return `<path class="bm-wave" style="--w:${i};${d(1.45 + i * 0.12)}" d="${wave(r, -1)}"/><path class="bm-wave" style="--w:${i};${d(1.45 + i * 0.12)}" d="${wave(r, 1)}"/>`;
  }).join('')}</g>`);

  if (v === 'full') {
    out.push(`<g class="bm-fade" style="${d(1.6)}" text-anchor="middle" font-family="'Montserrat','Source Sans 3','Segoe UI',system-ui,sans-serif">`
      + `<text x="300" y="532" font-size="40" font-weight="800" letter-spacing="1.5" fill="${C.ink}">BHURAKSHAK</text>`
      + `<text x="300" y="560" font-size="17" font-weight="600" letter-spacing="3" fill="${C.inkSoft}">BYTEMATRIX</text></g>`);
  }
  return out.join('');
}

function traces(list: [string, [number, number] | null][], start: number, kind: string): string {
  const C = BRAND;
  // Nodes on the mountain are hollow (green inside), like the original; nodes in the sky are white.
  const nodeFill = kind === 'root' ? C.green : '#fff';
  const parts: string[] = [];
  list.forEach(([p, node], i) => {
    for (const [path, n, side] of [[p, node, 0], [mirror(p), node ? [600 - node[0], node[1]] as [number, number] : null, 1]] as const) {
      const delay = start + i * 0.07 + side * 0.03;
      parts.push(`<path class="bm-draw" style="${d(delay)}" pathLength="1" d="${path}" fill="none" stroke="${C.blue}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`);
      parts.push(`<path class="bm-flow" style="${d((i * 0.37 + side * 0.9) % 2.2)}" pathLength="1" d="${path}" fill="none" stroke="#bfe0ff" stroke-width="4" stroke-linecap="round" opacity="0"/>`);
      if (n) parts.push(`<circle class="bm-pop" style="${d(delay + 0.45)}" cx="${n[0]}" cy="${n[1]}" r="7" fill="${nodeFill}" stroke="${C.blue}" stroke-width="3.5"/>`);
    }
  });
  return `<g data-kind="${kind}">${parts.join('')}</g>`;
}

/** Small sizes: shield, one peak, the "!" and one pair of waves. */
function miniInner(id: string): string {
  const C = BRAND;
  return `<defs><clipPath id="${id}-out"><path d="${OUT.mark}"/></clipPath><clipPath id="${id}-win"><path d="${WINDOW.mark}"/></clipPath></defs>`
    + `<path d="${OUT.mark}" fill="#fff"/>`
    + `<path class="bm-draw" style="${d(0)}" pathLength="1" d="${OUT.mark}" fill="none" stroke="${C.brown}" stroke-width="110" clip-path="url(#${id}-out)"/>`
    + `<g clip-path="url(#${id}-win)"><g class="bm-rise" style="${d(0.3)}"><path d="M 300 200 L 470 470 L 600 600 L 0 600 L 130 470 Z" fill="${C.green}"/>`
    + `<path d="M 300 200 L 352 282 L 330 276 L 312 300 L 296 278 L 276 298 L 258 272 L 248 282 Z" fill="${C.snow}"/></g></g>`
    + `<g class="bm-drop bm-bang" style="${d(0.5)}" fill="${C.blue}"><path d="M 278 30 L 300 16 L 322 30 L 314 130 L 286 130 Z"/><circle cx="300" cy="160" r="20"/></g>`
    + `<g fill="none" stroke="${C.blue}" stroke-width="24" stroke-linecap="round"><path class="bm-wave" style="--w:0;${d(0.7)}" d="M 236 34 A 92 92 0 0 0 236 170"/><path class="bm-wave" style="--w:0;${d(0.7)}" d="M 364 34 A 92 92 0 0 1 364 170"/></g>`;
}

export const SHIELD_VIEWBOX: Record<ShieldVariant, string> = { full: '-6 -14 612 700', mark: '-6 -14 612 622', mini: '-6 -14 612 622' };

/** Complete standalone <svg> (favicon, static files, the first-paint loader). */
export function shieldSvg(variant: ShieldVariant = 'full', opts: { id?: string; className?: string; width?: number; height?: number; title?: string } = {}) {
  const id = opts.id || `bm-${variant}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" ${attrs({ viewBox: SHIELD_VIEWBOX[variant], class: opts.className, width: opts.width, height: opts.height, role: opts.title ? 'img' : undefined, 'aria-label': opts.title, 'aria-hidden': opts.title ? undefined : 'true' })}>${shieldInner(variant, id)}</svg>`;
}
