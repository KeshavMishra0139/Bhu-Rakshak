import { useEffect, useMemo, useState } from 'react';
import { AdvancedMarker, ControlPosition, Map, Polyline, useMap } from '@vis.gl/react-google-maps';
import { useTranslation } from 'react-i18next';
import type { FeatureCollection } from 'geojson';
import type { AlertItem, Level, LocationSnap, Report, Resource, Road } from '../../api/types';
import { GoogleMapsFrame, MapDot, useMapColorScheme, type GoogleConfig } from '../../lib/googleMaps';
import { BASEMAPS, MAP_BOUNDS, MAP_CENTER, MAP_MIN_ZOOM, OFFICIAL_BOUNDARY_URL, type Basemap } from '../../lib/mapConfig';
import { levelVar } from '../../lib/risk';
import { placeName } from '../../lib/format';

export type LayerKey = 'risk' | 'corridors' | 'rain' | 'soil' | 'history' | 'reports' | 'roads' | 'resources' | 'boundary';
export type MapConfigResp = { bhuvan: { available: boolean; url: string; version: string; token: string | null; layers: { name: string; title: string }[] }; google: GoogleConfig };

const RADIUS: Record<Level, number> = { low: 7, moderate: 9, high: 12, critical: 15 };
const ROAD_COLOR: Record<Road['status'], string> = { open: '#2F8F4E', cleared: '#2F8F4E', caution: '#C99A12', restricted: '#D9731A', blocked: '#C62828' };
const RES_ICON: Record<Resource['type'], [string, string]> = { excavator: ['J', '#8a6d1d'], rescue_team: ['R', '#1F7A8C'], ambulance: ['A', '#b3261e'], shelter: ['S', '#3f6e3a'] };
// Dashes for corridor lines: Google draws dashed polylines as repeated symbols on an invisible stroke.
const DASH = (color: string) => [{ icon: { path: 'M 0,-1 0,1', strokeColor: color, strokeOpacity: 0.7, strokeWeight: 4, scale: 2 }, offset: '0', repeat: '12px' }];

export const levelAt = (l: LocationSnap, horizon: number): Level | null =>
  !l.risk ? null : horizon === 0 ? l.risk.level : (l.risk.forecast?.find((f) => f.h === horizon)?.level || l.risk.level);

function FlyTo({ target }: { target: google.maps.LatLngLiteral | null }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !target) return;
    map.panTo(target);
    if ((map.getZoom() ?? 0) < 11) map.setZoom(11);
  }, [map, target?.lat, target?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Bhuvan WMS layer drawn as Google map tiles (EPSG:3857 bounding box per tile). */
function WmsOverlay({ url, layer, token }: { url: string; layer: string; token: string | null }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const HALF = Math.PI * 6378137;
    const tiles = new google.maps.ImageMapType({
      name: layer,
      opacity: 0.6,
      tileSize: new google.maps.Size(256, 256),
      getTileUrl: (c, z) => {
        const n = 2 ** z;
        const size = (2 * HALF) / n;
        const x = ((c.x % n) + n) % n;
        const minX = -HALF + x * size;
        const maxY = HALF - c.y * size;
        const p = new URLSearchParams({
          service: 'WMS', request: 'GetMap', version: '1.1.1', layers: layer, styles: '', format: 'image/png', transparent: 'true',
          srs: 'EPSG:3857', width: '256', height: '256', bbox: `${minX},${maxY - size},${minX + size},${maxY}`,
        });
        if (token) p.set('token', token);
        return `${url}?${p}`;
      },
    });
    map.overlayMapTypes.push(tiles);
    return () => {
      const arr = map.overlayMapTypes;
      for (let i = 0; i < arr.getLength(); i++) if (arr.getAt(i) === tiles) { arr.removeAt(i); break; }
    };
  }, [map, url, layer, token]);
  return null;
}

function BoundaryLayer({ data, color }: { data: FeatureCollection; color: string }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const features = map.data.addGeoJson(data);
    map.data.setStyle({ strokeColor: color, strokeWeight: 1.4, strokeOpacity: 0.9, fillOpacity: 0, clickable: false });
    return () => features.forEach((f) => map.data.remove(f));
  }, [map, data, color]);
  return null;
}

