// Authority map: the team's corridor watch console (Google map + live risk stations rail),
// with the location drawer and forecast horizon on top.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPinned, CloudRain, CloudLightning, AlertTriangle, Layers, PersonStanding, Map as MapIcon, ExternalLink, Loader2 } from 'lucide-react';
import type { AlertItem, Level, LocationSnap, Report, Resource, Road } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { useRiskStream } from '../../live/RiskStreamProvider';
import { useLive } from '../useLive';
import { useAuthority } from '../AuthorityContext';
import { WatchMap, levelAt, type LayerKey } from './WatchMap';
import { DetailDrawer } from './DetailDrawer';
import { InPersonController, RADII, type StreetStatus, type ViewTarget } from './InPersonView';
import { GoogleMapsFrame, useGoogleConfig } from '../../lib/googleMaps';
import { LEVELS, riskConfig } from '../../lib/risk';
import { placeName } from '../../lib/format';

// Colours from the team's watch map, plus a deeper red for Critical (the portal has three levels).
const DOT: Record<Level, string> = { low: 'bg-[#3f8c70]', moderate: 'bg-[#d9983d]', high: 'bg-[#cf624f]', critical: 'bg-[#9e2a2b]' };
const VALUE: Record<Level, string> = { low: 'text-[#9dd2a6]', moderate: 'text-[#f4c993]', high: 'text-[#f1846d]', critical: 'text-[#ff7a7a]' };
const PILL: Record<Level, string> = {
  low: 'bg-[#2d6143] text-[#b4e1b9]', moderate: 'bg-[#6b512a] text-[#ffd993]', high: 'bg-[#71372f] text-[#ffb4a4]', critical: 'bg-[#5a1d1f] text-[#ff9c9c]',
};

const LAYER_KEYS: LayerKey[] = ['corridors', 'roads', 'reports', 'resources'];

