// Derives the Section 0A triggering features from Open-Meteo hourly arrays.
// Also produces a deterministic "fallback climatology" series when the feed has never been reached,
// so the app never shows a blank screen on first run without internet.
import { riskConfig } from '../config/shared.js';
import { clamp, round } from '../lib/util.js';

const IST_OFFSET_MS = 5.5 * 3600 * 1000;

/** "2026-09-24T10:00" for the IST hour containing `ms`. Open-Meteo returns this format with timezone=Asia/Kolkata. */
export function istHourKey(ms) {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 13) + ':00';
}
export const istHourOfDay = (ms) => new Date(ms + IST_OFFSET_MS).getUTCHours() + new Date(ms + IST_OFFSET_MS).getUTCMinutes() / 60;

export function hourIndex(hourly, ms) {
  const key = istHourKey(ms);
  const i = hourly.time.indexOf(key);
  if (i >= 0) return i;
  // Outside the cached window: clamp to the nearest end so we degrade gracefully.
  return key < hourly.time[0] ? 0 : hourly.time.length - 1;
}

const sumRange = (arr, from, to) => {
  let s = 0;
  if (!arr) return 0;
  for (let k = Math.max(0, from); k <= Math.min(arr.length - 1, to); k++) s += arr[k] || 0;
  return s;
};
const maxRange = (arr, from, to) => {
  let m = 0;
  if (!arr) return 0;
  for (let k = Math.max(0, from); k <= Math.min(arr.length - 1, to); k++) m = Math.max(m, arr[k] || 0);
  return m;
};
const at = (arr, i) => (arr && arr[i] != null ? arr[i] : null);

const SM_LAYERS = [
  ['soil_moisture_0_to_1cm', 'sm_0_1', 0.1],
  ['soil_moisture_1_to_3cm', 'sm_1_3', 0.15],
  ['soil_moisture_3_to_9cm', 'sm_3_9', 0.25],
  ['soil_moisture_9_to_27cm', 'sm_9_27', 0.3],
  ['soil_moisture_27_to_81cm', 'sm_27_81', 0.2],
];
const POROSITY = 0.5; // m³/m³, typical for Himalayan colluvium. Replace with a soil map value later.

/** Feature vector at hourly index i. */
export function featuresAt(hourly, i) {
  const p = hourly.precipitation || hourly.rain;
  const f = {
    rain_intensity: round(at(p, i) ?? 0, 2),
    rain_3h: round(sumRange(p, i - 2, i), 1),
    rain_24h: round(sumRange(p, i - 23, i), 1),
    rain_72h: round(sumRange(p, i - 71, i), 1),
    rain_7d: round(sumRange(p, i - 167, i), 1),
    rain_fc_24h: round(sumRange(p, i + 1, i + 24), 1),
    rain_fc_48h: round(sumRange(p, i + 1, i + 48), 1),
    max_hourly_3h: round(maxRange(p, i - 2, i), 1),
    temperature: at(hourly.temperature_2m, i),
    soil_temperature: at(hourly.soil_temperature_0cm, i),
    freezing_level: at(hourly.freezing_level_height, i),
    snowfall_24h: round(sumRange(hourly.snowfall, i - 23, i), 1),
    snow_depth: at(hourly.snow_depth, i),
    weather_code: at(hourly.weather_code, i),
    humidity: at(hourly.relative_humidity_2m, i),
    cloud_cover: at(hourly.cloud_cover, i),
  };
  let wsum = 0;
  let vsum = 0;
  for (const [src, key, w] of SM_LAYERS) {
    const v = at(hourly[src], i);
    f[key] = v == null ? null : round(v, 3);
    if (v != null) { vsum += v * w; wsum += w; }
  }
  f.saturation_index = wsum ? round(clamp(vsum / wsum / POROSITY, 0, 1), 3) : 0.5;
  // Freeze–thaw: count 0 °C crossings over the last 72 h.
  let cycles = 0;
  const T = hourly.temperature_2m || [];
  for (let k = Math.max(1, i - 71); k <= i && k < T.length; k++) {
    if (T[k - 1] != null && T[k] != null && Math.sign(T[k - 1]) !== Math.sign(T[k])) cycles++;
  }
  f.freeze_thaw_cycles = Math.floor(cycles / 2);
  f.cloudburst = f.max_hourly_3h >= riskConfig.cloudburstThresholdMmPerHour ? 1 : 0;
  f.very_heavy_rain = f.max_hourly_3h >= riskConfig.veryHeavyHourlyRainMm ? 1 : 0;
  return f;
}

