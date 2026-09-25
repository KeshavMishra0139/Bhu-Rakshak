// Corridor watch map for the authority dashboard, in the style of the team's citizen-portal map:
// classic red map pins labelled by risk level, on free Esri satellite / street and OpenTopoMap terrain tiles (Leaflet),
// plus optional operational layers (corridors, road status, citizen reports, resources).
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo } from 'react';
import L from 'leaflet';
import { CircleMarker, MapContainer, Marker, Polyline, ScaleControl, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import type { Level, LocationSnap, Report, Resource, Road } from '../../api/types';
import { useTheme } from '../../theme/ThemeProvider';
import { BASEMAPS, WATCH_BOUNDS, MAP_CENTER, MAP_MIN_ZOOM, basemapNativeZoom, basemapOverlays, basemapUrl, type Basemap } from '../../lib/mapConfig';
import { placeName } from '../../lib/format';

/** Pin label per level: tick for calm, dot to watch, exclamation for danger. */
export const PIN_LABEL: Record<Level, string> = { low: '✓', moderate: '•', high: '!', critical: '!!' };

export type LayerKey = 'corridors' | 'roads' | 'reports' | 'resources';

const ROAD_COLOR: Record<Road['status'], string> = { open: '#2F8F4E', cleared: '#2F8F4E', caution: '#C99A12', restricted: '#D9731A', blocked: '#C62828' };
const RES_ICON: Record<Resource['type'], [string, string]> = { excavator: ['J', '#8a6d1d'], rescue_team: ['R', '#1F7A8C'], ambulance: ['A', '#b3261e'], shelter: ['S', '#3f6e3a'] };

export const levelAt = (l: LocationSnap, horizon: number): Level | null =>
  !l.risk ? null : horizon === 0 ? l.risk.level : (l.risk.forecast?.find((f) => f.h === horizon)?.level || l.risk.level);

// Classic teardrop map pin (26×37) with a white label, anchored at its tip.
const pinCache = new Map<string, L.DivIcon>();
function pinIcon(label: string, active: boolean) {
  const key = `${label}|${active}`;
  let icon = pinCache.get(key);
  if (!icon) {
    icon = L.divIcon({
      className: `watch-pin${active ? ' active' : ''}`,
      iconSize: [26, 37],
      iconAnchor: [13, 37],
      tooltipAnchor: [0, -34],
      html: `<svg width="26" height="37" viewBox="0 0 26 37" aria-hidden="true"><path d="M13 0.8C6.2 0.8 0.8 6.2 0.8 13c0 9.4 12.2 23.2 12.2 23.2S25.2 22.4 25.2 13C25.2 6.2 19.8 0.8 13 0.8z" fill="#EA4335" stroke="#A52714" stroke-width="1.2"/></svg><span>${label}</span>`,
    });
    pinCache.set(key, icon);
  }
  return icon;
}

/** Smooth moves only when the page is visible; browsers pause animation frames in hidden tabs, which would stall them. */
const animate = () => document.visibilityState === 'visible';

/** Blue pin for a searched place (distinct from the red risk pins). */
const searchIcon = L.divIcon({
  className: 'watch-pin search-pin',
  iconSize: [26, 37],
  iconAnchor: [13, 37],
  tooltipAnchor: [0, -34],
  html: '<svg width="26" height="37" viewBox="0 0 26 37" aria-hidden="true"><path d="M13 0.8C6.2 0.8 0.8 6.2 0.8 13c0 9.4 12.2 23.2 12.2 23.2S25.2 22.4 25.2 13C25.2 6.2 19.8 0.8 13 0.8z" fill="#1a73e8" stroke="#0b4fb3" stroke-width="1.2"/><circle cx="13" cy="13" r="4.5" fill="#fff"/></svg>',
});

export type SearchPin = { lat: number; lng: number; label: string };

function FlyTo({ pin }: { pin: SearchPin | null }) {
  const map = useMap();
  useEffect(() => { if (pin) map.flyTo([pin.lat, pin.lng], Math.max(map.getZoom(), 14), { duration: 0.8, animate: animate() }); }, [pin?.lat, pin?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * Centre the selected station. Selecting also opens the details drawer, which narrows the map in the same render,
 * so sync Leaflet's size first; otherwise the resize that follows cancels the pan. `tick` re-centres on every pick,
 * even of the station that is already selected.
 */
function PanTo({ target, tick }: { target: [number, number] | null; tick: number }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    map.invalidateSize({ pan: false });
    map.panTo(target, { animate: animate() });
  }, [target?.[0], target?.[1], tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Keep Leaflet's size in step with its container (the drawer and rail change the map's width). */
function AutoResize() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

function ClickHandler({ onClick }: { onClick?: (pos: { lat: number; lng: number }) => void }) {
  useMapEvents({ click: (e) => onClick?.({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

type Props = {
  basemap: Basemap['id'];
  /** Clicks on empty map (used by the in-person view to pick a spot). */
  onMapClick?: (pos: { lat: number; lng: number }) => void;
  locations: LocationSnap[];
  horizon: number;
  activeId: string | null;
  onSelect: (id: string) => void;
  layers: Record<LayerKey, boolean>;
  roads: Road[];
  reports: Report[];
  resources: Resource[];
  corridorColors: Record<string, string>;
  /** A place found with the search box. */
  searchPin?: SearchPin | null;
  /** Increments on every station pick, so picking the same station again re-centres it. */
  focusTick?: number;
};

export function WatchMap({ basemap, onMapClick, locations, horizon, activeId, onSelect, layers, roads, reports, resources, corridorColors, searchPin = null, focusTick = 0 }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { resolved } = useTheme();
  const base = BASEMAPS.find((b) => b.id === basemap) || BASEMAPS[0];
  const byId = useMemo(() => Object.fromEntries(locations.map((l) => [l.id, l])), [locations]);
  const pathOf = (r: Road) => r.path.map((id) => byId[id]).filter(Boolean).map((l) => [l.lat, l.lng] as [number, number]);
  const active = activeId ? byId[activeId] : undefined;

  return (
    <MapContainer center={MAP_CENTER} zoom={9} minZoom={MAP_MIN_ZOOM} maxBounds={WATCH_BOUNDS} maxBoundsViscosity={0.7} zoomControl={false}
      className="h-full w-full min-h-[440px]" attributionControl>
      <TileLayer key={`${base.id}-${resolved}`} url={basemapUrl(base, resolved)} attribution={base.attribution} maxZoom={base.maxZoom} maxNativeZoom={basemapNativeZoom(base, resolved)}
        subdomains={base.subdomains || 'abc'} />
      {basemapOverlays(base, resolved).map((o) => <TileLayer key={`${base.id}-${resolved}-${o.url}`} url={o.url} subdomains={o.subdomains || 'abc'} maxZoom={base.maxZoom} maxNativeZoom={o.nativeZoom ?? basemapNativeZoom(base, resolved)} />)}

      {layers.corridors && roads.map((r) => (
        <Polyline key={`c-${r.id}`} positions={pathOf(r)} interactive={false}
          pathOptions={{ color: corridorColors[r.corridor_id] || '#7CC4CF', weight: 4, opacity: 0.8, dashArray: '2 8', lineCap: 'round' }} />
      ))}
      {layers.roads && roads.map((r) => (
        <Polyline key={`r-${r.id}-${r.status}`} positions={pathOf(r)} pathOptions={{ color: ROAD_COLOR[r.status], weight: 6, opacity: 0.85 }}>
          <Tooltip sticky>{lang === 'hi' ? r.name_hi : r.name_en}: {t(`roads.st_${r.status}`)}</Tooltip>
        </Polyline>
      ))}
      {layers.reports && reports.map((r) => (
        <CircleMarker key={`rep-${r.id}`} center={[r.lat, r.lng]} radius={6}
          pathOptions={{ color: '#fff', weight: 2, fillColor: r.status === 'verified' ? '#2F8F4E' : r.status === 'rejected' ? '#777' : '#D9731A', fillOpacity: 1 }}>
          <Tooltip>{t('map.report_pin')}: {t(`reports.ty_${r.type}`)} ({t(`reports.st_${r.status}`)})</Tooltip>
        </CircleMarker>
      ))}
      {layers.resources && resources.filter((r) => r.lat != null).map((r, i) => {
        const [letter, color] = RES_ICON[r.type];
        const icon = L.divIcon({ className: '', html: `<span class="res-icon" style="background:${color};opacity:${r.status === 'unavailable' ? 0.5 : 1}">${letter}</span>`, iconSize: [22, 22] });
        return (
          <Marker key={`res-${r.id}`} position={[r.lat! + 0.012 + (i % 3) * 0.006, r.lng! - 0.018 + (i % 4) * 0.008]} icon={icon} keyboard={false}>
            <Tooltip>{t('map.resources_short', { name: r.name, status: t(`resources.st_${r.status}`) })}</Tooltip>
          </Marker>
        );
      })}

      {locations.map((l) => {
        const lv = levelAt(l, horizon);
        if (!lv) return null;
        const isActive = l.id === activeId;
        return (
          <Marker key={l.id} position={[l.lat, l.lng]} icon={pinIcon(PIN_LABEL[lv], isActive)} zIndexOffset={isActive ? 1000 : 0}
            title={placeName(l, lang)} alt={`${placeName(l, lang)}: ${t(`levels.${lv}`)}`} eventHandlers={{ click: () => onSelect(l.id) }}>
            <Tooltip direction="top">{placeName(l, lang)} · {t(`levels.${lv}`)}{horizon ? ` (+${horizon}h)` : ''}</Tooltip>
          </Marker>
        );
      })}

      {searchPin && (
        <Marker position={[searchPin.lat, searchPin.lng]} icon={searchIcon} zIndexOffset={2000} title={searchPin.label} keyboard={false}>
          <Tooltip direction="top" permanent>{searchPin.label}</Tooltip>
        </Marker>
      )}
      <FlyTo pin={searchPin} />
      <PanTo target={active ? [active.lat, active.lng] : null} tick={focusTick} />
      <ClickHandler onClick={onMapClick} />
      <AutoResize />
      <ZoomControl position="bottomright" />
      <ScaleControl position="bottomright" imperial={false} />
    </MapContainer>
  );
}
