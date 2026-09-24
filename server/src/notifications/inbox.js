// Authority Inbox: the system writes one routed message per escalation into High/Critical,
// a de-escalation message when it eases, and re-escalates unacknowledged Critical messages.
import { q, tx } from '../db/index.js';
import { riskConfig } from '../config/shared.js';
import { bus } from '../events/bus.js';
import { newId, nowIso, safeJson } from '../lib/util.js';
import { audit, SYSTEM_ACTOR } from '../lib/audit.js';
import { LEVEL_RANK } from '../prediction/engine.js';

const ALL_AUTHORITY = ['district_officer', 'sdma', 'police', 'bro', 'rescue'];

/** Which sub-roles receive a message about this location (server-side routing rules). */
export function routingFor(locationId) {
  const e = q.one('SELECT population, roads_json, facilities_json, critical_infra_json FROM exposure WHERE location_id = :id', { id: locationId }) || {};
  const roads = safeJson(e.roads_json, []);
  const facilities = safeJson(e.facilities_json, []);
  const roadRelated = roads.length > 0;
  const exposed = (e.population || 0) >= 1000 || facilities.length > 0;
  const roles = ['district_officer', 'sdma'];
  const tags = [];
  if (roadRelated) { roles.push('police', 'bro'); tags.push('road', 'slope'); }
  if (exposed) { roles.push('rescue'); tags.push('population'); }
  return { roles, tags, exposure: { population: e.population || 0, roads, facilities, critical_infra: safeJson(e.critical_infra_json, []) } };
}

/**
 * Visibility for an effective user (see auth/middleware.js → req.actor).
 * District Officer: own district. SDMA: everything. Police/BRO/Rescue: own district, filtered by routing.
 * A district of 'All' means state-wide scope. Admin/developer (not viewing-as) see everything.
 */
export function visibilitySql(actor) {
  if (actor.role === 'admin' || actor.role === 'developer') return { where: '1 = 1', params: {} };
  if (actor.role !== 'authority' || !actor.subRole) return { where: '0 = 1', params: {} };
  const stateWide = actor.subRole === 'sdma' || !actor.district || actor.district === 'All';
  return {
    where: `EXISTS (SELECT 1 FROM json_each(m.target_roles) r WHERE r.value = :sub_role)` + (stateWide ? '' : ' AND m.target_district = :district'),
    params: stateWide ? { sub_role: actor.subRole } : { sub_role: actor.subRole, district: actor.district },
  };
}

export function canSee(actor, msg) {
  if (!actor) return false;
  if (actor.role === 'admin' || actor.role === 'developer') return true;
  if (actor.role !== 'authority' || !actor.subRole) return false;
  const roles = Array.isArray(msg.target_roles) ? msg.target_roles : safeJson(msg.target_roles, []);
  if (!roles.includes(actor.subRole)) return false;
  const stateWide = actor.subRole === 'sdma' || !actor.district || actor.district === 'All';
  return stateWide || msg.target_district === actor.district;
}

export function toPublic(m, userId) {
  const read = userId ? !!q.one('SELECT 1 AS x FROM inbox_reads WHERE message_id = :m AND user_id = :u', { m: m.id, u: userId }) : false;
  return {
    id: m.id, location_id: m.location_id, level: m.level, type: m.type, title_key: m.title_key,
    params: safeJson(m.body_params, {}), priority: m.priority, escalated: !!m.escalated, parent_id: m.parent_id,
    created_at: m.created_at, read: read, acknowledged_by: m.acknowledged_by, acknowledged_by_name: m.ack_name || null,
    acknowledged_at: m.acknowledged_at, incident_id: m.incident_id,
    target_roles: safeJson(m.target_roles, []), target_district: m.target_district, tags: safeJson(m.tags, []),
  };
}

