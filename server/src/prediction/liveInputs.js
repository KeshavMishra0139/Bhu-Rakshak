// Builds the live feature vector for a location: real cached Open-Meteo features, plus the Storm scenario overlay
// when an officer runs one. Optional simulated variation (mean-reverting drift, diurnal cycle, rain-driven soil
// wetting, occasional short convective cells) is OFF by default (risk.json live.simulatedVariation): it made the
// demo map feel alive but produced warnings that were not backed by real data.
// Used by both providers, so the model provider sees the same inputs the simulator does.
import { q } from '../db/index.js';
import { riskConfig } from '../config/shared.js';
import { featuresAt, hourIndex, istHourOfDay } from '../ingest/features.js';
import { clamp, round, safeJson } from '../lib/util.js';
import { getControls } from './controls.js';
import { imdSeverity } from '../ingest/imd.js';
import { seismicSeverity } from '../ingest/seismic.js';

const cache = new Map();     // locationId -> { fetchedAt, hourly, source }
const drift = new Map();     // locationId -> { rainMul, satOff, wetting, lastMs }
const ramps = new Map();     // corridorId -> 0..1 storm ramp
let episode = null;          // { locationId, until, boost }
let nextEpisodeAt = 0;
let lastRampMs = 0;

/** Made-up variation on top of real data, for demos only. */
export const simulationOn = () => riskConfig.live.simulatedVariation === true;
const NEUTRAL = Object.freeze({ rainMul: 1, satOff: 0, wetting: 0 });

// Gaussian via Box-Muller, bounded.
const gauss = () => {
  const u = 1 - Math.random();
  const v = Math.random();
  return clamp(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v), -3, 3);
};
const randBetween = ([a, b]) => a + Math.random() * (b - a);

function weatherFor(locationId) {
  const row = q.one('SELECT fetched_at, hourly_json, source FROM weather_cache WHERE location_id = :id', { id: locationId });
  if (!row) return null;
  const hit = cache.get(locationId);
  if (hit && hit.fetchedAt === row.fetched_at) return hit;
  const entry = { fetchedAt: row.fetched_at, source: row.source, hourly: safeJson(row.hourly_json, null) };
  cache.set(locationId, entry);
  return entry;
}

export const invalidateWeatherCache = () => cache.clear();

/** Advance corridor storm ramps (called once per service tick). */
export function advanceRamps(nowMs) {
  const c = getControls();
  const dt = lastRampMs ? ((nowMs - lastRampMs) / 1000) * c.speed : 0;
  lastRampMs = nowMs;
  const step = dt / riskConfig.scenario.rampSeconds;
  const corridors = q.all('SELECT id FROM corridors');
  for (const { id } of corridors) {
    const target = c.scenario.active && c.scenario.corridors.includes(id) ? 1 : 0;
    const cur = ramps.get(id) || 0;
    ramps.set(id, target > cur ? Math.min(1, cur + step) : Math.max(0, cur - step * 0.6));
  }
  // Occasional short convective cell somewhere wet (makes the map feel alive without a storm).
  if (!simulationOn()) episode = null;
  else if (!c.paused && nowMs >= nextEpisodeAt) {
    const every = riskConfig.live.episodeEveryMinutes || [8, 15];
    const dur = riskConfig.live.episodeDurationMinutes || [4, 8];
    if (nextEpisodeAt) {
      const locs = q.all('SELECT id FROM locations');
      const pick = locs[Math.floor(Math.random() * locs.length)];
      episode = { locationId: pick.id, until: nowMs + (randBetween(dur) * 60000) / c.speed, boost: 5 + Math.random() * 9 };
    }
    nextEpisodeAt = nowMs + (randBetween(every) * 60000) / c.speed;
  }
  if (episode && nowMs > episode.until) episode = null;
}

export const rampFor = (corridorId) => ramps.get(corridorId) || 0;

