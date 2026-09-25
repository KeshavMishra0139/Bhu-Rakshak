// One SSE connection per tab. Holds the live location snapshot and fans out escalation / inbox events.
// Reconnects automatically, and re-opens when the signed-in identity (or developer "view as") changes.
// If the stream opens but delivers nothing (some proxies and tunnels buffer SSE), it switches to polling
// /api/risk/poll, which returns the same events filtered the same way.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AlertItem, Controls, Corridor, InboxMessage, LocationSnap, Risk, RiskEvent, Road } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { PANE } from '../lib/viewAs';
import { goToAccessPage } from '../api/client';

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';
type EventMap = {
  risk_escalation: RiskEvent;
  risk_deescalation: RiskEvent;
  inbox_message: InboxMessage;
  inbox_updated: { id: string; location_id: string; acknowledged_at: string };
  alert_published: AlertItem;
  alert_cancelled: { id: string };
  road_updated: Road;
  incident_updated: { id: string; location_id?: string };
  resource_updated: { id: string };
  report_updated: { id: string; location_id: string; status: string };
  citizen_ack: { location_id: string; level: string };
};
type Listener<K extends keyof EventMap> = (payload: EventMap[K]) => void;

type Ctx = {
  status: StreamStatus;
  locations: Record<string, LocationSnap>;
  list: LocationSnap[];
  corridors: Corridor[];
  lastUpdateAt: string | null;
  weatherAt: string | null;
  controls: Controls | null;
  changedAt: Record<string, number>;
  subscribe: <K extends keyof EventMap>(type: K, fn: Listener<K>) => () => void;
};

const StreamContext = createContext<Ctx | null>(null);
const WATCHDOG_MS = 45000;
/** No "hello" from the stream within this time → assume it is being buffered and poll instead. */
const HELLO_TIMEOUT_MS = 8000;
const POLL_MS = 3000;
const CACHE_KEY = 'br.snapshot.v1';
type Cached = { locations: Record<string, LocationSnap>; corridors: Corridor[]; at: string };
const readCache = (): Cached | null => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; } };

