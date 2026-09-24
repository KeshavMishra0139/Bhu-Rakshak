// Server-Sent Events fan-out. One stream per browser tab; each client sees only what its actor may see.
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

export function wireSse() {
  bus.on('risk_update', (batch) => {
    // Same trimming as the REST API: people without risk.details get plain fields only.
    const trimmed = batch.map((r) => riskForActor(r, null));
    clients.forEach((c) => send(c, 'risk_update', can(c.actor, 'risk.details') ? batch : trimmed));
  });
  bus.on('risk_escalation', (e) => clients.forEach((c) => send(c, 'risk_escalation', e)));
  bus.on('risk_deescalation', (e) => clients.forEach((c) => send(c, 'risk_deescalation', e)));
  bus.on('inbox_message', (m) => clients.forEach((c) => {
    if (canSee(c.actor, m)) send(c, 'inbox_message', toPublic(m, c.userId));
  }));
  bus.on('inbox_updated', (u) => clients.forEach((c) => { if (can(c.actor, 'inbox.read')) send(c, 'inbox_updated', u); }));
  bus.on('controls_changed', (ctl) => clients.forEach((c) => {
    if (can(c.actor, 'scenario.control') || c.actor?.isDeveloper) send(c, 'controls', controlsView(ctl));
  }));
  bus.on('weather_refreshed', (w) => clients.forEach((c) => send(c, 'weather_refreshed', w)));
  // Public operational events: alerts citizens see and road status.
  for (const ev of ['alert_published', 'alert_cancelled', 'road_updated']) bus.on(ev, (d) => clients.forEach((c) => send(c, ev, d)));
  // Authority-only events.
  for (const ev of ['incident_updated', 'resource_updated', 'citizen_ack']) {
    bus.on(ev, (d) => clients.forEach((c) => { if (can(c.actor, 'incidents.view')) send(c, ev, d); }));
  }
  // Report status: authorities, plus the citizen who filed it.
  bus.on('report_updated', (d) => clients.forEach((c) => {
    if (can(c.actor, 'incidents.view') || (c.userId && c.userId === d.user_id)) send(c, 'report_updated', { id: d.id, location_id: d.location_id, status: d.status });
  }));
  setInterval(() => clients.forEach((c) => {
    send(c, 'heartbeat', { t: new Date().toISOString() });
  }), 15000).unref();
}

export const controlsForActor = (actor) => (can(actor, 'scenario.control') || actor?.isDeveloper ? controlsView(getControls()) : null);
