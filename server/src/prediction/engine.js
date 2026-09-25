// Configurable baseline risk engine (used by LivePredictionProvider).
// Pure functions only: no DB, no clock. Every weight and threshold lives here or in /shared/config/risk.json,
// so the behaviour is transparent and easy to replace with the trained model's output.
import { riskConfig, seedData } from '../config/shared.js';
import { clamp, round } from '../lib/util.js';

export const ENGINE_VERSION = 'baseline-0.5';

/** Weights sum to 1.0. Keys match factors.json → drivers. */
export const WEIGHTS = {
  // Triggering (dynamic) — 0.72
  rain_72h: 0.17,
  rain_24h: 0.15,
  rain_intensity: 0.09,
  rain_forecast: 0.04,
  imd_warning: 0.04, // official IMD district warning / nowcast; falls back to rain_forecast when IMD has nothing current
  soil_saturation: 0.19,
  freeze_thaw: 0.04,
  // Susceptibility (static) — 0.28: a steep, weak slope on a dry day stays Low.
  slope: 0.08,
  history: 0.06,
  lithology: 0.04,
  road_cutting: 0.03,
  river_proximity: 0.03,
  fault: 0.02,
  low_vegetation: 0.02,
};

/** Extra score for strong recent shaking (on top of WEIGHTS; 0 when there has been no nearby earthquake). */
export const SEISMIC_WEIGHT = 0.16;

const sat = (v, k) => 1 - Math.exp(-Math.max(0, v || 0) / k);
const lithoWeakness = seedData.staticLayers.lithology_weakness;

/** Normalise static (susceptibility) factors to 0..1. Stable per location, so cache the result. */
export function normaliseStatic(s) {
  const slope = s.slope_deg ?? 0;
  let slopeN;
  if (slope < 15) slopeN = 0;
  else if (slope < 35) slopeN = (slope - 15) / 20;
  else if (slope <= 45) slopeN = 1;
  else slopeN = Math.max(0.6, 1 - (slope - 45) / 30); // very steep rock faces shed less soil
  return {
    slope: slopeN,
    history: sat(s.landslide_history_count, 8),
    lithology: lithoWeakness[s.lithology_class] ?? 0.5,
    road_cutting: s.road_cutting ? ((s.dist_road_m ?? 999) < 50 ? 1 : 0.5) : 0,
    river_proximity: Math.exp(-Math.max(0, s.dist_river_m ?? 5000) / 300),
    fault: Math.exp(-Math.max(0, s.fault_distance_km ?? 20) / 2.5),
    low_vegetation: clamp((0.7 - (s.ndvi ?? 0.5)) / 0.5, 0, 1),
  };
}

/** Normalise dynamic (triggering) features to 0..1. */
export function normaliseDynamic(f, elevation_m = 0) {
  let freezeThaw = 0;
  if (elevation_m >= 2400) {
    freezeThaw = clamp((f.freeze_thaw_cycles || 0) / 6, 0, 1);
    if ((f.snow_depth || 0) > 0.02 && (f.temperature ?? 0) > 2) freezeThaw = clamp(freezeThaw + 0.4, 0, 1);
    if ((f.freezing_level ?? 99999) < elevation_m + 300 && (f.rain_intensity || 0) > 1) freezeThaw = clamp(freezeThaw + 0.2, 0, 1);
  }
  const rainForecast = sat(f.rain_fc_24h, 60);
  return {
    rain_72h: sat(f.rain_72h, 120),
    rain_24h: sat(f.rain_24h, 60),
    rain_intensity: sat(f.rain_intensity, 12),
    rain_forecast: rainForecast,
    imd_warning: f.imd_rain_severity == null ? rainForecast : clamp(f.imd_rain_severity, 0, 1),
    imd_fallback: f.imd_rain_severity == null,
    soil_saturation: clamp(((f.saturation_index ?? 0) - 0.65) / 0.3, 0, 1),
    freeze_thaw: freezeThaw,
    seismic: clamp(f.seismic_shaking || 0, 0, 1),
  };
}

export function levelFromScore(score) {
  const t = riskConfig.thresholds;
  if (score >= t.critical) return 'critical';
  if (score >= t.high) return 'high';
  if (score >= t.moderate) return 'moderate';
  return 'low';
}

export const LEVEL_RANK = { low: 0, moderate: 1, high: 2, critical: 3 };
export const LEVEL_MID = { low: 0.2, moderate: 0.45, high: 0.65, critical: 0.86 };
const lowerBound = (level) => (level === 'low' ? 0 : riskConfig.thresholds[level]);

/**
 * Safety-first hysteresis: escalate as soon as the threshold is crossed, but only
 * downgrade after the score falls `margin` below the threshold AND the level has been held for the dwell time.
 */
