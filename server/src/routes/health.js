import { Router } from 'express';
import { q } from '../db/index.js';
import { can } from '../auth/permissions.js';
import { activeUserCount, activeClientCount } from '../events/sse.js';
import { riskService } from '../prediction/liveLoop.js';

const r = Router();

const istMidnightIso = () => {
  const off = 5.5 * 3600000;
  const d = new Date(Date.now() + off);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - off).toISOString();
};

r.get('/health', (req, res) => {
  const base = { ok: true, time: new Date().toISOString(), live_updated_at: riskService.lastTickAt };
  if (!can(req.actor, 'health.read')) return res.json(base);
  const feeds = Object.fromEntries(q.all('SELECT * FROM feed_status').map((f) => [f.feed, f]));
  const since = istMidnightIso();
  const alertsToday = q.one("SELECT COUNT(*) AS n FROM alerts WHERE kind = 'warning' AND created_at >= :since", { since }).n;
  const d2a = q.one(`SELECT AVG((julianday(alert_issued_at) - julianday(detected_at)) * 1440) AS m
                     FROM incidents WHERE alert_issued_at IS NOT NULL AND detected_at >= :since7`,
  { since7: new Date(Date.now() - 7 * 86400000).toISOString() }).m;
  const rep = q.one(`SELECT COUNT(*) AS total, SUM(CASE WHEN status IN ('verified','resolved') THEN 1 ELSE 0 END) AS verified,
                            SUM(CASE WHEN status != 'submitted' THEN 1 ELSE 0 END) AS reviewed FROM reports`);
  res.json({
    ...base,
    feeds: {
      weather: { status: feeds.open_meteo?.status, last_success: feeds.open_meteo?.last_success, message: feeds.open_meteo?.message },
      imd: { status: feeds.imd?.status || 'not_configured', last_success: feeds.imd?.last_success, message: feeds.imd?.message },
      prediction: { status: feeds.prediction?.status || 'ok', last_update: riskService.lastTickAt, message: feeds.prediction?.status === 'degraded' ? feeds.prediction.message : null },
      seismic: { status: feeds.seismic?.status || 'not_connected', last_success: feeds.seismic?.last_success, message: feeds.seismic?.message },
      sensors: { status: feeds.sensors?.status || 'not_connected', last_success: feeds.sensors?.last_success, message: feeds.sensors?.message },
    },
    active_users: activeUserCount(),
    live_connections: activeClientCount(),
    alerts_sent_today: alertsToday,
    avg_detection_to_alert_min: d2a == null ? null : Math.round(d2a),
    reports: { total: rep.total || 0, verified_pct: rep.total ? Math.round(((rep.verified || 0) / rep.total) * 100) : null },
  });
});

export default r;
