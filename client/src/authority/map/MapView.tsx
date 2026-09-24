import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, WMSTileLayer, CircleMarker, Polyline, GeoJSON, Marker, Tooltip, ScaleControl, ZoomControl, useMap } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import type { FeatureCollection } from 'geojson';
import type { AlertItem, Level, LocationSnap, Report, Resource, Road } from '../../api/types';
import { useTheme } from '../../theme/ThemeProvider';
import { BASEMAPS, MAP_BOUNDS, MAP_CENTER, MAP_MIN_ZOOM, OFFICIAL_BOUNDARY_URL, TILE_ERROR_LIMIT, type Basemap } from '../../lib/mapConfig';
import { levelVar } from '../../lib/risk';
import { placeName } from '../../lib/format';

export type LayerKey = 'risk' | 'corridors' | 'rain' | 'soil' | 'history' | 'reports' | 'roads' | 'resources' | 'boundary';
export type MapConfigResp = { bhuvan: { available: boolean; url: string; version: string; token: string | null; layers: { name: string; title: string }[] }; mappls: { tile_url: string } | null };

const RADIUS: Record<Level, number> = { low: 7, moderate: 9, high: 12, critical: 15 };
const ROAD_COLOR: Record<Road['status'], string> = { open: '#2F8F4E', cleared: '#2F8F4E', caution: '#C99A12', restricted: '#D9731A', blocked: '#C62828' };
const RES_ICON: Record<Resource['type'], [string, string]> = { excavator: ['J', '#8a6d1d'], rescue_team: ['R', '#1F7A8C'], ambulance: ['A', '#b3261e'], shelter: ['S', '#3f6e3a'] };

export const levelAt = (l: LocationSnap, horizon: number): Level | null =>
  !l.risk ? null : horizon === 0 ? l.risk.level : (l.risk.forecast?.find((f) => f.h === horizon)?.level || l.risk.level);

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => { if (target) map.flyTo(target, Math.max(map.getZoom(), 11), { duration: 0.8 }); }, [target, map]);
  return null;
}

function Compass() {
  const { t } = useTranslation();
  return (
    <div className="leaflet-top leaflet-right" style={{ marginTop: 64 }}>
      <div className="leaflet-control card h-11 w-11 flex flex-col items-center justify-center !border-line" role="img" aria-label={t('map.north')}>
        <svg width="18" height="22" viewBox="0 0 18 22" aria-hidden><path d="M9 1 L15 20 L9 15 L3 20 Z" fill="rgb(var(--risk-critical))" /><path d="M9 15 L15 20 L9 1 Z" fill="rgb(var(--ink))" opacity="0.35" /></svg>
        <span className="text-[9px] font-bold leading-none">N</span>
      </div>
    </div>
  );
}

type Props = {
  basemap: Basemap['id'];
  onBasemapFail: () => void;
  layers: Record<LayerKey, boolean>;
  bhuvanOn: string[];
  onBhuvanFail: (name: string) => void;
  config: MapConfigResp | null;
  locations: LocationSnap[];
  corridorColors: Record<string, string>;
  roads: Road[];
  reports: Report[];
  resources: Resource[];
  history: { lat: number; lng: number; year: number }[];
  alerts: AlertItem[];
  horizon: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onBoundaryState: (pending: boolean) => void;
};