export function applyHysteresis(score, prev, { nowMs, force = false } = {}) {
  const raw = levelFromScore(score);
  if (!prev || force) return { level: raw, changed: !prev || raw !== prev.level };
  if (LEVEL_RANK[raw] > LEVEL_RANK[prev.level]) return { level: raw, changed: true };
  if (LEVEL_RANK[raw] === LEVEL_RANK[prev.level]) return { level: prev.level, changed: false };
  const { margin, minDwellSecondsBeforeDowngrade } = riskConfig.hysteresis;
  const heldMs = nowMs - new Date(prev.levelSince).getTime();
  const belowWithMargin = score < lowerBound(prev.level) - margin;
  if (belowWithMargin && heldMs >= minDwellSecondsBeforeDowngrade * 1000) {
    // Step down by the true raw level, but never skip past a level the score is still inside with margin.
    return { level: raw, changed: true };
  }
  return { level: prev.level, changed: false };
}

/** Score one set of normalised inputs → score and drivers. */
export function scoreFrom(staticN, dynamicN) {
  const parts = { ...staticN, ...dynamicN };
  let score = 0;
  const contributions = [];
  for (const [key, w] of Object.entries(WEIGHTS)) {
    const c = w * (parts[key] ?? 0);
    score += c;
    contributions.push({ key, value: c });
  }
  // Interaction: wet ground on a steep, weak slope is worse than the sum of parts.
  const interaction = 0.08 * dynamicN.soil_saturation * staticN.slope * (0.5 + 0.5 * staticN.lithology);
  score += interaction;
  const soil = contributions.find((c) => c.key === 'soil_saturation');
  soil.value += interaction;
  // Recent earthquake shaking (NCS / USGS): additive, so a quiet day scores exactly as before. Steep and wet
  // slopes suffer most: shaking loosens the slope and the next rain finishes the job.
  const seismic = SEISMIC_WEIGHT * (dynamicN.seismic || 0) * (0.4 + 0.6 * staticN.slope) * (1 + 0.5 * dynamicN.soil_saturation);
  score += seismic;
  contributions.push({ key: 'seismic', value: seismic });
  // Without current IMD data the imd_warning share was filled from the model forecast: credit it there.
  if (dynamicN.imd_fallback) {
    const imd = contributions.find((c) => c.key === 'imd_warning');
    contributions.find((c) => c.key === 'rain_forecast').value += imd.value;
    imd.value = 0;
  }
  score = clamp(score, 0, 1);
  const total = contributions.reduce((a, c) => a + c.value, 0) || 1;
  const drivers = contributions
    .filter((c) => c.value > 0.004)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
    .map((c) => ({ key: c.key, contribution: Math.round((c.value / total) * 100) }));
  return { score, drivers };
}

/** Exposure score 0..1 from the exposure row. */
export function exposureScore(e) {
  const pop = clamp(Math.log10(Math.max(1, e.population || 0)) / Math.log10(150000), 0, 1);
  const facilities = e.facilities || [];
  const facN = clamp(
    facilities.filter((f) => f.type === 'hospital').length * 0.35 +
      facilities.filter((f) => f.type === 'shelter').length * 0.2 +
      facilities.filter((f) => ['school', 'phc'].includes(f.type)).length * 0.15,
    0, 1);
  const infra = clamp((e.critical_infra || []).length * 0.5, 0, 1);
  const highway = (e.roads || []).some((r) => /NH-|Highway/i.test(r)) ? 1 : 0.4;
  return round(0.45 * pop + 0.2 * facN + 0.15 * infra + 0.1 * highway + 0.1 * (e.tourist_zone ? 1 : 0), 3);
}

/** Combined priority = hazard × exposure (exposure softened so a critical slope in a small village still ranks). */
export const priorityOf = (score, exposure) => round(score * (0.4 + 0.6 * exposure), 4);

/**
 * Confidence reflects data quality and agreement only — never a claimed accuracy.
 * @param {{source:string, ageHours:number, forecastAgrees:boolean, fieldVerified:boolean}} q
 */
export function confidenceOf(q) {
  let c = 0.8;
  if (q.source !== 'open-meteo') c -= 0.14;
  c -= clamp((q.ageHours || 0) / 6, 0, 1) * 0.12;
  if (!q.forecastAgrees) c -= 0.05;
  if (q.fieldVerified) c += 0.06;
  return round(clamp(c, 0.5, 0.93), 2);
}

export function trendOf(history, nowMs) {
  const { windowMinutes, deltaThreshold } = riskConfig.trend;
  if (!history || history.length < 2) return 'steady';
  const cutoff = nowMs - windowMinutes * 60000;
  const past = history.find((h) => h.t >= cutoff) || history[0];
  const latest = history[history.length - 1];
  const d = latest.score - past.score;
  if (d > deltaThreshold) return 'rising';
  if (d < -deltaThreshold) return 'falling';
  return 'steady';
}