function createMessage({ ev, type, parentId = null }) {
  const loc = q.one('SELECT id, name_en, name_hi, district, corridor_id FROM locations WHERE id = :id', { id: ev.location_id });
  const route = routingFor(loc.id);
  const level = type === 'deescalation' ? ev.to : ev.to || ev.level;
  const sops = LEVEL_RANK[level] >= 1
    ? q.all('SELECT key, text_en, text_hi FROM sops WHERE level = :level ORDER BY ord', { level })
    : [];
  const params = {
    location_en: loc.name_en, location_hi: loc.name_hi, district: loc.district, corridor_id: loc.corridor_id,
    from: ev.from, to: level, score: ev.score, confidence: ev.confidence, trend: ev.trend,
    drivers: (ev.drivers || []).slice(0, 3), forecast: ev.forecast || [],
    exposure: {
      population: route.exposure.population, roads: route.exposure.roads,
      facilities: route.exposure.facilities.map((f) => f.name), critical_infra: route.exposure.critical_infra,
    },
    sops: sops.map((s) => ({ key: s.key, en: s.text_en, hi: s.text_hi })),
  };
  const msg = {
    id: newId('inb'), location_id: loc.id, level, type, title_key: `inbox.title.${type}`,
    body_params: JSON.stringify(params), priority: ev.priority ?? 0, escalated: type === 're_escalation' ? 1 : 0,
    parent_id: parentId, created_at: nowIso(), target_roles: JSON.stringify(route.roles),
    target_district: loc.district, tags: JSON.stringify(route.tags),
  };
  q.run(`INSERT INTO inbox_messages(id, location_id, level, type, title_key, body_params, priority, escalated, parent_id, created_at,
           target_roles, target_district, tags)
         VALUES (:id, :location_id, :level, :type, :title_key, :body_params, :priority, :escalated, :parent_id, :created_at,
           :target_roles, :target_district, :tags)`, msg);
  audit(SYSTEM_ACTOR, `inbox.${type}`, 'inbox_message', msg.id, { location_id: loc.id, level });
  bus.emit('inbox_message', msg);
  return msg;
}

export function onEscalation(ev) { return createMessage({ ev, type: 'escalation' }); }
export function onDeescalation(ev) { return createMessage({ ev, type: 'deescalation' }); }

/** Re-send unacknowledged Critical messages as ESCALATED after the configured time, while still Critical. */
export function checkEscalations(nowMs = Date.now()) {
  const cutoff = new Date(nowMs - riskConfig.inbox.criticalUnackEscalationMinutes * 60000).toISOString();
  const stale = q.all(`SELECT m.* FROM inbox_messages m
                       JOIN risk_state r ON r.location_id = m.location_id AND r.level = 'critical'
                       WHERE m.level = 'critical' AND m.type IN ('escalation','re_escalation') AND m.acknowledged_at IS NULL
                         AND m.created_at < :cutoff
                         AND NOT EXISTS (SELECT 1 FROM inbox_messages c WHERE c.parent_id = m.id)`, { cutoff });
  const created = [];
  for (const m of stale) {
    const p = safeJson(m.body_params, {});
    created.push(createMessage({
      ev: { location_id: m.location_id, from: p.from, to: 'critical', score: p.score, confidence: p.confidence, trend: p.trend, drivers: p.drivers, forecast: p.forecast, priority: m.priority },
      type: 're_escalation', parentId: m.id,
    }));
  }
  return created;
}

/** Acknowledge a message; also closes the unacknowledged chain for the same location and level. */
export function acknowledge(messageId, actor) {
  const m = q.one('SELECT * FROM inbox_messages WHERE id = :id', { id: messageId });
  if (!m) return null;
  const at = nowIso();
  tx(() => {
    q.run(`UPDATE inbox_messages SET acknowledged_by = :uid, acknowledged_at = :at
           WHERE acknowledged_at IS NULL AND location_id = :loc AND level = :level AND type IN ('escalation','re_escalation')`,
    { uid: actor.userId, at, loc: m.location_id, level: m.level });
    q.run('UPDATE inbox_messages SET acknowledged_by = COALESCE(acknowledged_by, :uid), acknowledged_at = COALESCE(acknowledged_at, :at) WHERE id = :id',
      { uid: actor.userId, at, id: messageId });
    markRead([messageId], actor.userId);
  });
  audit(actor, 'inbox.acknowledge', 'inbox_message', messageId, { location_id: m.location_id, level: m.level });
  bus.emit('inbox_updated', { id: messageId, location_id: m.location_id, acknowledged_at: at });
  return q.one('SELECT * FROM inbox_messages WHERE id = :id', { id: messageId });
}

export function markRead(ids, userId) {
  if (!userId) return;
  const at = nowIso();
  for (const id of ids) {
    q.run('INSERT OR IGNORE INTO inbox_reads(message_id, user_id, read_at) VALUES (:m, :u, :at)', { m: id, u: userId, at });
    q.run('UPDATE inbox_messages SET read_at = COALESCE(read_at, :at) WHERE id = :m', { m: id, at });
  }
}

let timer;
export function startInbox() {
  bus.on('risk_escalation', onEscalation);
  bus.on('risk_deescalation', onDeescalation);
  timer = setInterval(() => { try { checkEscalations(); } catch (e) { console.error('[inbox] escalation check failed', e); } },
    riskConfig.inbox.escalationCheckSeconds * 1000);
}
export function stopInbox() {
  bus.off('risk_escalation', onEscalation);
  bus.off('risk_deescalation', onDeescalation);
  clearInterval(timer);
}

export { ALL_AUTHORITY };