export function MapView(p: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { resolved } = useTheme();
  const [boundary, setBoundary] = useState<FeatureCollection | null>(null);
  const tileErrors = useRef<number[]>([]);
  const wmsErrors = useRef<Record<string, number>>({});

  useEffect(() => {
    fetch(OFFICIAL_BOUNDARY_URL).then((r) => (r.ok ? r.json() : null)).then((g) => {
      const ok = g && Array.isArray(g.features) && g.features.length > 0;
      setBoundary(ok ? g : null);
      p.onBoundaryState(!ok);
    }).catch(() => p.onBoundaryState(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const base: Basemap | { id: 'mappls'; url: string; attribution: string; maxZoom: number } =
    p.basemap === 'mappls' && p.config?.mappls
      ? { id: 'mappls', url: p.config.mappls.tile_url, attribution: '© Mappls (MapmyIndia)', maxZoom: 18 }
      : BASEMAPS.find((b) => b.id === p.basemap) || BASEMAPS[0];
  const baseUrl = typeof base.url === 'function' ? base.url(resolved) : base.url;
  const onTileError = () => {
    const now = Date.now();
    tileErrors.current = [...tileErrors.current.filter((x) => now - x < 15000), now];
    if (tileErrors.current.length >= TILE_ERROR_LIMIT) { tileErrors.current = []; p.onBasemapFail(); }
  };

  const byId = useMemo(() => Object.fromEntries(p.locations.map((l) => [l.id, l])), [p.locations]);
  const pathOf = (r: Road) => r.path.map((id) => byId[id]).filter(Boolean).map((l) => [l.lat, l.lng] as [number, number]);
  const selected = p.selectedId ? byId[p.selectedId] : null;
  const alertedSince = (l: LocationSnap) => p.alerts.some((a) => !a.cancelled_at && a.kind === 'warning' && l.risk && a.created_at >= l.risk.level_since &&
    ((a.target_type === 'location' && a.target_id === l.id) || (a.target_type === 'corridor' && a.target_id === l.corridor_id) || (a.target_type === 'district' && a.target_id === l.district)));

  return (
    <MapContainer center={MAP_CENTER} zoom={9} minZoom={MAP_MIN_ZOOM} maxBounds={MAP_BOUNDS} maxBoundsViscosity={0.9} zoomControl={false}
      className="h-full w-full" preferCanvas={false} attributionControl>
      <TileLayer key={`${base.id}-${resolved}`} url={baseUrl} attribution={base.attribution} maxZoom={base.maxZoom}
        subdomains={'subdomains' in base && base.subdomains ? base.subdomains : 'abc'} eventHandlers={{ tileerror: onTileError }} />
      {base.id === 'satellite' && 'labelsUrl' in base && base.labelsUrl && (
        <TileLayer url={base.labelsUrl} subdomains={base.subdomains} maxZoom={base.maxZoom} pane="overlayPane" opacity={0.95} />
      )}

      {p.config?.bhuvan.available && p.bhuvanOn.map((name) => (
        <WMSTileLayer key={name} url={p.config!.bhuvan.url} opacity={0.6}
          params={{ layers: name, format: 'image/png', transparent: true, version: '1.1.1', ...(p.config!.bhuvan.token ? { token: p.config!.bhuvan.token } : {}) } as L.WMSParams}
          eventHandlers={{ tileerror: () => { wmsErrors.current[name] = (wmsErrors.current[name] || 0) + 1; if (wmsErrors.current[name] === 6) p.onBhuvanFail(name); } }} />
      ))}

      {p.layers.boundary && boundary && (
        <GeoJSON data={boundary} style={{ color: resolved === 'dark' || p.basemap === 'satellite' ? '#f5f1e8' : '#0B2A33', weight: 1.4, opacity: 0.9, fill: false }} interactive={false} />
      )}

      {p.layers.corridors && p.roads.map((r) => (
        <Polyline key={`c-${r.id}`} positions={pathOf(r)} interactive={false}
          pathOptions={{ color: p.corridorColors[r.corridor_id] || '#7CC4CF', weight: 4, opacity: 0.55, dashArray: '2 8', lineCap: 'round' }} />
      ))}
      {p.layers.roads && p.roads.map((r) => (
        <Polyline key={`r-${r.id}-${r.status}`} positions={pathOf(r)} pathOptions={{ color: ROAD_COLOR[r.status], weight: 6, opacity: 0.85 }}>
          <Tooltip sticky>{lang === 'hi' ? r.name_hi : r.name_en}: {t(`roads.st_${r.status}`)}</Tooltip>
        </Polyline>
      ))}

      {p.layers.rain && p.locations.map((l) => {
        const v = Number(l.risk?.conditions?.rain_24h ?? 0);
        return <CircleMarker key={`rain-${l.id}`} center={[l.lat, l.lng]} radius={16 + Math.min(34, v / 3)} interactive={false}
          pathOptions={{ stroke: false, fillColor: '#2f7fd6', fillOpacity: Math.min(0.55, 0.08 + v / 180) }} />;
      })}
      {p.layers.soil && p.locations.map((l) => {
        const v = Number(l.risk?.conditions?.saturation_index ?? 0);
        return <CircleMarker key={`soil-${l.id}`} center={[l.lat, l.lng]} radius={20 + v * 22} interactive={false}
          pathOptions={{ stroke: false, fillColor: '#8b5a2b', fillOpacity: Math.max(0.05, (v - 0.4) * 0.8) }} />;
      })}

      {p.layers.history && p.history.map((h, i) => (
        <CircleMarker key={`h-${i}`} center={[h.lat, h.lng]} radius={3} pathOptions={{ color: '#fff', weight: 1, fillColor: '#5d4a3a', fillOpacity: 0.9 }}>
          <Tooltip>{t('map.history_pin', { year: h.year })}</Tooltip>
        </CircleMarker>
      ))}
      {p.layers.reports && p.reports.map((r) => (
        <CircleMarker key={`rep-${r.id}`} center={[r.lat, r.lng]} radius={6}
          pathOptions={{ color: '#fff', weight: 2, fillColor: r.status === 'verified' ? '#2F8F4E' : r.status === 'rejected' ? '#777' : '#D9731A', fillOpacity: 1 }}>
          <Tooltip>{t('map.report_pin')}: {t(`reports.ty_${r.type}`)} ({t(`reports.st_${r.status}`)})</Tooltip>
        </CircleMarker>
      ))}
      {p.layers.resources && p.resources.filter((r) => r.lat != null).map((r, i) => {
        const [letter, color] = RES_ICON[r.type];
        const icon = L.divIcon({ className: '', html: `<span class="res-icon" style="background:${color};opacity:${r.status === 'unavailable' ? 0.5 : 1}">${letter}</span>`, iconSize: [22, 22] });
        return (
          <Marker key={`res-${r.id}`} position={[r.lat! + 0.012 + (i % 3) * 0.006, r.lng! - 0.018 + (i % 4) * 0.008]} icon={icon} keyboard={false}>
            <Tooltip>{t('map.resources_short', { name: r.name, status: t(`resources.st_${r.status}`) })}</Tooltip>
          </Marker>
        );
      })}

      {p.layers.risk && p.locations.map((l) => {
        const lv = levelAt(l, p.horizon);
        if (!lv) return null;
        const sel = l.id === p.selectedId;
        const warn = p.horizon === 0 && lv === 'critical' && !alertedSince(l);
        return (
          <CircleMarker key={`m-${l.id}`} center={[l.lat, l.lng]} radius={RADIUS[lv] + (sel ? 3 : 0)} className={`risk-marker${lv === 'critical' ? ' risk-pulse' : ''}`}
            pathOptions={{ color: sel ? '#ffffff' : warn ? '#ffffff' : 'rgba(255,255,255,0.85)', weight: sel ? 4 : 2, fillColor: levelVar(lv), fillOpacity: 0.95, dashArray: warn ? '3 3' : undefined }}
            eventHandlers={{ click: () => p.onSelect(l.id), keypress: (e) => { if ((e.originalEvent as KeyboardEvent).key === 'Enter') p.onSelect(l.id); } }}>
            <Tooltip direction="top" offset={[0, -RADIUS[lv]]}>
              <strong>{placeName(l, lang)}</strong> · {t(`levels.${lv}`)}{p.horizon ? ` (+${p.horizon}h)` : ''}{warn ? ` · ${t('map.critical_no_alert')}` : ''}
            </Tooltip>
          </CircleMarker>
        );
      })}

      <FlyTo target={selected ? [selected.lat, selected.lng] : null} />
      <ZoomControl position="bottomright" />
      <ScaleControl position="bottomright" imperial={false} />
      <Compass />
    </MapContainer>
  );
}
