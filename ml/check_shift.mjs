// Does the live website's rain data match what the model was trained on?
// Training: ERA5 reanalysis (Open-Meteo archive). Live: Open-Meteo forecast API (its past days).
// For each monitored place, compare daily rain over the last ~80 days (where both exist).
//   node ml/check_shift.mjs   → ml/models/data_shift.md
import fs from 'node:fs';
import path from 'node:path';
import { ML_ROOT, addDays } from './lib.mjs';

const REPO = path.resolve(ML_ROOT, '..');
const locations = JSON.parse(fs.readFileSync(path.join(REPO, 'server/src/data/locations.json'), 'utf8'));
const list = Array.isArray(locations) ? locations : locations.locations;
const today = new Date().toISOString().slice(0, 10);
const end = addDays(today, -6); // ERA5 is published with a ~5-day lag
const start = addDays(end, -80);
const q = (o) => new URLSearchParams(o).toString();
const get = async (u) => { for (let i = 0; i < 5; i++) { const r = await fetch(u); if (r.ok) return r.json(); await new Promise((res) => setTimeout(res, r.status === 429 ? 65000 : 2000)); } throw new Error('fetch failed ' + u); };

const rows = [];
for (const l of list) {
  const common = { latitude: l.lat, longitude: l.lng, start_date: start, end_date: end, daily: 'precipitation_sum', timezone: 'Asia/Kolkata' };
  const era = await get(`https://archive-api.open-meteo.com/v1/archive?${q(common)}`);
  await new Promise((r) => setTimeout(r, 1200));
  const fc = await get(`https://api.open-meteo.com/v1/forecast?${q(common)}`);
  await new Promise((r) => setTimeout(r, 1200));
  const a = era.daily.precipitation_sum; const b = fc.daily.precipitation_sum;
  const pairs = a.map((v, i) => [v, b[i]]).filter(([x, y]) => x != null && y != null);
  const sa = pairs.reduce((s, [x]) => s + x, 0); const sb = pairs.reduce((s, [, y]) => s + y, 0);
  const ma = sa / pairs.length; const mb = sb / pairs.length;
  const cov = pairs.reduce((s, [x, y]) => s + (x - ma) * (y - mb), 0);
  const va = pairs.reduce((s, [x]) => s + (x - ma) ** 2, 0); const vb = pairs.reduce((s, [, y]) => s + (y - mb) ** 2, 0);
  // 3-day totals (the model's most-used rain factor)
  const r3 = (arr) => arr.map((_, i) => (i >= 2 ? arr[i] + arr[i - 1] + arr[i - 2] : null)).filter((x) => x != null);
  const a3 = r3(pairs.map(([x]) => x)); const b3 = r3(pairs.map(([, y]) => y));
  const m3a = a3.reduce((s, x) => s + x, 0) / a3.length; const m3b = b3.reduce((s, x) => s + x, 0) / b3.length;
  const c3 = a3.reduce((s, x, i) => s + (x - m3a) * (b3[i] - m3b), 0) / Math.sqrt(a3.reduce((s, x) => s + (x - m3a) ** 2, 0) * b3.reduce((s, y) => s + (y - m3b) ** 2, 0));
  rows.push({ id: l.id, name: l.name_en, days: pairs.length, era5_mm: sa, forecast_mm: sb, ratio: sb / sa, corr_daily: cov / Math.sqrt(va * vb), corr_3day: c3 });
  console.log(l.id.padEnd(12), `ERA5 ${sa.toFixed(0)} mm, live ${sb.toFixed(0)} mm, ratio ${(sb / sa).toFixed(2)}, daily r=${(cov / Math.sqrt(va * vb)).toFixed(2)}, 3-day r=${c3.toFixed(2)}`);
}
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const md = `# Live rain vs training rain (${start} → ${end})

Training used ERA5 reanalysis; the website gets rain from the Open-Meteo forecast API. Same places, same days:

| Place | Days | ERA5 total (mm) | Live-feed total (mm) | Live ÷ ERA5 | Daily correlation | 3-day correlation |
|---|---|---|---|---|---|---|
${rows.map((r) => `| ${r.name} | ${r.days} | ${r.era5_mm.toFixed(0)} | ${r.forecast_mm.toFixed(0)} | ${r.ratio.toFixed(2)} | ${r.corr_daily.toFixed(2)} | ${r.corr_3day.toFixed(2)} |`).join('\n')}

Median ratio **${med(rows.map((r) => r.ratio)).toFixed(2)}**, median 3-day correlation **${med(rows.map((r) => r.corr_3day)).toFixed(2)}**.
`;
fs.writeFileSync(path.join(ML_ROOT, 'models', 'data_shift.md'), md);
fs.writeFileSync(path.join(ML_ROOT, 'models', 'data_shift.json'), JSON.stringify({ start, end, rows, median_ratio: med(rows.map((r) => r.ratio)) }, null, 2));
console.log(md);
