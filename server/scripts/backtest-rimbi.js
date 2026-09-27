// Backtest: what would the current risk engine have said at Rimbi (West Sikkim) before and during the
// 2026 landslides? Uses real past hourly weather from Open-Meteo for Rimbi's coordinates, the terrain profile
// of the nearest monitored place (Gyalshing, on the Rimbi river), and the same engine as the live site.
// No simulated variation, no IMD (not configured), no seismic input.
//
//   node scripts/backtest-rimbi.js
//
// Reported events (news): 13 Aug (2 houses), 14 Aug (~30 houses), 24 Sep night (major slide, 30+ houses).
import { HOURLY_VARS } from '../src/ingest/openMeteo.js';
import { featuresAt } from '../src/ingest/features.js';
import { normaliseStatic, normaliseDynamic, scoreFrom, levelFromScore, ENGINE_VERSION } from '../src/prediction/engine.js';
import { seedData } from '../src/config/shared.js';

const UA = 'Bhu-Rakshak/0.1 (SIH 2026 landslide early warning prototype)';
const EVENTS = ['2026-08-13', '2026-08-14', '2026-09-24'];

async function rimbiCoords() {
  const p = new URLSearchParams({ format: 'jsonv2', q: 'Rimbi, Sikkim', countrycodes: 'in', limit: '1' });
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${p}`, { headers: { 'User-Agent': UA } });
  const [hit] = await r.json();
  if (!hit) throw new Error('Rimbi not found');
  return { lat: +(+hit.lat).toFixed(4), lng: +(+hit.lon).toFixed(4), name: hit.display_name };
}

async function hourlyWeather({ lat, lng }) {
  const p = new URLSearchParams({ latitude: lat, longitude: lng, hourly: HOURLY_VARS.join(','), past_days: '62', forecast_days: '2', timezone: 'GMT' });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`);
  return (await r.json()).hourly;
}

const ist = (utcHour) => new Date(new Date(utcHour + ':00Z').getTime() + 19800000).toISOString().slice(0, 16).replace('T', ' ');

const place = await rimbiCoords();
console.log(`Rimbi: ${place.lat}, ${place.lng} (${place.name.split(',').slice(0, 3).join(',')})`);
const staticRow = seedData.staticLayers.layers.gyalshing;
const st = normaliseStatic(staticRow);
const hourly = await hourlyWeather(place);
const elevation = staticRow.elevation_m;

// Score every hour.
const rows = hourly.time.map((t, i) => {
  const f = featuresAt(hourly, i);
  const r = scoreFrom(st, normaliseDynamic(f, elevation));
  return { t, istT: ist(t), score: r.score, level: levelFromScore(r.score), rain1h: f.rain_intensity, rain24: f.rain_24h, rain72: f.rain_72h, sat: f.saturation_index, drivers: r.drivers.slice(0, 2).map((d) => d.key).join('+') };
});

console.log(`engine ${ENGINE_VERSION} · terrain profile: Gyalshing (slope ${staticRow.slope_deg}°, ${staticRow.lithology_class})\n`);
console.log('Daily (IST): max score · level · rain that day (mm) · max 1-h rain · 72-h rain at peak');
const days = {};
for (const r of rows) (days[r.istT.slice(0, 10)] ||= []).push(r);
for (const [d, rs] of Object.entries(days)) {
  if (d < '2026-08-01') continue;
  const peak = rs.reduce((a, b) => (b.score > a.score ? b : a));
  const rain = rs.reduce((a, b) => a + b.rain1h, 0);
  const tag = EVENTS.includes(d) ? '  <== reported landslide' : '';
  console.log(`${d}  ${peak.score.toFixed(2)} ${peak.level.padEnd(8)} rain ${rain.toFixed(0).padStart(4)}  max1h ${Math.max(...rs.map((x) => x.rain1h)).toFixed(1).padStart(5)}  72h ${peak.rain72.toFixed(0).padStart(4)}${tag}`);
}

// Level counts, to see how often the engine would have warned overall.
const counts = {};
for (const r of rows.filter((x) => x.istT >= '2026-08-01')) counts[r.level] = (counts[r.level] || 0) + 1;
console.log('\nHours at each level since 1 Aug:', JSON.stringify(counts));

console.log('\n24 Sep 12:00 → 25 Sep 06:00 IST, every 2 h:');
for (const r of rows.filter((x) => x.istT >= '2026-09-24 12:00' && x.istT <= '2026-09-25 06:00').filter((_, i) => i % 2 === 0)) {
  console.log(`  ${r.istT}  ${r.score.toFixed(2)} ${r.level.padEnd(8)} 1h ${r.rain1h.toFixed(1).padStart(4)}  24h ${r.rain24.toFixed(0).padStart(3)}  sat ${r.sat.toFixed(2)}  ${r.drivers}`);
}
