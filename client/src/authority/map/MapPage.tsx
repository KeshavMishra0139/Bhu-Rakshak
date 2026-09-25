// Authority map: the team's corridor watch console (map + live risk stations rail), with the location drawer,
// forecast horizon, basemap switch and a Map / In-person view toggle in one map area.
// Maps are free Esri satellite and OpenStreetMap tiles; the in-person view is Google Street View (embed, no key).
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, MapPinned, CloudRain, CloudLightning, AlertTriangle, Layers, PersonStanding, Map as MapIcon, ExternalLink, Crosshair, Maximize2, Minimize2, Satellite } from 'lucide-react';
import type { AlertItem, Level, LocationSnap, Report, Resource, Road, SeismicData } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { useRiskStream } from '../../live/RiskStreamProvider';
import { useLive } from '../useLive';
import { useAuthority } from '../AuthorityContext';
import { WatchMap, levelAt, quakeColor, type LayerKey, type SearchPin } from './WatchMap';
import { MapSearch } from './MapSearch';
import { MapTypePicker } from './MapTypePicker';
import { DetailDrawer } from './DetailDrawer';
import { InPersonView, type ViewTarget } from './InPersonView';
import { streetViewLink, type Basemap } from '../../lib/mapConfig';

const MiniMap = lazy(() => import('../../components/MiniMap'));
import { LEVELS, riskConfig } from '../../lib/risk';
import { placeName } from '../../lib/format';

// Colours from the team's watch map, plus a deeper red for Critical (the portal has three levels).
const DOT: Record<Level, string> = { low: 'bg-[#3f8c70]', moderate: 'bg-[#d9983d]', high: 'bg-[#cf624f]', critical: 'bg-[#9e2a2b]' };
const VALUE: Record<Level, string> = { low: 'text-[#9dd2a6]', moderate: 'text-[#f4c993]', high: 'text-[#f1846d]', critical: 'text-[#ff7a7a]' };
const PILL: Record<Level, string> = {
  low: 'bg-[#2d6143] text-[#b4e1b9]', moderate: 'bg-[#6b512a] text-[#ffd993]', high: 'bg-[#71372f] text-[#ffb4a4]', critical: 'bg-[#5a1d1f] text-[#ff9c9c]',
};
const LAYER_KEYS: LayerKey[] = ['corridors', 'roads', 'seismic', 'reports', 'resources'];
const SEG = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold';
const SEG_ON = 'bg-[#2a5d43] text-[#d7efd8]';
const SEG_OFF = 'text-[#315542] hover:bg-[#e8f3ed]';

