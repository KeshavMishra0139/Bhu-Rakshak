// Per-sample factor lookups shared by build_dataset.mjs and build_controls.mjs (same URLs → same cache).
import { getCached, distanceKm, addDays, dayDiff, intensityAt } from './lib.mjs';
import { terrainAt } from './dem.mjs';

const TODAY = new Date().toISOString().slice(0, 10);

// ---------- 2. Weather: Open-Meteo (ERA5 reanalysis, or the forecast archive for recent days) ----------
const q = (o) => new URLSearchParams(o).toString();
const DAILY = 'precipitation_sum,snowfall_sum,temperature_2m_max,temperature_2m_min';

export async function weather(s) {
  const start = addDays(s.date, -30);
  // Prefer the ERA5 reanalysis for every date (one consistent product); only while ERA5 hasn't published the last
  // few days yet, fall back to the forecast archive (whose soil layers are 3–9 / 9–27 / 27–81 cm instead).
  const ERA5_SOIL = ['soil_moisture_0_to_7cm', 'soil_moisture_7_to_28cm', 'soil_moisture_28_to_100cm'];
  const FC_SOIL = ['soil_moisture_3_to_9cm', 'soil_moisture_9_to_27cm', 'soil_moisture_27_to_81cm'];
  const params = (soil) => q({ latitude: s.lat, longitude: s.lng, start_date: start, end_date: s.date, daily: DAILY, hourly: ['precipitation', ...soil].join(','), timezone: 'Asia/Kolkata' });
  const complete = (x) => x.daily?.precipitation_sum?.at(-1) != null && x.hourly?.[ERA5_SOIL[0]]?.at(-1) != null;
  let j = await getCached(`https://archive-api.open-meteo.com/v1/archive?${params(ERA5_SOIL)}`, { cacheIf: complete });
  let soil = ERA5_SOIL;
  let recent = false;
  if (!complete(j)) {
    j = await getCached(`https://api.open-meteo.com/v1/forecast?${params(FC_SOIL)}`);
    soil = FC_SOIL;
    recent = true;
  }
  const p = j.daily.precipitation_sum; // index 30 = event day (d0), 29 = day before
  const n = p.length - 1;
  const sum = (from, to) => p.slice(n - to, n - from + 1).reduce((a, b) => a + (b ?? 0), 0);
  let api = 0;
  for (let i = 0; i < n; i++) api = api * 0.9 + (p[i] ?? 0); // antecedent precipitation index up to the day before
  const hp = j.hourly.precipitation;
  const dayBefore = (k) => { const v = j.hourly[k].slice(-48, -24).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  return {
    rain_d0: p[n], rain_d1: p[n - 1], rain_3d: sum(0, 2), rain_7d: sum(0, 6), rain_15d: sum(0, 14), rain_30d: sum(0, 29),
    api_30d: api, max_1h_48h: Math.max(...hp.slice(-48).map((x) => x ?? 0)),
    rainy_days_7d: p.slice(n - 6, n + 1).filter((x) => (x ?? 0) >= 1).length,
    sm_top: dayBefore(soil[0]), sm_mid: dayBefore(soil[1]), sm_deep: dayBefore(soil[2]),
    tmax_d0: j.daily.temperature_2m_max[n], tmin_d0: j.daily.temperature_2m_min[n],
    snowfall_7d: j.daily.snowfall_sum.slice(n - 6, n + 1).reduce((a, b) => a + (b ?? 0), 0),
    weather_grid_lat: j.latitude, weather_grid_lng: j.longitude, weather_source: recent ? 'open-meteo-forecast-archive' : 'open-meteo-era5',
  };
}

// ---------- 3. Second rain source: NASA POWER (daily, MERRA-2 based) ----------
export async function power(s) {
  const start = addDays(s.date, -30).replace(/-/g, '');
  const end = s.date.replace(/-/g, '');
  const j = await getCached(`https://power.larc.nasa.gov/api/temporal/daily/point?${q({ parameters: 'PRECTOTCORR', community: 'AG', longitude: s.lng, latitude: s.lat, start, end, format: 'JSON' })}`);
  const v = Object.values(j.properties.parameter.PRECTOTCORR).map((x) => (x < 0 ? null : x));
  const n = v.length - 1;
  const sum = (k) => { const w = v.slice(n - k + 1); return w.some((x) => x == null) ? null : w.reduce((a, b) => a + b, 0); };
  return { power_rain_d0: v[n], power_rain_3d: sum(3), power_rain_7d: sum(7), power_rain_30d: sum(30) };
}

// ---------- 4. Terrain: AWS Terrain Tiles (mainly NASA SRTM ~30 m in this region), see dem.mjs ----------
export async function terrain(p) {
  const t = await terrainAt(p.lat, p.lng);
  const flat = t.slope < 2; // flat ground has no meaningful facing direction
  return {
    elev_m: t.elev, slope_deg: t.slope, aspect_deg: flat ? null : t.aspect,
    northness: flat ? 0 : Math.cos((t.aspect * Math.PI) / 180), eastness: flat ? 0 : Math.sin((t.aspect * Math.PI) / 180),
    curvature: t.curvature, relief_1km: t.relief,
  };
}

// ---------- 5. Earthquakes: USGS catalogue, one regional query ----------
export async function quakeCatalogue() {
  const j = await getCached(`https://earthquake.usgs.gov/fdsnws/event/1/query?${q({ format: 'geojson', minlatitude: 18, maxlatitude: 33, minlongitude: 83, maxlongitude: 102, minmagnitude: 4, starttime: '2006-11-01', endtime: TODAY, orderby: 'time-asc', limit: 20000 })}`, { timeoutMs: 180000 });
  return j.features.map((f) => ({ time: f.properties.time, mag: f.properties.mag, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], depth_km: f.geometry.coordinates[2] }));
}
export function shaking(s, quakes) {
  const end = Date.parse(s.date + 'T23:59:59+05:30');
  const start = end - 30 * 86400000;
  let maxMmi = 0; let count = 0; let maxMag = 0;
  for (const e of quakes) {
    if (e.time < start || e.time > end) continue;
    const km = distanceKm(e, s);
    if (km <= 300) { count++; maxMag = Math.max(maxMag, e.mag); }
    maxMmi = Math.max(maxMmi, intensityAt(e, s));
  }
  return { quake_max_mmi_30d: maxMmi || 1, quake_count_300km_30d: count, quake_max_mag_300km_30d: maxMag || null };
}


export const COLUMNS = [
  'label', 'sample_type', 'event_id', 'date', 'month', 'lat', 'lng', 'accuracy_km', 'state',
  'rain_d0', 'rain_d1', 'rain_3d', 'rain_7d', 'rain_15d', 'rain_30d', 'api_30d', 'max_1h_48h', 'rainy_days_7d',
  'power_rain_d0', 'power_rain_3d', 'power_rain_7d', 'power_rain_30d',
  'sm_top', 'sm_mid', 'sm_deep', 'tmax_d0', 'tmin_d0', 'snowfall_7d',
  'elev_m', 'slope_deg', 'aspect_deg', 'northness', 'eastness', 'curvature', 'relief_1km',
  'quake_max_mmi_30d', 'quake_count_300km_30d', 'quake_max_mag_300km_30d',
  'weather_source', 'weather_grid_lat', 'weather_grid_lng',
];

export const round3 = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