function Compass() {
  const { t } = useTranslation();
  return (
    <div className="absolute right-3 top-[108px] z-[550] card h-11 w-11 flex flex-col items-center justify-center !border-line pointer-events-none" role="img" aria-label={t('map.north')}>
      <svg width="18" height="22" viewBox="0 0 18 22" aria-hidden><path d="M9 1 L15 20 L9 15 L3 20 Z" fill="rgb(var(--risk-critical))" /><path d="M9 15 L15 20 L9 1 Z" fill="rgb(var(--ink))" opacity="0.35" /></svg>
      <span className="text-[9px] font-bold leading-none">N</span>
    </div>
  );
}

type Props = {
  basemap: Basemap['id'];
  layers: Record<LayerKey, boolean>;
  bhuvanOn: string[];
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
  const colorScheme = useMapColorScheme();
  const [boundary, setBoundary] = useState<FeatureCollection | null>(null);
  const [hoverRoad, setHoverRoad] = useState<{ text: string; pos: google.maps.LatLngLiteral } | null>(null);

  useEffect(() => {
    fetch(OFFICIAL_BOUNDARY_URL).then((r) => (r.ok ? r.json() : null)).then((g) => {
      const ok = g && Array.isArray(g.features) && g.features.length > 0;
      setBoundary(ok ? g : null);
      p.onBoundaryState(!ok);
    }).catch(() => p.onBoundaryState(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mapTypeId = (BASEMAPS.find((b) => b.id === p.basemap) || BASEMAPS[0]).mapTypeId;
  const byId = useMemo(() => Object.fromEntries(p.locations.map((l) => [l.id, l])), [p.locations]);
  const pathOf = (r: Road) => r.path.map((id) => byId[id]).filter(Boolean).map((l) => ({ lat: l.lat, lng: l.lng }));
  const selected = p.selectedId ? byId[p.selectedId] : null;
  const alertedSince = (l: LocationSnap) => p.alerts.some((a) => !a.cancelled_at && a.kind === 'warning' && l.risk && a.created_at >= l.risk.level_since &&
    ((a.target_type === 'location' && a.target_id === l.id) || (a.target_type === 'corridor' && a.target_id === l.corridor_id) || (a.target_type === 'district' && a.target_id === l.district)));

  return (
    <div className="relative h-full w-full">
      <GoogleMapsFrame>
        {(cfg) => (
          <Map mapId={cfg.map_id} colorScheme={colorScheme} mapTypeId={mapTypeId} defaultCenter={MAP_CENTER} defaultZoom={9} minZoom={MAP_MIN_ZOOM}
            restriction={{ latLngBounds: MAP_BOUNDS, strictBounds: false }} gestureHandling="greedy" disableDefaultUI
            zoomControl zoomControlOptions={{ position: ControlPosition.RIGHT_BOTTOM }} scaleControl clickableIcons={false}
            style={{ width: '100%', height: '100%' }}>
            {p.config?.bhuvan.available && p.bhuvanOn.map((name) => (
              <WmsOverlay key={name} url={p.config!.bhuvan.url} layer={name} token={p.config!.bhuvan.token} />
            ))}

            {p.layers.boundary && boundary && (
              <BoundaryLayer data={boundary} color={colorScheme === 'DARK' || p.basemap === 'satellite' ? '#f5f1e8' : '#0B2A33'} />
            )}

            {p.layers.corridors && p.roads.map((r) => (
              <Polyline key={`c-${r.id}`} path={pathOf(r)} clickable={false} strokeOpacity={0} icons={DASH(p.corridorColors[r.corridor_id] || '#7CC4CF')} />
            ))}
            {p.layers.roads && p.roads.map((r) => (
              <Polyline key={`r-${r.id}-${r.status}`} path={pathOf(r)} strokeColor={ROAD_COLOR[r.status]} strokeWeight={6} strokeOpacity={0.85}
                onMouseOver={(e) => e.latLng && setHoverRoad({ text: `${lang === 'hi' ? r.name_hi : r.name_en}: ${t(`roads.st_${r.status}`)}`, pos: e.latLng.toJSON() })}
                onMouseOut={() => setHoverRoad(null)} />
            ))}
            {hoverRoad && (
              <AdvancedMarker position={hoverRoad.pos} clickable={false} zIndex={2000}>
                <span className="gm-tip gm-tip-static">{hoverRoad.text}</span>
              </AdvancedMarker>
            )}

            {p.layers.rain && p.locations.map((l) => {
              const v = Number(l.risk?.conditions?.rain_24h ?? 0);
              return <MapDot key={`rain-${l.id}`} position={{ lat: l.lat, lng: l.lng }} radius={16 + Math.min(34, v / 3)} fill="#2f7fd6" opacity={Math.min(0.55, 0.08 + v / 180)} zIndex={1} />;
            })}
            {p.layers.soil && p.locations.map((l) => {
              const v = Number(l.risk?.conditions?.saturation_index ?? 0);
              return <MapDot key={`soil-${l.id}`} position={{ lat: l.lat, lng: l.lng }} radius={20 + v * 22} fill="#8b5a2b" opacity={Math.max(0.05, (v - 0.4) * 0.8)} zIndex={1} />;
            })}

            {p.layers.history && p.history.map((h, i) => (
              <MapDot key={`h-${i}`} position={{ lat: h.lat, lng: h.lng }} radius={3} fill="#5d4a3a" stroke="#fff" strokeWidth={1} opacity={0.9} zIndex={5}
                label={t('map.history_pin', { year: h.year })} />
            ))}
            {p.layers.reports && p.reports.map((r) => (
              <MapDot key={`rep-${r.id}`} position={{ lat: r.lat, lng: r.lng }} radius={6} stroke="#fff" strokeWidth={2} zIndex={6}
                fill={r.status === 'verified' ? '#2F8F4E' : r.status === 'rejected' ? '#777' : '#D9731A'}
                label={`${t('map.report_pin')}: ${t(`reports.ty_${r.type}`)} (${t(`reports.st_${r.status}`)})`} />
            ))}
            {p.layers.resources && p.resources.filter((r) => r.lat != null).map((r, i) => {
              const [letter, color] = RES_ICON[r.type];
              return (
                <AdvancedMarker key={`res-${r.id}`} position={{ lat: r.lat! + 0.012 + (i % 3) * 0.006, lng: r.lng! - 0.018 + (i % 4) * 0.008 }} clickable={false} zIndex={7}>
                  <div className="gm-dot">
                    <span className="res-icon" style={{ background: color, opacity: r.status === 'unavailable' ? 0.5 : 1 }}>{letter}</span>
                    <span className="gm-tip">{t('map.resources_short', { name: r.name, status: t(`resources.st_${r.status}`) })}</span>
                  </div>
                </AdvancedMarker>
              );
            })}

            {p.layers.risk && p.locations.map((l) => {
              const lv = levelAt(l, p.horizon);
              if (!lv) return null;
              const sel = l.id === p.selectedId;
              const warn = p.horizon === 0 && lv === 'critical' && !alertedSince(l);
              const name = placeName(l, lang);
              return (
                <MapDot key={`m-${l.id}`} position={{ lat: l.lat, lng: l.lng }} radius={RADIUS[lv] + (sel ? 3 : 0)} fill={levelVar(lv)} zIndex={sel ? 1000 : 100 + RADIUS[lv]}
                  stroke={sel || warn ? '#ffffff' : 'rgba(255,255,255,0.85)'} strokeWidth={sel ? 4 : 2} dashed={warn}
                  className={`risk-marker${lv === 'critical' ? ' risk-pulse' : ''}`} onClick={() => p.onSelect(l.id)} title={`${name} · ${t(`levels.${lv}`)}`}
                  label={<><strong>{name}</strong> · {t(`levels.${lv}`)}{p.horizon ? ` (+${p.horizon}h)` : ''}{warn ? ` · ${t('map.critical_no_alert')}` : ''}</>} />
              );
            })}

            <FlyTo target={selected ? { lat: selected.lat, lng: selected.lng } : null} />
          </Map>
        )}
      </GoogleMapsFrame>
      <Compass />
    </div>
  );
}
