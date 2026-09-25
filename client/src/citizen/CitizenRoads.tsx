import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Clock, Route, Bus, Truck, Navigation, Shuffle } from 'lucide-react';
import { api, errorKey } from '../api/client';
import type { Road } from '../api/types';
import { useRiskStream, useStreamEvent } from '../live/RiskStreamProvider';
import { dateTimeIST } from '../lib/format';
import { RoadBadge, citizenRoadState } from './RoadBadge';
import { diversionPlaces, googleDirectionsUrl } from '../lib/directions';

const MiniMap = lazy(() => import('../components/MiniMap'));

// Diversion towns → coordinates from the regional place search, so Google Maps routes through the right places
// (a bare name like "Gorubathan, India" is not always recognised). Cached for the session; falls back to the name.
type Stop = { lat: number; lng: number } | string;
const viaCache = new Map<string, Stop>();
function useViaStops(names: string[], enabled: boolean): Stop[] {
  const key = names.join('|');
  const [, bump] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      for (const n of names) {
        if (viaCache.has(n)) continue;
        try {
          const d = await api.get<{ results: { lat: number; lng: number }[] }>(`/map/geocode?q=${encodeURIComponent(n)}`);
          viaCache.set(n, d.results[0] ? { lat: d.results[0].lat, lng: d.results[0].lng } : `${n}, India`);
        } catch { viaCache.set(n, `${n}, India`); }
        if (!cancelled) bump((x) => x + 1);
      }
    })();
    return () => { cancelled = true; };
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return names.map((n) => viaCache.get(n) || `${n}, India`);
}

/** Google Maps buttons for one road: the road itself, and the officers' diversion when one is given ("Via A – B"). */
function RoadDirections({ road, stops, state }: { road: Road; stops: { lat: number; lng: number }[]; state: ReturnType<typeof citizenRoadState> }) {
  const { t } = useTranslation();
  const via = diversionPlaces(road.diversion_en);
  const viaStops = useViaStops(via, via.length > 0);
  if (stops.length < 2) return null;
  const origin = stops[0];
  const destination = stops[stops.length - 1];
  const routeUrl = googleDirectionsUrl({ origin, destination, waypoints: stops.slice(1, -1) });
  const altUrl = via.length ? googleDirectionsUrl({ origin, destination, waypoints: viaStops }) : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {altUrl && (
          <a href={altUrl} target="_blank" rel="noopener noreferrer" className={state === 'open' ? 'btn-secondary' : 'btn-primary'}>
            <Shuffle size={18} aria-hidden />{t('roads.gmaps_alt')}<span className="sr-only"> ({t('roads.gmaps_opens')})</span>
          </a>
        )}
        <a href={routeUrl} target="_blank" rel="noopener noreferrer" className={altUrl && state !== 'open' ? 'btn-secondary' : 'btn-primary'}>
          <Navigation size={18} aria-hidden />{t('roads.gmaps_route')}<span className="sr-only"> ({t('roads.gmaps_opens')})</span>
        </a>
      </div>
      <p className="text-sm text-muted">{state === 'avoid' && !altUrl ? t('roads.gmaps_no_alt') : t('roads.gmaps_note')}</p>
    </div>
  );
}
const ORDER = { avoid: 0, caution: 1, open: 2 } as const;

export default function CitizenRoads() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { locations } = useRiskStream();
  const [roads, setRoads] = useState<Road[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => { api.get<{ roads: Road[] }>('/roads').then((d) => setRoads(d.roads)).catch((e) => setErr(errorKey(e))); }, []);
  useStreamEvent('road_updated', (rd) => setRoads((prev) => prev?.map((x) => (x.id === rd.id ? rd : x)) || prev));

  const sorted = [...(roads || [])].sort((a, b) => ORDER[citizenRoadState(a.status)] - ORDER[citizenRoadState(b.status)]);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[1.8rem] font-bold">{t('citizen.roads_title')}</h1>
        <p className="text-muted">{t('citizen.roads_intro')}</p>
      </div>
      {err && <p className="field-error" role="alert">{t(err)}</p>}
      {!roads && !err && <div className="space-y-2">{[0, 1, 2].map((k) => <div key={k} className="h-16 card animate-pulse" />)}</div>}
      <ul className="grid gap-3 md:grid-cols-2 items-start">
        {sorted.map((r) => {
          const expanded = open === r.id;
          const line = r.path.map((id) => locations[id]).filter(Boolean).map((l) => [l.lat, l.lng] as [number, number]);
          const diversion = lang === 'hi' ? r.diversion_hi : r.diversion_en;
          const stops = r.path.map((id) => locations[id]).filter(Boolean);
          return (
            <li key={r.id} className="card">
              <button type="button" className="w-full p-4 flex items-center gap-3 text-left min-h-[64px]" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : r.id)}>
                <Route size={22} className="text-muted shrink-0" aria-hidden />
                <span className="flex-1 font-semibold text-[1.05rem]">{lang === 'hi' ? r.name_hi : r.name_en}</span>
                <RoadBadge status={r.status} />
                <ChevronDown size={18} aria-hidden className={`shrink-0 ${expanded ? 'rotate-180' : ''}`} />
              </button>
              {expanded && (
                <div className="px-4 pb-4 space-y-3">
                  {line.length > 1 && (
                    <Suspense fallback={<div className="h-[200px] rounded-card bg-surface-2 animate-pulse" />}>
                      <MiniMap center={line[Math.floor(line.length / 2)]} zoom={10} line={line} height={200} label={t('roads.route')}
                        lineColor={citizenRoadState(r.status) === 'avoid' ? '#C62828' : citizenRoadState(r.status) === 'caution' ? '#C99A12' : '#2F8F4E'} />
                    </Suspense>
                  )}
                  {r.eta_clear_hours != null && citizenRoadState(r.status) !== 'open' && (
                    <p className="inline-flex items-center gap-2 font-semibold"><Clock size={18} aria-hidden />{t('roads.eta', { count: r.eta_clear_hours })}</p>
                  )}
                  {diversion && <p><span className="font-semibold">{t('roads.diversion')}: </span>{diversion}</p>}
                  <RoadDirections road={r} stops={stops} state={citizenRoadState(r.status)} />
                  {r.tourist_advisory && <p className="inline-flex items-center gap-2 mr-4"><Bus size={18} aria-hidden />{t('roads.tourists_note')}</p>}
                  {r.heavy_vehicle_advisory && <p className="inline-flex items-center gap-2"><Truck size={18} aria-hidden />{t('roads.heavy_note')}</p>}
                  <p className="label-mono">{t('common.updated', { time: dateTimeIST(r.updated_at, lang) })}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
