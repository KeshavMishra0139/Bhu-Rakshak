// Corridor watch map for the authority dashboard, following the team's citizen-portal map:
// a plain Google map with Google's own controls and classic pins labelled by risk level,
// plus optional operational layers (corridors, road status, citizen reports, resources).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AdvancedMarker, Map, Marker, Polyline, useMap } from '@vis.gl/react-google-maps';
import { useTranslation } from 'react-i18next';
import type { Level, LocationSnap, Report, Resource, Road } from '../../api/types';
import { MapDot } from '../../lib/googleMaps';
import { MAP_CENTER } from '../../lib/mapConfig';
import { placeName } from '../../lib/format';

/** Pin label per level: tick for calm, dot to watch, exclamation for danger. */
export const PIN_LABEL: Record<Level, string> = { low: '✓', moderate: '•', high: '!', critical: '!!' };

export type LayerKey = 'corridors' | 'roads' | 'reports' | 'resources';

const ROAD_COLOR: Record<Road['status'], string> = { open: '#2F8F4E', cleared: '#2F8F4E', caution: '#C99A12', restricted: '#D9731A', blocked: '#C62828' };
const RES_ICON: Record<Resource['type'], [string, string]> = { excavator: ['J', '#8a6d1d'], rescue_team: ['R', '#1F7A8C'], ambulance: ['A', '#b3261e'], shelter: ['S', '#3f6e3a'] };
// Dashes for corridor lines: Google draws dashed polylines as repeated symbols on an invisible stroke.
const DASH = (color: string) => [{ icon: { path: 'M 0,-1 0,1', strokeColor: color, strokeOpacity: 0.75, strokeWeight: 4, scale: 2 }, offset: '0', repeat: '12px' }];

export const levelAt = (l: LocationSnap, horizon: number): Level | null =>
  !l.risk ? null : horizon === 0 ? l.risk.level : (l.risk.forecast?.find((f) => f.h === horizon)?.level || l.risk.level);

function PanTo({ target }: { target: google.maps.LatLngLiteral | null }) {
  const map = useMap();
  useEffect(() => { if (map && target) map.panTo(target); }, [map, target?.lat, target?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

type Props = {
  mapId: string;
  /** Clicks on empty map (used by the in-person view to pick a spot). */
  onMapClick?: (pos: google.maps.LatLngLiteral) => void;
  locations: LocationSnap[];
  horizon: number;
  activeId: string | null;
  onSelect: (id: string) => void;
  layers: Record<LayerKey, boolean>;
  roads: Road[];
  reports: Report[];
  resources: Resource[];
  corridorColors: Record<string, string>;
  /** Extra map-bound controllers (e.g. the in-person view). */
  children?: ReactNode;
};

export function WatchMap({ mapId, onMapClick, locations, horizon, activeId, onSelect, layers, roads, reports, resources, corridorColors, children }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [hoverRoad, setHoverRoad] = useState<{ text: string; pos: google.maps.LatLngLiteral } | null>(null);
  const byId = useMemo(() => Object.fromEntries(locations.map((l) => [l.id, l])), [locations]);
  const pathOf = (r: Road) => r.path.map((id) => byId[id]).filter(Boolean).map((l) => ({ lat: l.lat, lng: l.lng }));
  const active = activeId ? byId[activeId] : undefined;

  return (
    <Map mapId={mapId} defaultCenter={MAP_CENTER} defaultZoom={9} mapTypeControl fullscreenControl zoomControl streetViewControl
      className="h-full w-full min-h-[440px]" onClick={onMapClick ? (e) => { if (e.detail.latLng) onMapClick(e.detail.latLng); } : undefined}>
      {layers.corridors && roads.map((r) => (
        <Polyline key={`c-${r.id}`} path={pathOf(r)} clickable={false} strokeOpacity={0} icons={DASH(corridorColors[r.corridor_id] || '#7CC4CF')} />
      ))}
      {layers.roads && roads.map((r) => (
        <Polyline key={`r-${r.id}-${r.status}`} path={pathOf(r)} strokeColor={ROAD_COLOR[r.status]} strokeWeight={6} strokeOpacity={0.85}
          onMouseOver={(e) => e.latLng && setHoverRoad({ text: `${lang === 'hi' ? r.name_hi : r.name_en}: ${t(`roads.st_${r.status}`)}`, pos: e.latLng.toJSON() })}
          onMouseOut={() => setHoverRoad(null)} />
      ))}
      {hoverRoad && (
        <AdvancedMarker position={hoverRoad.pos} clickable={false} zIndex={2000}>
          <span className="gm-tip gm-tip-static">{hoverRoad.text}</span>
        </AdvancedMarker>
      )}
      {layers.reports && reports.map((r) => (
        <MapDot key={`rep-${r.id}`} position={{ lat: r.lat, lng: r.lng }} radius={6} stroke="#fff" strokeWidth={2} zIndex={6}
          fill={r.status === 'verified' ? '#2F8F4E' : r.status === 'rejected' ? '#777' : '#D9731A'}
          label={`${t('map.report_pin')}: ${t(`reports.ty_${r.type}`)} (${t(`reports.st_${r.status}`)})`} />
      ))}
      {layers.resources && resources.filter((r) => r.lat != null).map((r, i) => {
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

      {locations.map((l) => {
        const lv = levelAt(l, horizon);
        if (!lv) return null;
        return (
          <Marker key={l.id} position={{ lat: l.lat, lng: l.lng }} title={placeName(l, lang)} zIndex={l.id === activeId ? 1000 : 100}
            label={{ text: PIN_LABEL[lv], color: '#ffffff', fontWeight: '700' }} onClick={() => onSelect(l.id)} />
        );
      })}
      <PanTo target={active ? { lat: active.lat, lng: active.lng } : null} />
      {children}
    </Map>
  );
}