/** Apply live variation + scenario to a base feature vector. `horizonH` > 0 is used for forecasts. */
function overlay(base, loc, nowMs, d, horizonH = 0) {
  const c = getControls();
  const f = { ...base };
  const hod = istHourOfDay(nowMs + horizonH * 3600000);
  const diurnal = simulationOn() ? 1 + 0.18 * Math.sin(((hod - 11) / 24) * 2 * Math.PI) : 1; // afternoon/evening peak
  const decay = horizonH ? Math.exp(-horizonH / 8) : 1; // live noise matters less far ahead
  const rainMul = 1 + (d.rainMul * diurnal - 1) * decay;
  f.rain_intensity = round(f.rain_intensity * rainMul, 2);
  f.rain_3h = round(f.rain_3h * (1 + (rainMul - 1) * 0.6), 1);
  f.rain_24h = round(f.rain_24h * (1 + (rainMul - 1) * 0.25), 1);
  f.saturation_index = clamp(f.saturation_index + (d.satOff + d.wetting) * decay, 0, 1);

  if (!horizonH && episode && episode.locationId === loc.id) {
    f.rain_intensity = round(f.rain_intensity + episode.boost, 2);
    f.rain_3h = round(f.rain_3h + episode.boost * 1.5, 1);
    f.rain_24h = round(f.rain_24h + episode.boost * 2, 1);
    f.saturation_index = clamp(f.saturation_index + 0.04, 0, 1);
  }

  const r = rampFor(loc.corridor_id);
  if (r > 0) {
    const s = riskConfig.scenario;
    // Ease-in so judges see Moderate → High → Critical unfold over ~2 minutes rather than jump.
    const k = Math.pow(r, 1.7) * (c.scenario.active ? c.scenario.intensity : 1);
    // Storm persists into the near forecast, then eases.
    const persist = horizonH ? Math.max(0, 1 - horizonH / 36) : 1;
    f.rain_intensity = round(f.rain_intensity + k * s.maxRainIntensityBoostMm * persist, 2);
    f.rain_3h = round(f.rain_3h + k * s.maxRainIntensityBoostMm * 2.4 * persist, 1);
    f.rain_24h = round(f.rain_24h + k * s.maxRain24hBoostMm * (horizonH ? Math.max(0.3, persist) : 1), 1);
    f.rain_72h = round(f.rain_72h + k * s.maxRain72hBoostMm, 1);
    f.rain_fc_24h = round(f.rain_fc_24h + k * s.maxRain24hBoostMm * 0.6 * persist, 1);
    f.rain_fc_48h = round(f.rain_fc_48h + k * s.maxRain24hBoostMm * 0.8 * persist, 1);
    f.saturation_index = clamp(f.saturation_index + k * s.maxSaturationBoost, 0, 1);
    f.max_hourly_3h = Math.max(f.max_hourly_3h, f.rain_intensity);
  }
  f.cloudburst = f.max_hourly_3h >= riskConfig.cloudburstThresholdMmPerHour || f.rain_intensity >= riskConfig.cloudburstThresholdMmPerHour ? 1 : 0;
  f.very_heavy_rain = Math.max(f.max_hourly_3h, f.rain_intensity) >= riskConfig.veryHeavyHourlyRainMm ? 1 : 0;
  f.saturation_index = round(f.saturation_index, 3);
  return f;
}

/** Advance this location's drift state by elapsed time. */
function stepDrift(locationId, nowMs, baseIntensity) {
  const c = getControls();
  let d = drift.get(locationId);
  if (!d) { d = { rainMul: 1 + gauss() * 0.08, satOff: gauss() * 0.01, wetting: 0, lastMs: nowMs }; drift.set(locationId, d); }
  const dt = clamp(((nowMs - d.lastMs) / 1000) * c.speed, 0, 120);
  d.lastMs = nowMs;
  if (dt > 0 && !c.paused) {
    const n = dt / 20; // normalise to ~20 s ticks
    d.rainMul = clamp(d.rainMul + 0.15 * (1 - d.rainMul) * n + 0.1 * Math.sqrt(n) * gauss(), 0.5, 1.8);
    d.satOff = clamp(d.satOff + 0.1 * (0 - d.satOff) * n + 0.006 * Math.sqrt(n) * gauss(), -0.05, 0.05);
    // Rain-driven wetting: heavy current rain slowly raises saturation; it drains back otherwise.
    d.wetting = clamp(d.wetting * Math.pow(0.985, n) + Math.max(0, baseIntensity * d.rainMul - 2) * 0.0006 * n, 0, 0.08);
  }
  return d;
}

/**
 * Current live inputs for a location.
 * @returns {{ features, hourly, index, source, fetchedAt, forecastFeatures:(h:number)=>object }}
 */
export function liveInputsFor(loc, nowMs) {
  const w = weatherFor(loc.id);
  if (!w?.hourly) return null;
  const i = hourIndex(w.hourly, nowMs);
  const base = featuresAt(w.hourly, i);
  const d = simulationOn() ? stepDrift(loc.id, nowMs, base.rain_intensity) : NEUTRAL;
  // Official IMD rain severity for the district (null when IMD has nothing current → engine uses the model forecast).
  // Plus recent earthquake shaking at the slope (NCS / USGS), fading over the following days.
  const withImd = (f, h) => ({
    ...f,
    imd_rain_severity: loc.district ? imdSeverity(loc.district, nowMs + h * 3600000) : null,
    seismic_shaking: seismicSeverity(loc, nowMs + h * 3600000),
  });
  const features = withImd(overlay(base, loc, nowMs, d, 0), 0);
  const lastIdx = w.hourly.time.length - 1;
  return {
    features,
    source: w.source,
    fetchedAt: w.fetchedAt,
    forecastFeatures: (h) => withImd(overlay(featuresAt(w.hourly, Math.min(lastIdx, i + h)), loc, nowMs, d, h), h),
  };
}

export function resetLiveInputs() {
  drift.clear();
  ramps.clear();
  episode = null;
  nextEpisodeAt = 0;
  lastRampMs = 0;
}
