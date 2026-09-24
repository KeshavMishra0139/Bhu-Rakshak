import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { q, tx } from '../db/index.js';
import { SERVER_ROOT } from '../config/env.js';
import { requireAuth, requireCap, rateLimit } from '../auth/middleware.js';
import { can } from '../auth/permissions.js';
import { bus } from '../events/bus.js';
import { audit } from '../lib/audit.js';
import { smsProvider, pushProvider } from '../notifications/providers.js';
import { ah, HttpError, newId, nowIso, safeJson } from '../lib/util.js';

const r = Router();
const templates = JSON.parse(fs.readFileSync(path.join(SERVER_ROOT, 'src/data/alert_templates.json'), 'utf8'));
const SEVERITIES = ['moderate', 'high', 'critical'];
const CHANNELS = ['dashboard', 'sms', 'push'];
const fill = (s, p) => s.replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');

export function resolveTarget(type, id) {
  if (type === 'location') {
    const l = q.one('SELECT id, name_en, name_hi, district, corridor_id, road FROM locations WHERE id = :id', { id });
    return l && { type, id, name_en: l.name_en, name_hi: l.name_hi, road: l.road || '', district: l.district, corridor_id: l.corridor_id };
  }
  if (type === 'corridor') {
    const c = q.one('SELECT id, name_en, name_hi FROM corridors WHERE id = :id', { id });
    return c && { type, id, name_en: c.name_en, name_hi: c.name_hi, road: c.name_en.split(' (')[0] };
  }
  if (type === 'district') {
    const d = q.one('SELECT district FROM locations WHERE district = :id LIMIT 1', { id });
    return d && { type, id, name_en: id, name_hi: id, road: '' };
  }
  return null;
}

export function draftAlert({ targetType, targetId, severity, kind = 'warning' }) {
  const t = resolveTarget(targetType, targetId);
  if (!t) throw new HttpError(400, 'invalid_target');
  const key = kind === 'all_clear' ? 'all_clear' : severity;
  const road = t.road || 'the road';
  return {
    target_type: t.type, target_id: t.id, severity, kind,
    title_en: fill(templates.title[key].en, { place: t.name_en }),
    title_hi: fill(templates.title[key].hi, { place: t.name_hi }),
    body_en: fill(templates.body[key].en, { place: t.name_en, road }),
    body_hi: fill(templates.body[key].hi, { place: t.name_hi, road: t.road || 'सड़क' }),
  };
}

function withTarget(a, includeAdmin) {
  const t = resolveTarget(a.target_type, a.target_id) || {};
  const out = {
    ...a, channels: safeJson(a.channels, []), target_name_en: t.name_en, target_name_hi: t.name_hi,
    target_district: t.district || (a.target_type === 'district' ? a.target_id : null), target_corridor: t.corridor_id || (a.target_type === 'corridor' ? a.target_id : null),
  };
  if (includeAdmin) {
    out.deliveries = q.all('SELECT channel, status, detail, at FROM alert_deliveries WHERE alert_id = :id ORDER BY id', { id: a.id });
    out.ack_count = q.one("SELECT count FROM alert_acks WHERE scope_type = 'alert' AND scope_id = :id", { id: a.id })?.count || 0;
  } else {
    delete out.created_by;
  }
  return out;
}

// Public feed (citizens, guests) + full log for authorities.
r.get('/alerts', (req, res) => {
  const full = can(req.actor, 'incidents.view');
  const limit = Math.min(200, Number(req.query.limit) || 60);
  const rows = q.all(`SELECT * FROM alerts ${full ? '' : "WHERE channels LIKE '%dashboard%'"} ORDER BY created_at DESC LIMIT ${limit}`);
  res.json({ alerts: rows.map((a) => withTarget(a, full)) });
});

r.get('/alerts/draft', requireAuth(), requireCap('alerts.dispatch'), (req, res) => {
  const { target_type = 'location', target_id, severity = 'high', kind = 'warning' } = req.query;
  if (!SEVERITIES.includes(severity)) throw new HttpError(400, 'invalid_severity');
  res.json({ draft: draftAlert({ targetType: String(target_type), targetId: String(target_id || ''), severity, kind }) });
});