// ---------- Fallback climatology (offline first run) ----------
function seeded(str) {
  let h = 2166136261;
  for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}

/**
 * Late-monsoon-like synthetic series (7 past days + 3 forecast days), deterministic per location and day.
 * Labelled source='fallback_climatology' everywhere it is stored.
 */
export function fallbackHourly(location, elevation_m, nowMs) {
  const rnd = seeded(`${location.id}:${istHourKey(nowMs).slice(0, 10)}`);
  const startMs = nowMs - 7 * 86400000;
  const hours = 10 * 24;
  const wetness = location.district === 'North Sikkim' ? 1.25 : location.district === 'Darjeeling' ? 1.1 : 1.0;
  const out = {
    time: [], precipitation: [], rain: [], snowfall: [], snow_depth: [], temperature_2m: [], relative_humidity_2m: [],
    cloud_cover: [], freezing_level_height: [], weather_code: [], soil_temperature_0cm: [],
    soil_moisture_0_to_1cm: [], soil_moisture_1_to_3cm: [], soil_moisture_3_to_9cm: [], soil_moisture_9_to_27cm: [], soil_moisture_27_to_81cm: [],
  };
  let sm = 0.33 + rnd() * 0.05;
  const baseT = 24 - elevation_m * 0.0062;
  for (let k = 0; k < hours; k++) {
    const ms = startMs + k * 3600000;
    const hod = istHourOfDay(ms);
    const dayWet = 0.4 + 0.9 * Math.abs(Math.sin((k / 24 + rnd() * 0.3) * 1.3));
    const diurnal = 0.5 + 0.5 * Math.sin(((hod - 11) / 24) * 2 * Math.PI);
    const shower = rnd() < 0.28 * dayWet ? rnd() * 3.2 * wetness * (0.6 + diurnal) : 0;
    const temp = baseT + 4 * Math.sin(((hod - 9) / 24) * 2 * Math.PI) - shower * 0.3;
    sm = clamp(sm + shower * 0.004 - 0.0022, 0.24, 0.42);
    out.time.push(istHourKey(ms));
    out.precipitation.push(round(shower, 1));
    out.rain.push(round(temp > 0.5 ? shower : 0, 1));
    out.snowfall.push(round(temp <= 0.5 ? shower * 0.7 : 0, 2));
    out.snow_depth.push(elevation_m > 3500 ? 0.05 : 0);
    out.temperature_2m.push(round(temp, 1));
    out.relative_humidity_2m.push(Math.round(clamp(78 + shower * 5 + rnd() * 8, 50, 100)));
    out.cloud_cover.push(Math.round(clamp(55 + shower * 12 + rnd() * 25, 0, 100)));
    out.freezing_level_height.push(Math.round(4700 + rnd() * 250));
    out.weather_code.push(shower > 2.5 ? 63 : shower > 0.3 ? 61 : 3);
    out.soil_temperature_0cm.push(round(temp + 1, 1));
    out.soil_moisture_0_to_1cm.push(round(sm + 0.02, 3));
    out.soil_moisture_1_to_3cm.push(round(sm + 0.015, 3));
    out.soil_moisture_3_to_9cm.push(round(sm, 3));
    out.soil_moisture_9_to_27cm.push(round(sm - 0.01, 3));
    out.soil_moisture_27_to_81cm.push(round(sm - 0.02, 3));
  }
  return out;
}