export function RiskStreamProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const identity = (me ? `${me.user.id}:${JSON.stringify(me.actor.viewing_as || null)}:${me.user.status}` : 'guest') + (PANE || '');
  const cached = useMemo(readCache, []);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  // Start from the last snapshot so a slow or failed connection never shows a blank screen.
  const [locations, setLocations] = useState<Record<string, LocationSnap>>(() => cached?.locations || {});
  const [corridors, setCorridors] = useState<Corridor[]>(() => cached?.corridors || []);
  const [lastUpdateAt, setLastUpdateAt] = useState<string | null>(() => cached?.at || null);
  const [weatherAt, setWeatherAt] = useState<string | null>(null);
  const [controls, setControls] = useState<Controls | null>(null);
  const [changedAt, setChangedAt] = useState<Record<string, number>>({});
  const listeners = useRef(new Map<string, Set<(p: unknown) => void>>());

  const emit = (type: string, payload: unknown) => listeners.current.get(type)?.forEach((fn) => {
    try { fn(payload); } catch (e) { console.error(e); }
  });

  useEffect(() => {
    let es: EventSource | null = null;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let helloTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let polling = false;
    let pollSeq = -1;
    let closed = false;

    // One handler per event, shared by the stream and the polling fallback.
    const handlers: Record<string, (data: any) => void> = {
      hello: (d: { locations: LocationSnap[]; corridors: Corridor[]; weather_last_success: string | null; controls: Controls | null; server_time: string }) => {
        clearTimeout(helloTimer);
        setLocations(Object.fromEntries(d.locations.map((l) => [l.id, l])));
        setCorridors(d.corridors);
        setWeatherAt(d.weather_last_success);
        setControls(d.controls);
        setLastUpdateAt(d.server_time);
        setStatus('live');
      },
      risk_update: (batch: Risk[]) => {
        setLocations((prev) => {
          const next = { ...prev };
          for (const r of batch) {
            const l = next[r.location_id];
            // The server already trims technical detail for citizens and guests.
            if (l) next[r.location_id] = { ...l, risk: { ...(l.risk || {}), ...r } as Risk };
          }
          return next;
        });
        const now = Date.now();
        setChangedAt((prev) => ({ ...prev, ...Object.fromEntries(batch.map((r) => [r.location_id, now])) }));
        setLastUpdateAt(new Date().toISOString());
      },
      controls: (c: Controls) => setControls(c),
      weather_refreshed: (w: { at: string }) => setWeatherAt(w.at),
      heartbeat: () => { /* keeps the watchdog happy */ },
    };
    for (const ev of ['risk_escalation', 'risk_deescalation', 'inbox_message', 'inbox_updated', 'alert_published', 'alert_cancelled',
      'road_updated', 'incident_updated', 'resource_updated', 'report_updated', 'citizen_ack']) {
      handlers[ev] = (d) => emit(ev, d);
    }
    const handle = (type: string, data: unknown) => {
      try { handlers[type]?.(data); } catch (e) { console.error('live event', type, e); }
    };

    const kick = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => { setStatus('reconnecting'); open(); }, WATCHDOG_MS);
    };

    async function poll() {
      if (closed) return;
      try {
        const res = await fetch(`/api/risk/poll?since=${pollSeq}${PANE ? `&view_as=${PANE}` : ''}`, { credentials: 'include', cache: 'no-store' });
        if (res.status === 401 && (await res.clone().json().catch(() => null))?.error === 'site_locked') { goToAccessPage(); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: { seq: number; hello?: unknown; events: { type: string; data: unknown }[] } = await res.json();
        if (closed) return;
        if (body.hello) handle('hello', body.hello);
        for (const e of body.events) handle(e.type, e.data);
        pollSeq = body.seq;
        setStatus('live');
      } catch {
        setStatus(navigator.onLine ? 'reconnecting' : 'offline');
      }
      pollTimer = setTimeout(poll, POLL_MS);
    }

    function startPolling() {
      if (polling || closed) return;
      polling = true;
      es?.close();
      es = null;
      clearTimeout(watchdog);
      clearTimeout(retry);
      console.info('[live] stream is being buffered by the network; polling instead');
      poll();
    }

    function open() {
      es?.close();
      if (closed || polling) return;
      es = new EventSource(`/api/risk/stream${PANE ? `?view_as=${PANE}` : ''}`);
      clearTimeout(helloTimer);
      helloTimer = setTimeout(startPolling, HELLO_TIMEOUT_MS);
      es.onopen = () => { setStatus('live'); kick(); };
      es.onerror = () => {
        setStatus(navigator.onLine ? 'reconnecting' : 'offline');
        // EventSource retries by itself; if the server closed it for good, retry manually.
        if (es && es.readyState === EventSource.CLOSED) { clearTimeout(retry); retry = setTimeout(open, 4000); }
      };
      for (const type of Object.keys(handlers)) {
        es.addEventListener(type, (ev) => {
          kick();
          try { handle(type, JSON.parse((ev as MessageEvent).data)); } catch (e) { console.error('stream parse', type, e); }
        });
      }
    }

    setStatus('connecting');
    open();
    const onOnline = () => { setStatus('reconnecting'); if (!polling) open(); };
    const onOffline = () => setStatus('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      closed = true;
      clearTimeout(watchdog);
      clearTimeout(retry);
      clearTimeout(helloTimer);
      clearTimeout(pollTimer);
      es?.close();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [identity]);

  const subscribe = useCallback(<K extends keyof EventMap>(type: K, fn: Listener<K>) => {
    const set = listeners.current.get(type) || new Set();
    set.add(fn as (p: unknown) => void);
    listeners.current.set(type, set);
    return () => { set.delete(fn as (p: unknown) => void); };
  }, []);

  // Persist a light snapshot (throttled) for offline fallback.
  useEffect(() => {
    if (!Object.keys(locations).length || status !== 'live') return;
    const id = setTimeout(() => {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ locations, corridors, at: lastUpdateAt || new Date().toISOString() })); } catch { /* quota */ }
    }, 5000);
    return () => clearTimeout(id);
  }, [locations, corridors, lastUpdateAt, status]);

  const list = useMemo(
    () => Object.values(locations).sort((a, b) => (b.risk?.priority ?? 0) - (a.risk?.priority ?? 0)),
    [locations],
  );

  const value = useMemo<Ctx>(() => ({ status, locations, list, corridors, lastUpdateAt, weatherAt, controls, changedAt, subscribe }),
    [status, locations, list, corridors, lastUpdateAt, weatherAt, controls, changedAt, subscribe]);
  return <StreamContext.Provider value={value}>{children}</StreamContext.Provider>;
}

export function useRiskStream() {
  const c = useContext(StreamContext);
  if (!c) throw new Error('useRiskStream outside RiskStreamProvider');
  return c;
}

/** Subscribe to a stream event for the lifetime of the component. */
export function useStreamEvent<K extends keyof EventMap>(type: K, fn: Listener<K>) {
  const { subscribe } = useRiskStream();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => subscribe(type, (p) => ref.current(p)), [subscribe, type]);
}
