// RiskService: runs the live loop for every monitored location.
// provider.getRisk() → forced-level override → hysteresis → trend → priority → persist → events.
// Emits `risk_update` (batched, every second when something changed) and `risk_escalation` /
// `risk_deescalation` ONLY when the smoothed level crosses into / out of High or Critical.
import { q, tx } from '../db/index.js';
import { riskConfig } from '../config/shared.js';
import { bus } from '../events/bus.js';
import { getProvider } from './PredictionProvider.js';
import { getControls } from './controls.js';
import { advanceRamps, invalidateWeatherCache } from './liveInputs.js';
import { applyHysteresis, trendOf, priorityOf, LEVEL_RANK, LEVEL_MID } from './engine.js';
import { round, safeJson } from '../lib/util.js';

const ALERTING = new Set(['high', 'critical']);

export class RiskService {
  constructor() {
    this.state = new Map();     // locationId -> { level, levelSince, score, ... }
    this.history = new Map();   // locationId -> [{ t, score }] (last 60 min, in memory)
    this.nextDue = new Map();
    this.timer = null;
    this.pending = [];
    this.busy = false;
    this.lastTickAt = null;
    this.locations = [];
    this.exposure = new Map();
  }

  loadStatic() {
    this.locations = q.all('SELECT id, name_en, name_hi, district, corridor_id, lat, lng, road FROM locations ORDER BY id');
    this.exposure = new Map(q.all('SELECT location_id, exposure_score FROM exposure').map((r) => [r.location_id, r.exposure_score]));
  }

  async init() {
    this.provider = await getProvider();
    this.loadStatic();
    const since = new Date(Date.now() - 60 * 60000).toISOString();
    for (const r of q.all('SELECT * FROM risk_state')) {
      this.state.set(r.location_id, { level: r.level, levelSince: r.level_since, score: r.score });
    }
    for (const h of q.all('SELECT location_id, score, at FROM risk_history WHERE at >= :since ORDER BY at', { since })) {
      if (!this.history.has(h.location_id)) this.history.set(h.location_id, []);
      this.history.get(h.location_id).push({ t: new Date(h.at).getTime(), score: h.score });
    }
    // Compute everything once so the first page load is never empty.
    await this.computeMany(this.locations.map((l) => l.id), new Date(), { emitEvents: false });
    this.flush();
    this.onControls = (c) => {
      // Forced levels take effect immediately; everything else ramps naturally.
      for (const id of Object.keys(c.forced || {})) this.nextDue.set(id, 0);
      for (const id of this.state.keys()) if (!(c.forced || {})[id] && this.state.get(id)?.forced) this.nextDue.set(id, 0);
    };
    this.onWeather = () => invalidateWeatherCache();
    bus.on('controls_changed', this.onControls);
    bus.on('weather_refreshed', this.onWeather);
  }

  schedule(id, nowMs) {
    const { tickMinSeconds, tickMaxSeconds } = riskConfig.live;
    const speed = getControls().speed || 1;
    const s = tickMinSeconds + Math.random() * (tickMaxSeconds - tickMinSeconds);
    this.nextDue.set(id, nowMs + (s * 1000) / speed);
  }

