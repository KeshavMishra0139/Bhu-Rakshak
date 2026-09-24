import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Clock, Route, Bus, Truck } from 'lucide-react';
import { api, errorKey } from '../api/client';
import type { Road } from '../api/types';
import { useRiskStream, useStreamEvent } from '../live/RiskStreamProvider';
import { dateTimeIST } from '../lib/format';
import { RoadBadge, citizenRoadState } from './RoadBadge';

const MiniMap = lazy(() => import('../components/MiniMap'));
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
      <ul className="grid gap-3 md:grid-cols-2">
        {sorted.map((r) => {
          const expanded = open === r.id;
          const line = r.path.map((id) => locations[id]).filter(Boolean).map((l) => [l.lat, l.lng] as [number, number]);
          const diversion = lang === 'hi' ? r.diversion_hi : r.diversion_en;
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
