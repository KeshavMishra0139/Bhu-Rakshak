// Live event fan-out. One Server-Sent Events stream per browser tab; each client sees only what its actor may see.
// The same events are kept in a short buffer for clients that cannot hold a stream open (some proxies and
// tunnels buffer SSE); they fetch them with GET /api/risk/poll, filtered by the same rules.
import { bus } from './bus.js';
import { can } from '../auth/permissions.js';
import { canSee, toPublic } from '../notifications/inbox.js';
import { getControls } from '../prediction/controls.js';
import { riskForActor } from '../routes/locations.js';

const clients = new Set();

function send(c, event, data) {
  try {
    c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    clients.delete(c);
  }
}

export function addClient(req, res, hello) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const c = { res, actor: req.actor || null, userId: req.user?.id || null };
  clients.add(c);
  send(c, 'hello', hello);
  res.on('close', () => clients.delete(c)); // not req: on Node ≥16 req 'close' fires once the body is read
}

export const activeClientCount = () => clients.size;
export const activeUserCount = () => new Set([...clients].filter((c) => c.userId).map((c) => c.userId)).size;

const controlsView = (c) => ({ scenario: c.scenario, paused: c.paused, speed: c.speed, forced: c.forced });
const everyone = (_c, d) => d;
const authorities = (c, d) => (can(c.actor, 'incidents.view') ? d : undefined);

/**
 * Bus event → [outgoing event name, view(client, data)]. A view returns what that client may see,
 * or undefined to skip it. `client` is { actor, userId }.
 */
const RULES = {
  // Same trimming as the REST API: people without risk.details get plain fields only.
  risk_update: ['risk_update', (c, batch) => (can(c.actor, 'risk.details') ? batch : batch.map((r) => riskForActor(r, null)))],
  risk_escalation: ['risk_escalation', everyone],
  risk_deescalation: ['risk_deescalation', everyone],
  inbox_message: ['inbox_message', (c, m) => (canSee(c.actor, m) ? toPublic(m, c.userId) : undefined)],
  inbox_updated: ['inbox_updated', (c, u) => (can(c.actor, 'inbox.read') ? u : undefined)],
  controls_changed: ['controls', (c, ctl) => (can(c.actor, 'scenario.control') || c.actor?.isDeveloper ? controlsView(ctl) : undefined)],
  weather_refreshed: ['weather_refreshed', everyone],
  // Public operational events: alerts citizens see and road status.
  alert_published: ['alert_published', everyone],
  alert_cancelled: ['alert_cancelled', everyone],
  road_updated: ['road_updated', everyone],
  // Authority-only events.
  incident_updated: ['incident_updated', authorities],
  resource_updated: ['resource_updated', authorities],
  citizen_ack: ['citizen_ack', authorities],
  // Report status: authorities, plus the citizen who filed it.
  report_updated: ['report_updated', (c, d) => (can(c.actor, 'incidents.view') || (c.userId && c.userId === d.user_id)
    ? { id: d.id, location_id: d.location_id, status: d.status } : undefined)],
};

// Recent events for polling clients: [{ seq, at, type, data }], bounded by count and age.
const RECENT_MAX = 500;
const RECENT_MS = 10 * 60000;
let recent = [];
let seq = 0;
export const currentSeq = () => seq;

function remember(type, data) {
  const now = Date.now();
  recent.push({ seq: ++seq, at: now, type, data });
  while (recent.length > RECENT_MAX || now - recent[0].at > RECENT_MS) recent.shift();
}

/**
 * Events after `since` that this actor may see. `complete` is false when events were dropped from the buffer
 * since then, so the client should reload its snapshot.
 */
export function eventsSince(since, actor, userId) {
  const client = { actor, userId };
  const oldest = recent[0]?.seq ?? seq + 1;
  // A `since` ahead of us means the server restarted (sequence reset): the client must resync too.
  const complete = since >= oldest - 1 && since <= seq;
  const events = [];
  for (const e of recent) {
    if (e.seq <= since) continue;
    const [name, view] = RULES[e.type];
    const data = view(client, e.data);
    if (data !== undefined) events.push({ seq: e.seq, type: name, data });
  }
  return { seq, complete, events };
}

export function wireSse() {
  for (const [type, [name, view]] of Object.entries(RULES)) {
    bus.on(type, (d) => {
      remember(type, d);
      clients.forEach((c) => {
        const data = view(c, d);
        if (data !== undefined) send(c, name, data);
      });
    });
  }
  setInterval(() => clients.forEach((c) => {
    send(c, 'heartbeat', { t: new Date().toISOString() });
  }), 15000).unref();
}

export const controlsForActor = (actor) => (can(actor, 'scenario.control') || actor?.isDeveloper ? controlsView(getControls()) : null);
