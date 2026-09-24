// live_sim provider: real Open-Meteo features + static susceptibility → configurable baseline engine.
import { PredictionProvider } from './PredictionProvider.js';
import { q } from '../db/index.js';
import { riskConfig } from '../config/shared.js';
import { liveInputsFor } from './liveInputs.js';
import {
  ENGINE_VERSION, normaliseStatic, normaliseDynamic, scoreFrom, levelFromScore, confidenceOf, LEVEL_RANK,
} from './engine.js';
import { round } from '../lib/util.js';

export class LivePredictionProvider extends PredictionProvider {
  constructor() {
    super();
    this.staticCache = new Map();
  }

  get name() { return 'live_sim'; }

  staticFor(locationId) {
    let s = this.staticCache.get(locationId);
    if (!s) {
      const row = q.one(`SELECT l.id, l.corridor_id, l.district, l.field_verified_at, s.* FROM locations l
                         JOIN static_layers s ON s.location_id = l.id WHERE l.id = :id`, { id: locationId });
      if (!row) return null;
      s = { row, norm: normaliseStatic(row) };
      this.staticCache.set(locationId, s);
    }
    return s;
  }

  clearCache() { this.staticCache.clear(); }

  /** Score arbitrary features for this location (used for forecasts and by the model fallback). */
  scoreFeatures(locationId, features) {
    const st = this.staticFor(locationId);
    const dyn = normaliseDynamic(features, st.row.elevation_m);
    return scoreFrom(st.norm, dyn);
  }

  async getRisk(locationId, at = new Date()) {
    const nowMs = at.getTime();
    const st = this.staticFor(locationId);
    if (!st) throw new Error(`unknown location ${locationId}`);
    const inputs = liveInputsFor({ id: locationId, corridor_id: st.row.corridor_id }, nowMs);
    if (!inputs) throw new Error(`no weather inputs for ${locationId}`);

    const now = this.scoreFeatures(locationId, inputs.features);
    const forecast = riskConfig.forecastHorizonsHours.map((h) => {
      const r = this.scoreFeatures(locationId, inputs.forecastFeatures(h));
      return { h, score: round(r.score, 3), level: levelFromScore(r.score) };
    });

    // Time to threshold: first hour in the next 48 h where the next level up is reached.
    const curLevel = levelFromScore(now.score);
    let timeToThreshold = null;
    if (curLevel !== 'critical') {
      for (let h = 1; h <= 48; h++) {
        const r = this.scoreFeatures(locationId, inputs.forecastFeatures(h));
        const lv = levelFromScore(r.score);
        if (LEVEL_RANK[lv] > LEVEL_RANK[curLevel]) { timeToThreshold = { level: lv, hours: h }; break; }
      }
    }

    const ageHours = (nowMs - new Date(inputs.fetchedAt).getTime()) / 3600000;
    const fieldVerified = st.row.field_verified_at && nowMs - new Date(st.row.field_verified_at).getTime() < 24 * 3600000;
    const confidence = confidenceOf({
      source: inputs.source,
      ageHours,
      forecastAgrees: Math.abs(forecast[0].score - now.score) < 0.15,
      fieldVerified,
    });

    return {
      location_id: locationId,
      score: round(now.score, 3),
      level: curLevel,
      confidence,
      drivers: now.drivers,
      trend: null,
      forecast,
      time_to_threshold: timeToThreshold,
      conditions: { ...inputs.features, data_source: inputs.source, data_fetched_at: inputs.fetchedAt },
      model_version: ENGINE_VERSION,
      updated_at: at.toISOString(),
    };
  }
}