  start() {
    if (this.timer) return;
    for (const l of this.locations) this.schedule(l.id, Date.now());
    this.timer = setInterval(() => this.tick().catch((e) => console.error('[risk] tick failed', e)), 1000);
    this.pruneTimer = setInterval(() => this.prune(), 60 * 60000);
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.pruneTimer);
    this.timer = null;
    bus.off('controls_changed', this.onControls);
    bus.off('weather_refreshed', this.onWeather);
  }

  async tick(nowMs = Date.now()) {
    if (this.busy) return;
    const controls = getControls();
    advanceRamps(nowMs);
    if (controls.paused) return;
    const due = this.locations.filter((l) => (this.nextDue.get(l.id) ?? 0) <= nowMs).map((l) => l.id);
    if (!due.length) return;
    this.busy = true;
    try {
      await this.computeMany(due, new Date(nowMs), { emitEvents: true });
      due.forEach((id) => this.schedule(id, nowMs));
      this.flush();
    } finally {
      this.busy = false;
    }
  }

  async computeMany(ids, at, opts) {
    const results = [];
    for (const id of ids) {
      try {
        results.push(await this.computeOne(id, at, opts));
      } catch (e) {
        if (process.env.NODE_ENV !== 'test') console.warn(`[risk] ${id}: ${e.message}`);
      }
    }
    this.lastTickAt = at.toISOString();
    return results;
  }

  async computeOne(id, at, { emitEvents }) {
    const nowMs = at.getTime();
    const risk = await this.provider.getRisk(id, at);
    const controls = getControls();
    const forcedLevel = controls.forced?.[id];
    const prev = this.state.get(id);
    let score = risk.score;
    if (forcedLevel) score = round(LEVEL_MID[forcedLevel] + (Math.random() - 0.5) * 0.02, 3);
    const releasingForce = !forcedLevel && prev?.forced;
    const { level, changed } = applyHysteresis(score, prev, { nowMs, force: !!forcedLevel || releasingForce });
    const levelSince = changed || !prev ? at.toISOString() : prev.levelSince;

    const hist = this.history.get(id) || [];
    hist.push({ t: nowMs, score });
    while (hist.length && hist[0].t < nowMs - 60 * 60000) hist.shift();
    this.history.set(id, hist);
    const trend = risk.trend || trendOf(hist, nowMs);
    const exposure = this.exposure.get(id) ?? 0;
    const priority = priorityOf(score, exposure);

    const rec = {
      location_id: id,
      score,
      level,
      confidence: risk.confidence,
      drivers: risk.drivers,
      trend,
      forecast: risk.forecast,
      time_to_threshold: risk.time_to_threshold,
      priority,
      exposure_score: exposure,
      conditions: risk.conditions,
      model_version: risk.model_version,
      level_since: levelSince,
      updated_at: risk.updated_at,
    };
    this.state.set(id, { level, levelSince, score, forced: !!forcedLevel });
    this.pending.push(rec);

    if (emitEvents && prev && prev.level !== level) {
      const loc = this.locations.find((l) => l.id === id);
      const payload = {
        location_id: id, name_en: loc.name_en, name_hi: loc.name_hi, district: loc.district, corridor_id: loc.corridor_id,
        from: prev.level, to: level, score, confidence: risk.confidence, drivers: risk.drivers, trend,
        forecast: risk.forecast, priority, at: at.toISOString(),
      };
      const up = LEVEL_RANK[level] > LEVEL_RANK[prev.level];
      if (up && ALERTING.has(level)) bus.emit('risk_escalation', payload);
      else if (!up && ALERTING.has(prev.level)) bus.emit('risk_deescalation', payload);
      bus.emit('risk_level_changed', payload);
    }
    return rec;
  }

  /** Persist and broadcast pending updates. */
  flush() {
    if (!this.pending.length) return;
    const batch = this.pending;
    this.pending = [];
    tx(() => {
      for (const r of batch) {
        q.run(`INSERT INTO risk_state(location_id, score, level, confidence, drivers_json, trend, forecast_json, time_to_threshold_json,
                 priority, conditions_json, model_version, level_since, updated_at)
               VALUES (:id, :score, :level, :conf, :drivers, :trend, :forecast, :ttt, :priority, :cond, :mv, :since, :at)
               ON CONFLICT(location_id) DO UPDATE SET score = excluded.score, level = excluded.level, confidence = excluded.confidence,
                 drivers_json = excluded.drivers_json, trend = excluded.trend, forecast_json = excluded.forecast_json,
                 time_to_threshold_json = excluded.time_to_threshold_json, priority = excluded.priority,
                 conditions_json = excluded.conditions_json, model_version = excluded.model_version,
                 level_since = excluded.level_since, updated_at = excluded.updated_at`,
        {
          id: r.location_id, score: r.score, level: r.level, conf: r.confidence, drivers: JSON.stringify(r.drivers),
          trend: r.trend, forecast: JSON.stringify(r.forecast), ttt: JSON.stringify(r.time_to_threshold),
          priority: r.priority, cond: JSON.stringify(r.conditions), mv: r.model_version, since: r.level_since, at: r.updated_at,
        });
        q.run('INSERT INTO risk_history(location_id, score, level, at) VALUES (:id, :score, :level, :at)',
          { id: r.location_id, score: r.score, level: r.level, at: r.updated_at });
      }
    });
    bus.emit('risk_update', batch.map(publicRisk));
  }

  prune() {
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    q.run('DELETE FROM risk_history WHERE at < :cutoff', { cutoff });
  }

  /** Full reset (dev "Reset demo data"). */
  resetMemory() {
    this.state.clear();
    this.history.clear();
    this.nextDue.clear();
    this.provider?.clearCache?.();
    this.loadStatic();
  }
}

/** Shape sent to browsers (conditions trimmed to the keys the UI uses). */
export function publicRisk(r) {
  return {
    location_id: r.location_id,
    score: r.score,
    level: r.level,
    confidence: r.confidence,
    drivers: r.drivers,
    trend: r.trend,
    forecast: r.forecast,
    time_to_threshold: r.time_to_threshold,
    priority: r.priority,
    exposure_score: r.exposure_score,
    conditions: r.conditions,
    model_version: r.model_version,
    level_since: r.level_since,
    updated_at: r.updated_at,
  };
}

export function riskRowToPublic(row) {
  if (!row) return null;
  return publicRisk({
    ...row,
    drivers: safeJson(row.drivers_json, []),
    forecast: safeJson(row.forecast_json, []),
    time_to_threshold: safeJson(row.time_to_threshold_json, null),
    conditions: safeJson(row.conditions_json, {}),
  });
}

export const riskService = new RiskService();
