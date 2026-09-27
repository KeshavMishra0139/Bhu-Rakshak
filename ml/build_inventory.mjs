// Step 1a: landslide inventory for North East India (incl. Sikkim and the Darjeeling hills).
//   node ml/build_inventory.mjs
// Sources:
//   • NASA Global Landslide Catalog (GLC, news-based, 2007–2017+): data.nasa.gov "global-landslide-catalog-export"
//   • ml/data/manual_events.csv: recent events checked by hand against news reports (source URL on every row)
// Output: ml/data/inventory.csv
import fs from 'node:fs';
import path from 'node:path';
import { DATA, getCached, parseCsv, writeCsv } from './lib.mjs';

const GLC_URL = 'https://data.nasa.gov/docs/legacy/Global_Landslide_Catalog_Export/Global_Landslide_Catalog_Export_rows.csv';
const BOX = { minLat: 21.9, maxLat: 29.6, minLng: 87.5, maxLng: 97.5 }; // NE India + Sikkim + Darjeeling/Kalimpong
const ACCURACY_KM = { exact: 0.5, '1km': 1, '5km': 5, '10km': 10, '25km': 25 }; // coarser than 25 km is dropped

const raw = path.join(DATA, 'raw', 'nasa_glc.csv');
if (!fs.existsSync(raw)) {
  fs.mkdirSync(path.dirname(raw), { recursive: true });
  fs.writeFileSync(raw, await getCached(GLC_URL, { json: false, timeoutMs: 240000 }));
}
const glc = parseCsv(fs.readFileSync(raw, 'utf8'));

const usDate = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s || '');
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
};
const STATE = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^Bengal$/, 'West Bengal');

const dropped = { outside: 0, not_india: 0, coarse_location: 0, no_date: 0, not_landslide: 0 };
const events = [];
for (const o of glc) {
  const lat = +o.latitude;
  const lng = +o.longitude;
  if (!(lat >= BOX.minLat && lat <= BOX.maxLat && lng >= BOX.minLng && lng <= BOX.maxLng)) { dropped.outside++; continue; }
  if (o.country_code !== 'IN') { dropped.not_india++; continue; }
  const acc = ACCURACY_KM[o.location_accuracy];
  if (acc == null) { dropped.coarse_location++; continue; }
  const date = usDate(o.event_date);
  if (!date) { dropped.no_date++; continue; }
  if (['snow_avalanche', 'other'].includes(o.landslide_category)) { dropped.not_landslide++; continue; }
  events.push({
    event_id: `glc-${o.event_id}`, date, lat, lng, accuracy_km: acc,
    place: (o.location_description || o.event_title || '').trim().slice(0, 80), state: STATE(o.admin_division_name),
    category: o.landslide_category, trigger: o.landslide_trigger, size: o.landslide_size, fatalities: o.fatality_count || '',
    source: o.source_link || o.source_name,
  });
}
const manual = parseCsv(fs.readFileSync(path.join(DATA, 'manual_events.csv'), 'utf8'))
  .map((m) => ({ ...m, lat: +m.lat, lng: +m.lng, accuracy_km: +m.accuracy_km, category: 'landslide', size: '', fatalities: '' }));

const all = [...events, ...manual].sort((a, b) => a.date.localeCompare(b.date));
writeCsv(path.join(DATA, 'inventory.csv'), all, ['event_id', 'date', 'lat', 'lng', 'accuracy_km', 'place', 'state', 'category', 'trigger', 'size', 'fatalities', 'source']);

const byState = all.reduce((m, e) => ((m[e.state || '?'] = (m[e.state || '?'] || 0) + 1), m), {});
const years = all.map((e) => e.date.slice(0, 4));
console.log(`inventory: ${all.length} landslides (${events.length} NASA GLC + ${manual.length} manual), ${years[0]}–${years[years.length - 1]}`);
console.log('by state:', JSON.stringify(byState));
console.log('dropped from GLC:', JSON.stringify(dropped));
