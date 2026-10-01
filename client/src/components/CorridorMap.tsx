// Map for the corridor checker: the route as ~2 km segments coloured by risk, an optional alternative (dashed
// blue), start and end pins, the monitored places, and click-to-pick for the start or end point.
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo } from 'react';
import L from 'leaflet';
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import type { LocationSnap } from '../api/types';
import { useTheme } from '../theme/ThemeProvider';
import { BASEMAPS, WATCH_BOUNDS, MAP_CENTER, basemapNativeZoom, basemapOverlays, basemapUrl } from '../lib/mapConfig';
import { SEG_COLOR_NONE, segLevel, type CorridorRoute, type LatLng } from '../lib/corridor';
import { levelVar } from '../lib/risk';
import { placeName } from '../lib/format';

const endIcon = (letter: string, color: string) => L.divIcon({
  className: 'watch-pin',
  iconSize: [26, 37], iconAnchor: [13, 37], tooltipAnchor: [0, -34],
  html: `<svg width="26" height="37" viewBox="0 0 26 37" aria-hidden="true"><path d="M13 0.8C6.2 0.8 0.8 6.2 0.8 13c0 9.4 12.2 23.2 12.2 23.2S25.2 22.4 25.2 13C25.2 6.2 19.8 0.8 13 0.8z" fill="${color}" stroke="#fff" stroke-width="1.6"/></svg><span>${letter}</span>`,
});
const START = endIcon('A', '#2d765b');
const END = endIcon('B', '#15241c');

function Fit({ route, start, end }: { route: CorridorRoute | null; start: LatLng | null; end: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    const pts = route ? route.segments.flatMap((s) => s.coords) : [start, end].filter(Boolean) as LatLng[];
    if (!pts.length) return;
    if (pts.length === 1) { map.setView(pts[0], Math.max(map.getZoom(), 11)); return; }
    map.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 13 });
  }, [route, start?.[0], start?.[1], end?.[0], end?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
function Picker({ onPick }: { onPick?: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onPick?.([+e.latlng.lat.toFixed(5), +e.latlng.lng.toFixed(5)]) });
  return null;
}
function Resize() {
  const map = useMap();
  useEffect(() => { const ro = new ResizeObserver(() => map.invalidateSize()); ro.observe(map.getContainer()); return () => ro.disconnect(); }, [map]);
  return null;
}

type Props = {
  route: CorridorRoute | null;
  alternative: CorridorRoute | null;
  showAlt: boolean;
  start: LatLng | null;
  end: LatLng | null;
  locations: Record<string, LocationSnap>;
  list: LocationSnap[];
  picking: boolean;
  onPick?: (p: LatLng) => void;
  selected: number | null;
  onSelect: (i: number) => void;
};

export default function CorridorMap({ route, alternative, showAlt, start, end, locations, list, picking, onPick, selected, onSelect }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { resolved } = useTheme();
  const base = BASEMAPS.find((b) => b.id === 'street')!;
  const fitTo = useMemo(() => (showAlt && alternative ? alternative : route), [showAlt, alternative, route]);

  return (
    <MapContainer center={MAP_CENTER} zoom={9} minZoom={7} maxBounds={WATCH_BOUNDS} maxBoundsViscosity={0.7} zoomControl={false}
      className={`h-full w-full ${picking ? 'cursor-crosshair' : ''}`}>
      <TileLayer key={resolved} url={basemapUrl(base, resolved)} attribution={base.attribution} maxZoom={base.maxZoom} maxNativeZoom={basemapNativeZoom(base, resolved)} subdomains={base.subdomains || 'abc'} />
      {basemapOverlays(base, resolved).map((o) => <TileLayer key={`${resolved}-${o.url}`} url={o.url} subdomains={o.subdomains || 'abc'} maxZoom={base.maxZoom} maxNativeZoom={o.nativeZoom ?? basemapNativeZoom(base, resolved)} />)}

      {list.filter((l) => l.risk).map((l) => (
        <CircleMarker key={l.id} center={[l.lat, l.lng]} radius={5} interactive
          pathOptions={{ color: '#fff', weight: 1.5, fillColor: levelVar(l.risk!.level), fillOpacity: 0.95 }}>
          <Tooltip>{placeName(l, lang)} · {t(`levels.${l.risk!.level}`)}</Tooltip>
        </CircleMarker>
      ))}

      {showAlt && alternative && (
        <Polyline positions={alternative.segments.flatMap((s) => s.coords)} pathOptions={{ color: '#1a73e8', weight: 6, opacity: 0.85, dashArray: '10 8' }}>
          <Tooltip sticky>{t('corridor.alt_line')}</Tooltip>
        </Polyline>
      )}
      {/* White casing under every segment, then the coloured segments on top. */}
      {route && route.segments.map((s, i) => (
        <Polyline key={`c-${i}`} positions={s.coords} interactive={false} pathOptions={{ color: '#fff', weight: selected === i ? 13 : 10, opacity: 0.9 }} />
      ))}
      {route && route.segments.map((s, i) => {
        const lv = segLevel(s, locations);
        return (
          <Polyline key={`s-${i}`} positions={s.coords} eventHandlers={{ click: () => onSelect(i) }}
            pathOptions={{ color: lv === 'none' ? SEG_COLOR_NONE : levelVar(lv), weight: selected === i ? 9 : 6, opacity: showAlt && alternative ? 0.55 : 1 }}>
            <Tooltip sticky>
              {t('corridor.seg_n', { n: i + 1 })} · {lv === 'none' ? t('corridor.not_monitored') : t(`levels.${lv}`)}
              {s.place_id && locations[s.place_id] ? ` · ${t('corridor.near', { place: placeName(locations[s.place_id], lang), km: s.place_km })}` : ''}
            </Tooltip>
          </Polyline>
        );
      })}

      {start && <Marker position={start} icon={START} zIndexOffset={1500} keyboard={false}><Tooltip direction="top">{t('corridor.start')}</Tooltip></Marker>}
      {end && <Marker position={end} icon={END} zIndexOffset={1500} keyboard={false}><Tooltip direction="top">{t('corridor.end')}</Tooltip></Marker>}

      <Fit route={fitTo} start={start} end={end} />
      <Picker onPick={picking ? onPick : undefined} />
      <Resize />
      <ZoomControl position="bottomright" zoomInTitle={t('map.zoom_in')} zoomOutTitle={t('map.zoom_out')} />
    </MapContainer>
  );
}