r.post('/alerts', requireAuth(), requireCap('alerts.dispatch'), ah(async (req, res) => {
  const b = req.body || {};
  const kind = b.kind === 'all_clear' ? 'all_clear' : 'warning';
  const severity = kind === 'all_clear' ? 'low' : b.severity;
  if (kind === 'warning' && !SEVERITIES.includes(severity)) throw new HttpError(400, 'invalid_severity');
  const target = resolveTarget(b.target_type, b.target_id);
  if (!target) throw new HttpError(400, 'invalid_target');
  const channels = (Array.isArray(b.channels) ? b.channels : ['dashboard']).filter((c) => CHANNELS.includes(c));
  if (!channels.includes('dashboard')) channels.unshift('dashboard');
  const txt = (k, max) => String(b[k] || '').trim().slice(0, max);
  for (const k of ['title_en', 'title_hi', 'body_en', 'body_hi']) if (!txt(k, 1000)) throw new HttpError(400, 'alert_text_required');
  const id = newId('alt');
  const now = nowIso();
  tx(() => {
    q.run(`INSERT INTO alerts(id, severity, kind, target_type, target_id, title_en, title_hi, body_en, body_hi, channels, incident_id, inbox_message_id, created_by, created_at)
           VALUES (:id, :sev, :kind, :tt, :tid, :te, :th, :be, :bh, :ch, :inc, :inb, :by, :now)`,
    { id, sev: severity, kind, tt: target.type, tid: target.id, te: txt('title_en', 160), th: txt('title_hi', 160), be: txt('body_en', 1000), bh: txt('body_hi', 1000),
      ch: JSON.stringify(channels), inc: b.incident_id || null, inb: b.inbox_message_id || null, by: req.actor.performedBy, now });
    q.run("INSERT INTO alert_deliveries(alert_id, channel, status, detail, at) VALUES (:id, 'dashboard', 'sent', 'Live feed (SSE) and citizen alert list', :now)", { id, now });
    if (b.incident_id) {
      const inc = q.one('SELECT stage FROM incidents WHERE id = :i', { i: b.incident_id });
      if (inc) {
        q.run('UPDATE incidents SET alert_issued_at = COALESCE(alert_issued_at, :now), updated_at = :now WHERE id = :i', { i: b.incident_id, now });
        if (['detected', 'under_verification', 'verified'].includes(inc.stage) && kind === 'warning') {
          q.run("UPDATE incidents SET stage = 'alert_issued' WHERE id = :i", { i: b.incident_id });
          q.run("INSERT INTO incident_events(incident_id, from_stage, to_stage, note, actor, at) VALUES (:i, :f, 'alert_issued', :n, :a, :now)",
            { i: b.incident_id, f: inc.stage, n: `Alert ${id}`, a: req.actor.performedBy, now });
        }
      }
    }
  });
  for (const ch of channels.filter((c) => c !== 'dashboard')) {
    const provider = ch === 'sms' ? smsProvider : pushProvider;
    const out = await provider.send({ alertId: id, text: b.body_en, title: b.title_en, target });
    q.run('INSERT INTO alert_deliveries(alert_id, channel, status, detail, at) VALUES (:id, :ch, :st, :d, :now)', { id, ch, st: out.status, d: out.detail, now: nowIso() });
  }
  audit(req.actor, kind === 'all_clear' ? 'alert.all_clear' : 'alert.dispatch', 'alert', id, { target: `${target.type}:${target.id}`, severity, channels });
  const alert = withTarget(q.one('SELECT * FROM alerts WHERE id = :id', { id }), true);
  bus.emit('alert_published', withTarget(q.one('SELECT * FROM alerts WHERE id = :id', { id }), false));
  if (b.incident_id) bus.emit('incident_updated', { id: b.incident_id });
  res.status(201).json({ alert });
}));

r.post('/alerts/:id/cancel', requireAuth(), requireCap('alerts.dispatch'), ah(async (req, res) => {
  const a = q.one('SELECT * FROM alerts WHERE id = :id', { id: req.params.id });
  if (!a) throw new HttpError(404, 'not_found');
  q.run('UPDATE alerts SET cancelled_at = COALESCE(cancelled_at, :now) WHERE id = :id', { now: nowIso(), id: a.id });
  audit(req.actor, 'alert.cancel', 'alert', a.id);
  bus.emit('alert_cancelled', { id: a.id });
  res.json({ alert: withTarget(q.one('SELECT * FROM alerts WHERE id = :id', { id: a.id }), true) });
}));

function bumpAck(scopeType, scopeId) {
  q.run(`INSERT INTO alert_acks(scope_type, scope_id, count, updated_at) VALUES (:t, :id, 1, :now)
         ON CONFLICT(scope_type, scope_id) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`, { t: scopeType, id: scopeId, now: nowIso() });
}

// Aggregate "I understand" counts only. No personal data is stored.
r.post('/alerts/:id/ack', rateLimit({ bucket: 'ack', max: 60, windowMs: 10 * 60000 }), (req, res) => {
  if (!q.one('SELECT id FROM alerts WHERE id = :id', { id: req.params.id })) throw new HttpError(404, 'not_found');
  bumpAck('alert', req.params.id);
  res.json({ ok: true });
});

r.post('/risk-ack', rateLimit({ bucket: 'ack', max: 60, windowMs: 10 * 60000 }), (req, res) => {
  const { location_id, level } = req.body || {};
  if (!q.one('SELECT id FROM locations WHERE id = :id', { id: location_id }) || !['high', 'critical'].includes(level)) throw new HttpError(400, 'invalid_target');
  bumpAck('risk_event', `${location_id}:${level}:${nowIso().slice(0, 10)}`);
  bus.emit('citizen_ack', { location_id, level });
  res.json({ ok: true });
});

r.get('/risk-acks', requireAuth(), requireCap('incidents.view'), (_req, res) => {
  const today = nowIso().slice(0, 10);
  const rows = q.all("SELECT scope_id, count FROM alert_acks WHERE scope_type = 'risk_event' AND scope_id LIKE :d", { d: `%:${today}` });
  res.json({ acks: rows.map((x) => { const [location_id, level] = x.scope_id.split(':'); return { location_id, level, count: x.count }; }) });
});

export default r;
