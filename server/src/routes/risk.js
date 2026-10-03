import { Router } from 'express';
import { q } from '../db/index.js';
import { addClient, controlsForActor, currentSeq, eventsSince } from '../events/sse.js';
import { snapshot, corridors } from './locations.js';
import { hourIndex, istHourOfDay } from '../ingest/features.js';
import { rampFor } from '../prediction/liveInputs.js';
import { riskConfig } from '../config/shared.js';
import { getControls } from '../prediction/controls.js';
import { ah, HttpError, round, safeJson } from '../lib/util.js';
import { riskRowToPublic } from '../prediction/liveLoop.js';
import { riskForActor } from './locations.js';

const r = Router();

/** The stream's opening snapshot (also sent to polling clients that need a fresh start). */
function helloFor(actor) {
  const feed = q.one("SELECT status, last_success FROM feed_status WHERE feed = 'open_meteo'");
  return {
    server_time: new Date().toISOString(),
    corridors: corridors(),
    locations: snapshot(actor),
    weather_last_success: feed?.last_success || null,
    controls: controlsForActor(actor),
  };
}

r.get('/risk/stream', (req, res) => addClient(req, res, helloFor(req.actor)));

/**
 * Polling fallback for networks that buffer the stream: events after ?since=<seq>, filtered like the stream.
 * Without a usable `since` (first call, or events dropped from the buffer) it also returns the snapshot.
 */
r.get('/risk/poll', (req, res) => {
  const since = Number(req.query.since);
  const out = Number.isInteger(since) && since >= 0
    ? eventsSince(since, req.actor, req.user?.id || null)
    : { seq: currentSeq(), complete: false, events: [] };
  res.set('Cache-Control', 'no-store').json(out.complete ? out : { ...out, hello: helloFor(req.actor) });
});

/** Forecast risk + hourly rain for the next 48 h, and a "best time to travel" daylight window. */
r.get('/risk/forecast', ah(async (req, res) => {
  const id = String(req.query.location_id || '');
  const loc = q.one('SELECT id, corridor_id FROM locations WHERE id = :id', { id });
  if (!loc) throw new HttpError(404, 'location_not_found');
  const w = q.one('SELECT hourly_json, fetched_at FROM weather_cache WHERE location_id = :id', { id });
  const riskRow = q.one('SELECT * FROM risk_state WHERE location_id = :id', { id });
  const hourly = safeJson(w?.hourly_json, null);
  const now = Date.now();
  const rain = [];
  if (hourly) {
    const i = hourIndex(hourly, now);
    const ramp = getControls().scenario.active || rampFor(loc.corridor_id) > 0 ? Math.pow(rampFor(loc.corridor_id), 1.7) : 0;
    for (let h = 1; h <= 48; h++) {
      const k = Math.min(hourly.time.length - 1, i + h);
      const persist = Math.max(0, 1 - h / 36);
      const mm = (hourly.precipitation?.[k] || 0) + ramp * riskConfig.scenario.maxRainIntensityBoostMm * 0.5 * persist;
      rain.push({ time: new Date(now + h * 3600000).toISOString(), hour_ist: Math.floor(istHourOfDay(now + h * 3600000)), rain_mm: round(mm, 1) });
    }
  }
  // Best 3-hour daylight window (06:00–18:00 IST) in the next 36 h with the least rain.
  let best = null;
  for (let s = 0; s + 3 <= Math.min(36, rain.length); s++) {
    const win = rain.slice(s, s + 3);
    if (!win.every((x) => x.hour_ist >= 6 && x.hour_ist < 18)) continue;
    const total = win.reduce((a, x) => a + x.rain_mm, 0);
    if (!best || total < best.rain_mm) best = { start: win[0].time, end: new Date(new Date(win[2].time).getTime() + 3600000).toISOString(), rain_mm: round(total, 1) };
  }
  const risk = riskForActor(riskRowToPublic(riskRow), req.actor);
  res.json({ location_id: id, horizons: risk?.forecast || [], time_to_threshold: risk?.time_to_threshold || null, hourly_rain: rain, best_travel: best, data_fetched_at: w?.fetched_at || null });
}));

export default r;