export default function MapPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { can } = useAuth();
  const { list, corridors } = useRiskStream();
  const { selectedId, select, horizon, setHorizon } = useAuthority();
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ corridors: true, roads: false, seismic: true, reports: true, resources: false });
  const [basemap, setBasemap] = useState<Basemap['id']>('hybrid');
  const roads = useLive<{ roads: Road[] }>('/roads', ['road_updated']);
  const reports = useLive<{ reports: Report[] }>(can('incidents.view') ? '/reports' : null, ['report_updated']);
  const resources = useLive<{ resources: Resource[] }>(can('incidents.view') ? '/resources' : null, ['resource_updated', 'incident_updated']);
  const seismic = useLive<SeismicData>('/map/seismic', ['weather_refreshed']);
  const alerts = useLive<{ alerts: AlertItem[] }>('/alerts', ['alert_published', 'alert_cancelled']);
  const corridorColors = useMemo(() => Object.fromEntries(corridors.map((c) => [c.id, c.color])), [corridors]);
  const layerKeys = LAYER_KEYS.filter((k) => (k !== 'reports' && k !== 'resources') || can('incidents.view'));
  const horizons = [0, ...riskConfig.forecastHorizonsHours];
  const online = list.filter((l) => l.risk).length;

  const alertedSince = (l: LocationSnap) => (alerts.data?.alerts || []).some((a) => !a.cancelled_at && a.kind === 'warning' && l.risk && a.created_at >= l.risk.level_since &&
    ((a.target_type === 'location' && a.target_id === l.id) || (a.target_type === 'corridor' && a.target_id === l.corridor_id) || (a.target_type === 'district' && a.target_id === l.district)));

  // Map / In-person view share one map area. In-person shows Google Street View at the selected place,
  // or at any spot clicked on the map.
  const [mode, setMode] = useState<'map' | 'street'>('map');
  const [viewPoint, setViewPoint] = useState<ViewTarget | null>(null);
  const selected = list.find((l) => l.id === selectedId);
  const pointFor = (l: LocationSnap): ViewTarget => ({ lat: l.lat, lng: l.lng, label: placeName(l, lang) });
  useEffect(() => { if (mode === 'street' && selected) setViewPoint(pointFor(selected)); }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickPoint = (pos: { lat: number; lng: number }) => setViewPoint({ ...pos, label: t('map.in_person_point', { lat: pos.lat.toFixed(4), lng: pos.lng.toFixed(4) }) });
  const showingStreet = mode === 'street' && !!viewPoint;

  // Search: monitored places open their drawer; any other place gets a blue pin (and, in-person, its street view).
  const [searchPin, setSearchPin] = useState<SearchPin | null>(null);
  // Every station pick (pin, list row or search) re-centres the map on it.
  const [focusTick, setFocusTick] = useState(0);
  const focusStation = (id: string) => { select(id); setFocusTick((n) => n + 1); };
  const pickStation = (id: string) => { setSearchPin(null); focusStation(id); };
  const pickPlace = (pin: SearchPin) => { setSearchPin(pin); if (mode === 'street') setViewPoint(pin); };
  // Entering in-person view starts at the searched place, else the selected station, else asks for a spot.
  const switchMode = (m: 'map' | 'street') => { setMode(m); setViewPoint(m === 'street' ? (searchPin || (selected ? pointFor(selected) : null)) : null); };

  // Fullscreen for the map area.
  const mapArea = useRef<HTMLDivElement>(null);
  const [isFull, setIsFull] = useState(false);
  useEffect(() => {
    const on = () => setIsFull(document.fullscreenElement === mapArea.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : mapArea.current?.requestFullscreen())?.catch(() => {});

  return (
    <div className="relative flex h-full min-h-0">
      <div className="flex-1 min-w-0 p-3 max-md:p-0 overflow-y-auto">
        <div className="map-console lg:h-full">
          {/* Map (and in-person view in the same area) */}
          <div ref={mapArea} className="relative isolate min-h-[440px] overflow-hidden bg-[#dcebdc]">
            <WatchMap basemap={basemap} onMapClick={mode === 'street' ? pickPoint : undefined} locations={list} horizon={horizon} activeId={selectedId}
              onSelect={focusStation} focusTick={focusTick} layers={layers} corridorColors={corridorColors}
              roads={roads.data?.roads || []} reports={reports.data?.reports || []} resources={resources.data?.resources || []} seismic={seismic.data} searchPin={searchPin} />
            {showingStreet && <div className="absolute inset-0 z-[1050]"><InPersonView target={viewPoint} /></div>}
            {/* Inset map while in person: click anywhere on it to move the street view there. Kept above Google's logo. */}
            {showingStreet && (
              <div className="absolute bottom-10 left-3 z-[1100] w-[220px] overflow-hidden rounded-xl border-2 border-white bg-white shadow-lg max-sm:w-[170px]">
                <Suspense fallback={<div className="h-[150px] animate-pulse bg-[#dcebdc]" />}>
                  <MiniMap key={`${viewPoint.lat.toFixed(4)},${viewPoint.lng.toFixed(4)}`} center={[viewPoint.lat, viewPoint.lng]} zoom={15}
                    pin={[viewPoint.lat, viewPoint.lng]} onPick={([lat, lng]) => pickPoint({ lat, lng })} label={t('map.inset_label')} height={150} />
                </Suspense>
                <p className="bg-[#15241c] px-2 py-1 text-[10px] font-semibold text-[#d7efd8]">{t('map.inset_hint')}</p>
              </div>
            )}

            {/* Top overlays, stacked so they wrap instead of overlapping on narrow maps */}
            <div className={`pointer-events-none absolute inset-x-3 top-3 z-[1100] flex flex-col gap-2 ${showingStreet ? 'items-end' : 'items-start'}`}>
              <div className={`flex w-full flex-wrap items-start gap-2 ${showingStreet ? 'justify-end' : 'justify-between'}`}>
                <div role="radiogroup" aria-label={t('map.view_mode')} className="pointer-events-auto flex rounded-xl border border-white/80 bg-white/95 p-0.5 shadow-sm backdrop-blur">
                  {(['map', 'street'] as const).map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => switchMode(m)} className={`${SEG} ${mode === m ? SEG_ON : SEG_OFF}`}>
                      {m === 'map' ? <MapIcon size={13} aria-hidden /> : <PersonStanding size={13} aria-hidden />}
                      {m === 'map' ? t('map.mode_map') : t('map.in_person')}
                    </button>
                  ))}
                </div>
                <div className="pointer-events-auto flex items-center gap-2">
                  {!showingStreet && <MapTypePicker value={basemap} onChange={setBasemap} />}
                  <button type="button" onClick={toggleFull} aria-label={isFull ? t('map.exit_fullscreen') : t('map.fullscreen')} title={isFull ? t('map.exit_fullscreen') : t('map.fullscreen')}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/80 bg-white/95 text-[#315542] shadow-sm hover:bg-[#e8f3ed]">
                    {isFull ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}
                  </button>
                </div>
              </div>

              <MapSearch locations={list} onPickStation={pickStation} onPickPlace={pickPlace} />

              {mode === 'street' && (
                <p role="status" className={`pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-[#15241c]/90 px-3 py-1.5 text-[11px] text-[#d7efd8] shadow ${showingStreet ? 'max-w-[62%] justify-end text-right' : 'max-w-full'}`}>
                  {!viewPoint ? t('map.in_person_hint') : (
                    <>
                      <span className="truncate font-bold">{viewPoint.label}</span>
                      <button type="button" onClick={() => setViewPoint(null)} className="inline-flex items-center gap-1 font-bold hover:underline">
                        <Crosshair size={12} aria-hidden />{t('map.in_person_pick')}
                      </button>
                      <a className="inline-flex items-center gap-1 font-bold hover:underline" href={streetViewLink(viewPoint.lat, viewPoint.lng)} target="_blank" rel="noopener noreferrer">
                        <ExternalLink size={12} aria-hidden />{t('map.in_person_open')}
                      </a>
                      <span className="basis-full text-[10px] text-[#91a297]">{t('map.in_person_tip')}</span>
                    </>
                  )}
                </p>
              )}

              {!showingStreet && (
                <>
                  <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-white/80 bg-white/90 px-3 py-2 text-[10px] font-bold text-[#315542] shadow-sm backdrop-blur">
                    <MapPinned size={13} aria-hidden /> {t('map.watch_title')}
                  </div>
                  <div className="pointer-events-auto flex flex-wrap items-center gap-2 max-w-full" role="group" aria-label={t('map.layers')}>
                    <span className="map-legend"><Layers size={12} aria-hidden /> {t('map.layers')}</span>
                    {layerKeys.map((k) => (
                      <button key={k} type="button" aria-pressed={layers[k]} onClick={() => setLayers((x) => ({ ...x, [k]: !x[k] }))}
                        className={`map-legend ${layers[k] ? '!bg-[#2a5d43] !text-[#d7efd8] !border-[#2a5d43]' : ''}`}>
                        {t(`map.layer_${k}`)}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {!showingStreet && (
              <>
                <div className="absolute bottom-6 left-4 z-[1000] flex flex-wrap gap-2 max-w-[70%]">
                  {LEVELS.map((lv) => (
                    <span key={lv} className="map-legend"><span className={`h-2 w-2 rounded-full ${DOT[lv]}`} aria-hidden /> {t(`levels.${lv}`)}</span>
                  ))}
                  {layers.seismic && seismic.data && (
                    <span className="map-legend" title={seismic.data.feed?.message || undefined}>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: quakeColor(12) }} aria-hidden />{t('seismic.legend_24h')}
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: quakeColor(100) }} aria-hidden />{t('seismic.legend_7d')}
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: quakeColor(400) }} aria-hidden />{t('seismic.legend_30d')}
                      <span className="seismo-station !inline-block scale-75" aria-hidden />{t('seismic.legend_station')}
                    </span>
                  )}
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
                  <button key={l.id} type="button" onClick={() => focusStation(l.id)} aria-pressed={selectedId === l.id}
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
              <div className="mt-1 flex items-center gap-2"><Activity size={13} className="text-[#9dc6a5]" aria-hidden /> {t('map.src_seismic')}</div>
              <div className="mt-1 flex items-center gap-2"><Satellite size={13} className="text-[#9dc6a5]" aria-hidden /> {t('map.src_maps')}</div>
            </div>
          </aside>
        </div>
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
