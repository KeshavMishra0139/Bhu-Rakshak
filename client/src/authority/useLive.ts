import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorKey } from '../api/client';
import { useRiskStream } from '../live/RiskStreamProvider';

type StreamEv = 'alert_published' | 'alert_cancelled' | 'road_updated' | 'incident_updated' | 'resource_updated' | 'report_updated' | 'inbox_message' | 'inbox_updated' | 'citizen_ack' | 'weather_refreshed';

/** GET `path`, and refetch (debounced) whenever one of `events` arrives on the live stream. */
export function useLive<T>(path: string | null, events: StreamEv[]) {
  const { subscribe } = useRiskStream();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const load = useCallback(async () => {
    if (!path) return;
    try { setData(await api.get<T>(path)); setError(null); } catch (e) { setError(errorKey(e)); }
  }, [path]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const offs = events.map((ev) => subscribe(ev, () => { clearTimeout(timer.current); timer.current = setTimeout(load, 400); }));
    return () => { offs.forEach((o) => o()); clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, load, events.join()]);
  return { data, error, reload: load, setData };
}
