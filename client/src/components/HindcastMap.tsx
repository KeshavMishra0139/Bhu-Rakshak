// Map for the hindcast page: the landslide site (X), the live system's monitoring point coloured by its level at
// the selected hour, and a dashed line between them with the distance.
import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { Level } from '../api/types';
import { useTheme } from '../theme/ThemeProvider';
import { BASEMAPS, basemapNativeZoom, basemapOverlays, basemapUrl } from '../lib/mapConfig';
import { levelVar } from '../lib/risk';

const siteIcon = L.divIcon({
  className: '',
  iconSize: [30, 30], iconAnchor: [15, 15], tooltipAnchor: [0, -16],
  html: '<span class="hc-site" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></span>',
});
const stationIcon = (level: Level) => L.divIcon({
  className: '',
  iconSize: [22, 22], iconAnchor: [11, 11], tooltipAnchor: [0, -12],
  html: `<span class="hc-station" style="background:${levelVar(level)}" aria-hidden="true"></span>`,
});

function Fit({ a, b }: { a: [number, number]; b: [number, number] }) {
  const map = useMap();
  useEffect(() => { map.fitBounds(L.latLngBounds([a, b]), { padding: [48, 48], maxZoom: 14 }); }, [map, a[0], a[1], b[0], b[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

type Props = {
  site: [number, number]; station: [number, number]; level: Level;
  siteLabel: string; stationLabel: string;
};

export default function HindcastMap({ site, station, level, siteLabel, stationLabel }: Props) {
  const { resolved } = useTheme();
  const base = BASEMAPS.find((b) => b.id === 'street')!;
  return (
    <MapContainer center={site} zoom={13} scrollWheelZoom={false} className="h-full w-full">
      <TileLayer key={resolved} url={basemapUrl(base, resolved)} attribution={base.attribution} maxZoom={base.maxZoom} maxNativeZoom={basemapNativeZoom(base, resolved)} subdomains={base.subdomains || 'abc'} />
      {basemapOverlays(base, resolved).map((o) => <TileLayer key={`${resolved}-${o.url}`} url={o.url} subdomains={o.subdomains || 'abc'} maxZoom={base.maxZoom} maxNativeZoom={o.nativeZoom ?? basemapNativeZoom(base, resolved)} />)}
      <Polyline positions={[site, station]} interactive={false} pathOptions={{ color: '#5d7364', weight: 2, dashArray: '6 6' }} />
      <Marker position={site} icon={siteIcon}><Tooltip direction="top" permanent>{siteLabel}</Tooltip></Marker>
      <Marker position={station} icon={stationIcon(level)}><Tooltip direction="top" permanent>{stationLabel}</Tooltip></Marker>
      <Fit a={site} b={station} />
    </MapContainer>
  );
}