export default function MapPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { can } = useAuth();
  const { list, corridors } = useRiskStream();
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ corridors: true, roads: false, reports: true, resources: false });
  const roads = useLive<{ roads: Road[] }>('/roads', ['road_updated']);
  const reports = useLive<{ reports: Report[] }>(can('incidents.view') ? '/reports' : null, ['report_updated']);
  const resources = useLive<{ resources: Resource[] }>(can('incidents.view') ? '/resources' : null, ['resource_updated', 'incident_updated']);
  const corridorColors = useMemo(() => Object.fromEntries(corridors.map((c) => [c.id, c.color])), [corridors]);
  const layerKeys = LAYER_KEYS.filter((k) => (k !== 'reports' && k !== 'resources') || can('incidents.view'));
  const { selectedId, select, horizon, setHorizon } = useAuthority();
  const googleCfg = useGoogleConfig();
  const alerts = useLive<{ alerts: AlertItem[] }>('/alerts', ['alert_published', 'alert_cancelled']);
  const horizons = [0, ...riskConfig.forecastHorizonsHours];
  const online = list.filter((l) => l.risk).length;

  // Map / In-person view share one map area: in-person mode shows Google Street View nearest to the
  // selected place or to any spot clicked on the map.
  const [mode, setMode] = useState<'map' | 'street'>('map');
  const [streetVisible, setStreetVisible] = useState(false);
  const [street, setStreet] = useState<StreetStatus>({ state: 'idle' });
  const [viewPoint, setViewPoint] = useState<ViewTarget | null>(null);
  const selected = list.find((l) => l.id === selectedId);
  const pointFor = (l: LocationSnap): ViewTarget => ({ lat: l.lat, lng: l.lng, label: placeName(l, lang) });
  useEffect(() => { if (mode === 'street' && selected) setViewPoint(pointFor(selected)); }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const switchMode = (m: 'map' | 'street') => { setMode(m); setViewPoint(m === 'street' && selected ? pointFor(selected) : null); };
  // Google's pegman can open street view too; keep the toggle in step.
  const onVisibleChange = (v: boolean) => { setStreetVisible(v); if (v) setMode('street'); };
  const pickPoint = (pos: google.maps.LatLngLiteral) => setViewPoint({ ...pos, label: t('map.in_person_point', { lat: pos.lat.toFixed(4), lng: pos.lng.toFixed(4) }) });
  const km = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

  const alertedSince = (l: LocationSnap) => (alerts.data?.alerts || []).some((a) => !a.cancelled_at && a.kind === 'warning' && l.risk && a.created_at >= l.risk.level_since &&
    ((a.target_type === 'location' && a.target_id === l.id) || (a.target_type === 'corridor' && a.target_id === l.corridor_id) || (a.target_type === 'district' && a.target_id === l.district)));

  return (
    <div className="relative flex h-full min-h-0">
      <div className="flex-1 min-w-0 p-3 max-md:p-0 overflow-y-auto">
        <GoogleMapsFrame className="map-console lg:h-full">
        {(cfg) => (
        <div className="map-console lg:h-full">
          {/* Map (and in-person view in the same area) */}
          <div className="relative min-h-[440px] overflow-hidden bg-[#dcebdc]">
            <WatchMap mapId={cfg.map_id} onMapClick={mode === 'street' ? pickPoint : undefined} locations={list} horizon={horizon} activeId={selectedId} onSelect={select} layers={layers} corridorColors={corridorColors}
              roads={roads.data?.roads || []} reports={reports.data?.reports || []} resources={resources.data?.resources || []}>
              <InPersonController enabled={mode === 'street'} target={viewPoint} onStatus={setStreet} onVisibleChange={onVisibleChange} />
            </WatchMap>

            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex w-max max-w-[92%] flex-col items-center gap-1.5">
              <div role="radiogroup" aria-label={t('map.view_mode')} className="flex rounded-xl border border-white/80 bg-white/95 p-0.5 shadow-sm backdrop-blur">
                {(['map', 'street'] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => switchMode(m)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold ${mode === m ? 'bg-[#2a5d43] text-[#d7efd8]' : 'text-[#315542] hover:bg-[#e8f3ed]'}`}>
                    {m === 'map' ? <MapIcon size={13} aria-hidden /> : <PersonStanding size={13} aria-hidden />}
                    {m === 'map' ? t('map.mode_map') : t('map.in_person')}
                  </button>
                ))}
              </div>
              {mode === 'street' && (street.state !== 'idle' || !streetVisible) && (
                <p role="status" className="flex max-w-full items-center gap-2 rounded-lg bg-[#15241c]/90 px-3 py-1.5 text-center text-[11px] text-[#d7efd8] shadow">
                  {street.state === 'loading' && <><Loader2 size={13} className="animate-spin shrink-0" aria-hidden />{t('map.in_person_loading')}</>}
                  {street.state === 'none' && <>{viewPoint?.label} · {t('map.in_person_none', { d: km(RADII[RADII.length - 1]) })}</>}
                  {street.state === 'idle' && t('map.in_person_hint')}
                  {street.state === 'found' && (
                    <>
                      <span className="truncate">{viewPoint?.label} · {street.distanceM > 150 ? t('map.in_person_dist', { d: km(street.distanceM) }) : (street.description || t('map.in_person_here'))}</span>
                      <a className="shrink-0 inline-flex items-center gap-1 font-bold underline-offset-2 hover:underline"
                        href={`https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(street.panoId)}`} target="_blank" rel="noopener noreferrer">
                        <ExternalLink size={12} aria-hidden />{t('map.in_person_open')}
                      </a>
                    </>
                  )}
                </p>
              )}
            </div>

            {!streetVisible && (
              <>
                <div className="absolute left-3 top-14 flex items-center gap-2 rounded-xl border border-white/80 bg-white/90 px-3 py-2 text-[10px] font-bold text-[#315542] shadow-sm backdrop-blur">
                  <MapPinned size={13} aria-hidden /> {t('map.watch_title')}
                </div>
                <div className="absolute left-3 top-[6.25rem] flex flex-wrap items-center gap-2 max-w-[80%]" role="group" aria-label={t('map.layers')}>
                  <span className="map-legend"><Layers size={12} aria-hidden /> {t('map.layers')}</span>
                  {layerKeys.map((k) => (
                    <button key={k} type="button" aria-pressed={layers[k]} onClick={() => setLayers((x) => ({ ...x, [k]: !x[k] }))}
                      className={`map-legend ${layers[k] ? '!bg-[#2a5d43] !text-[#d7efd8] !border-[#2a5d43]' : ''}`}>
                      {t(`map.layer_${k}`)}
                    </button>
                  ))}
                </div>
                <div className="absolute bottom-4 left-4 flex flex-wrap gap-2 max-w-[70%]">
                  {LEVELS.map((lv) => (
                    <span key={lv} className="map-legend"><span className={`h-2 w-2 rounded-full ${DOT[lv]}`} aria-hidden /> {t(`levels.${lv}`)}</span>
                  ))}
                  {googleCfg && !googleCfg.api_key && <span className="map-legend !text-[#a8681f]">{t('map.google_key_missing')}</span>}
                </div>
              </>
            )}
          </div>

          {/* Live risk stations */}
          <aside className="map-rail flex flex-col min-h-0" aria-labelledby="stations-title">
            <div className="flex items-start justify-between border-b border-white/10 pb-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#819488]">{t('map.region')}</p>
                <h2 id="stations-title" className="mt-1 text-xl font-semibold text-white">{t('map.stations')}</h2>
              </div>
              <span className="rounded-full bg-[#2a5d43] px-2 py-1 text-[9px] font-bold text-[#d7efd8]">{t('map.online', { count: online })}</span>
            </div>

            <div role="radiogroup" aria-label={t('map.time')} className="mt-3 flex items-center gap-1 rounded-xl bg-white/5 p-1">
              {horizons.map((h) => (
                <button key={h} type="button" role="radio" aria-checked={horizon === h} onClick={() => setHorizon(h)}
                  className={`flex-1 rounded-lg px-1.5 py-1 text-[11px] font-bold font-mono ${horizon === h ? 'bg-[#2a5d43] text-[#d7efd8]' : 'text-[#91a297] hover:text-white'}`}>
                  {h === 0 ? t('map.now') : t('map.plus_h', { h })}
                </button>
              ))}
            </div>
            {horizon > 0 && <p className="mt-1 text-[10px] text-[#91a297]" role="status">{t('map.forecast_note', { h: horizon })}</p>}

            <div className="mt-3 overflow-y-auto pr-1 max-lg:max-h-[420px] lg:flex-1 lg:min-h-0">
              {list.map((l) => {
                const lv = levelAt(l, horizon);
                if (!lv) return null;
                const rain = l.risk?.conditions?.rain_24h;
                const live = l.risk?.conditions?.data_source === 'open-meteo';
                const noAlert = horizon === 0 && lv === 'critical' && !alertedSince(l);
                return (
                  <button key={l.id} type="button" onClick={() => select(l.id)} aria-pressed={selectedId === l.id}
                    className={`map-table-row ${selectedId === l.id ? 'active' : ''}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-bold text-[#f4f7f3]">{placeName(l, lang)}</span>
                      <span className="mt-1 block text-[10px] text-[#85998b]">
                        {t(`districts.${l.district}`)} · {live ? t('map.rain_live') : t('map.refreshing')}
                      </span>
                      {noAlert && <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-[#ff9c9c]"><AlertTriangle size={11} aria-hidden />{t('map.critical_no_alert')}</span>}
                    </span>
                    <span className="text-right">
                      <span className={`block text-xs font-bold ${VALUE[lv]}`}>{typeof rain === 'number' ? rain.toFixed(1) : '–'}</span>
                      <span className="text-[9px] text-[#7f9284]">{t('map.mm24')}</span>
                    </span>
                    <span className={`ml-3 rounded-full px-2 py-1 text-[9px] font-bold ${PILL[lv]}`}>{t(`levels.${lv}`)}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 border-t border-white/10 pt-4 text-[10px] leading-5 text-[#91a297]">
              <div className="flex items-center gap-2"><CloudRain size={13} className="text-[#9dc6a5]" aria-hidden /> {t('map.src_rain')}</div>
              <div className="mt-1 flex items-center gap-2"><CloudLightning size={13} className="text-[#9dc6a5]" aria-hidden /> {t('map.src_imd')}</div>
            </div>
          </aside>
        </div>
        )}
        </GoogleMapsFrame>
      </div>

      {/* Right detail drawer */}
      {selectedId && (
        <div className="w-[400px] max-w-full shrink-0 bg-surface border-l border-line z-[650] max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:shadow-2xl" lang={lang}>
          <DetailDrawer id={selectedId} onClose={() => select(null)} />
        </div>
      )}
    </div>
  );
}
