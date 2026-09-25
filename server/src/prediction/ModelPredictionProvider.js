// STUB (clearly labelled): adapter for the trained ML model service.
// Contract: POST {MODEL_URL}/predict with { location_id, at, features, static } → the Risk schema documented
// in PredictionProvider.js. Until the service exists, any failure falls back to the live_sim provider
// (feed_status.prediction is marked 'degraded' so the System health panel shows it).
import { PredictionProvider } from './PredictionProvider.js';
import { q } from '../db/index.js';
import { liveInputsFor } from './liveInputs.js';
import { imdSummary } from '../ingest/imd.js';
import { seismicSummary } from '../ingest/seismic.js';
import { nowIso } from '../lib/util.js';

export class ModelPredictionProvider extends PredictionProvider {
  constructor({ url, fallback, timeoutMs = 4000 }) {
    super();
    this.url = url.replace(/\/$/, '');
    this.fallback = fallback;
    this.timeoutMs = timeoutMs;
  }

  get name() { return 'model'; }

  setStatus(status, message) {
    q.run(`INSERT INTO feed_status(feed, status, last_success, last_attempt, message) VALUES ('prediction', :s, :ls, :now, :m)
           ON CONFLICT(feed) DO UPDATE SET status = excluded.status, last_attempt = excluded.last_attempt, message = excluded.message,
           last_success = COALESCE(excluded.last_success, feed_status.last_success)`,
      { s: status, ls: status === 'ok' ? nowIso() : null, now: nowIso(), m: message });
  }

  async getRisk(locationId, at = new Date()) {
    const st = this.fallback.staticFor(locationId);
    const inputs = liveInputsFor({ id: locationId, corridor_id: st.row.corridor_id, district: st.row.district, lat: st.row.lat, lng: st.row.lng }, at.getTime());
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      const res = await fetch(`${this.url}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_id: locationId, at: at.toISOString(), features: inputs?.features, static: st.row }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const out = await res.json();
      if (typeof out.score !== 'number' || !out.level) throw new Error('bad schema');
      this.setStatus('ok', 'model service');
      return { conditions: { ...(inputs?.features || {}), imd: imdSummary(st.row.district, at.getTime()), seismic: seismicSummary(st.row, at.getTime()) }, trend: null, ...out, location_id: locationId, updated_at: out.updated_at || at.toISOString() };
    } catch (e) {
      this.setStatus('degraded', `Model unavailable (${e.message}); using baseline engine`);
      return this.fallback.getRisk(locationId, at);
    }
  }
}
