import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers, PanelLeftClose, PanelLeftOpen, Map as MapIcon } from 'lucide-react';
import { api } from '../../api/client';
import type { AlertItem, Report, Resource, Road } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { useRiskStream } from '../../live/RiskStreamProvider';
import { useLive } from '../useLive';
import { useAuthority } from '../AuthorityContext';
import { MapView, type LayerKey, type MapConfigResp } from './MapView';
import { LocationPanel } from './LocationPanel';
import { DetailDrawer } from './DetailDrawer';
import { BASEMAPS, type Basemap } from '../../lib/mapConfig';
import { useGoogleConfig } from '../../lib/googleMaps';
import { LEVELS, LEVEL_ICON, levelVar, riskConfig } from '../../lib/risk';

const LAYER_KEYS: LayerKey[] = ['risk', 'corridors', 'roads', 'rain', 'soil', 'history', 'reports', 'resources', 'boundary'];
const DEFAULT_LAYERS: Record<LayerKey, boolean> = { risk: true, corridors: true, roads: false, rain: false, soil: false, history: false, reports: true, resources: false, boundary: true };

export default function MapPage() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const { list, corridors, changedAt } = useRiskStream();
  const { selectedId, select, horizon, setHorizon } = useAuthority();
  const [basemap, setBasemap] = useState<Basemap['id']>('satellite');
  const [layers, setLayers] = useState(DEFAULT_LAYERS);
  const [layersOpen, setLayersOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 900);
  const [config, setConfig] = useState<MapConfigResp | null>(null);
  const [bhuvanOn, setBhuvanOn] = useState<string[]>([]);
  const [history, setHistory] = useState<{ lat: number; lng: number; year: number }[]>([]);
  const [boundaryPending, setBoundaryPending] = useState(false);
  const googleCfg = useGoogleConfig();

  const roads = useLive<{ roads: Road[] }>('/roads', ['road_updated']);
  const alerts = useLive<{ alerts: AlertItem[] }>('/alerts', ['alert_published', 'alert_cancelled']);
  const reports = useLive<{ reports: Report[] }>(can('incidents.view') ? '/reports' : null, ['report_updated']);
  const resources = useLive<{ resources: Resource[] }>(can('incidents.view') ? '/resources' : null, ['resource_updated', 'incident_updated']);

  useEffect(() => {
    api.get<MapConfigResp>('/map/config').then(setConfig).catch(() => {});
    api.get<{ points: { lat: number; lng: number; year: number }[] }>('/map/history').then((d) => setHistory(d.points)).catch(() => {});
  }, []);

  const basemapIds = BASEMAPS.map((b) => b.id);
  const corridorColors = useMemo(() => Object.fromEntries(corridors.map((c) => [c.id, c.color])), [corridors]);
  const horizons = [0, ...riskConfig.forecastHorizonsHours];

  return (
    <div className="relative flex h-full min-h-0">
      {/* Left panel */}
      <div className={`${panelOpen ? 'w-[330px]' : 'w-0'} shrink-0 overflow-hidden transition-[width] duration-300 bg-surface border-r border-line z-[500]
        max-md:absolute max-md:inset-y-0 max-md:left-0 ${panelOpen ? 'max-md:w-[88vw] max-md:shadow-2xl' : ''}`}>
        <div className="w-[330px] max-md:w-[88vw] h-full">
          <LocationPanel locations={list} alerts={alerts.data?.alerts || []} horizon={horizon} selectedId={selectedId}
            onSelect={(id) => { select(id); if (window.innerWidth < 768) setPanelOpen(false); }} changedAt={changedAt} />
        </div>
      </div>

      <div className="relative flex-1 min-w-0">
        <MapView basemap={basemap} layers={layers} bhuvanOn={bhuvanOn} config={config} locations={list} corridorColors={corridorColors} roads={roads.data?.roads || []} reports={reports.data?.reports || []}
          resources={resources.data?.resources || []} history={history} alerts={alerts.data?.alerts || []} horizon={horizon}
          selectedId={selectedId} onSelect={select} onBoundaryState={setBoundaryPending} />

        <button type="button" onClick={() => setPanelOpen((v) => !v)} className="absolute top-3 left-3 z-[600] card h-10 w-10 inline-flex items-center justify-center shadow"
          aria-label={panelOpen ? t('map.hide_panel') : t('map.show_panel')} aria-expanded={panelOpen}>
          {panelOpen ? <PanelLeftClose size={18} aria-hidden /> : <PanelLeftOpen size={18} aria-hidden />}
        </button>

        {/* Basemap + layers */}
        <div className="absolute top-3 right-3 z-[600] flex flex-col items-end gap-2">
          <div className="card shadow flex p-0.5" role="radiogroup" aria-label={t('map.basemap')}>
            {basemapIds.map((b) => (
              <button key={b} type="button" role="radio" aria-checked={basemap === b} onClick={() => setBasemap(b)}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-md ${basemap === b ? 'bg-brand text-white' : 'text-muted hover:text-ink'}`}>
                {t(`map.${b}`)}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setLayersOpen((v) => !v)} aria-expanded={layersOpen} className="card shadow h-10 px-3 inline-flex items-center gap-2 text-sm font-semibold">
            <Layers size={17} aria-hidden />{t('map.layers')}
          </button>
          {layersOpen && (
            <fieldset className="card shadow-lg p-3 w-60 space-y-1.5 max-h-[60vh] overflow-y-auto">
              <legend className="sr-only">{t('map.layers')}</legend>
              {LAYER_KEYS.filter((k) => (k !== 'reports' && k !== 'resources') || can('incidents.view')).map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm py-0.5">
                  <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />
                  {t(`map.layer_${k}`)}
                </label>
              ))}
              {config?.bhuvan.available && config.bhuvan.layers.length > 0 && (
                <div className="pt-2 mt-1 border-t border-line">
                  <p className="text-xs font-semibold text-muted mb-1">{t('map.bhuvan')}</p>
                  {config.bhuvan.layers.map((l) => (
                    <label key={l.name} className="flex items-center gap-2 text-sm py-0.5">
                      <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={bhuvanOn.includes(l.name)}
                        onChange={(e) => setBhuvanOn((x) => (e.target.checked ? [...x, l.name] : x.filter((y) => y !== l.name)))} />
                      <span className="truncate" title={l.name}>{l.title || l.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          )}
        </div>

        {/* Forecast time slider */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[600] card shadow-lg px-3 py-2 max-w-[92%]">
          <div role="radiogroup" aria-label={t('map.time')} className="flex items-center gap-1">
            <span className="text-xs font-semibold text-muted mr-1 hidden sm:inline">{t('map.time')}</span>
            {horizons.map((h) => (
              <button key={h} type="button" role="radio" aria-checked={horizon === h} onClick={() => setHorizon(h)}
                className={`px-2.5 py-1.5 rounded-md text-sm font-semibold font-mono ${horizon === h ? 'bg-ink text-bg' : 'text-muted hover:text-ink'}`}>
                {h === 0 ? t('map.now') : t('map.plus_h', { h })}
              </button>
            ))}
          </div>
          {horizon > 0 && <p className="text-xs text-center mt-1 text-muted" role="status">{t('map.forecast_note', { h: horizon })}</p>}
        </div>

        {/* Legend */}
        <div className="absolute bottom-4 left-3 z-[600] card shadow px-3 py-2 text-xs space-y-1 max-md:hidden">
          <p className="font-semibold">{t('map.legend')}</p>
          {LEVELS.map((lv) => {
            const Icon = LEVEL_ICON[lv];
            return <p key={lv} className="flex items-center gap-1.5"><Icon size={13} style={{ color: levelVar(lv) }} aria-hidden />{t(`levels.${lv}`)}</p>;
          })}
          <p className="text-muted">{t('map.marker_size')}</p>
          {boundaryPending && layers.boundary && <p className="text-muted inline-flex items-center gap-1"><MapIcon size={12} aria-hidden />{t('map.boundary_pending')}</p>}
          {googleCfg && !googleCfg.api_key && <p className="text-risk-high inline-flex items-center gap-1"><MapIcon size={12} aria-hidden />{t('map.google_key_missing')}</p>}
        </div>
      </div>

      {/* Right detail drawer */}
      {selectedId && (
        <div className="w-[400px] max-w-full shrink-0 bg-surface border-l border-line z-[650] max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:shadow-2xl" lang={i18n.language}>
          <DetailDrawer id={selectedId} onClose={() => select(null)} />
        </div>
      )}
    </div>
  );
}
