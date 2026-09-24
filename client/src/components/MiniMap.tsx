// Small Leaflet map for citizen screens (road detail, report pin). Loaded lazily to keep pages light.
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Polyline, CircleMarker, useMapEvents } from 'react-leaflet';
import { useTheme } from '../theme/ThemeProvider';
import { BASEMAPS, MAP_BOUNDS } from '../lib/mapConfig';

type Props = {
  center: [number, number];
  zoom?: number;
  line?: [number, number][];
  lineColor?: string;
  pin?: [number, number] | null;
  onPick?: (latlng: [number, number]) => void;
  label: string;
  height?: number;
};

function Picker({ onPick }: { onPick: (l: [number, number]) => void }) {
  useMapEvents({ click: (e) => onPick([e.latlng.lat, e.latlng.lng]) });
  return null;
}

export default function MiniMap({ center, zoom = 11, line, lineColor = '#1F7A8C', pin, onPick, label, height = 220 }: Props) {
  const { resolved } = useTheme();
  const street = BASEMAPS.find((b) => b.id === 'street')!;
  const url = typeof street.url === 'function' ? street.url(resolved) : street.url;
  return (
    <div className="rounded-card overflow-hidden border border-line" style={{ height }} role="region" aria-label={label}>
      <MapContainer center={center} zoom={zoom} minZoom={8} maxBounds={MAP_BOUNDS} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
        <TileLayer url={url} attribution={street.attribution} subdomains={street.subdomains} />
        {line && line.length > 1 && <Polyline positions={line} pathOptions={{ color: lineColor, weight: 6, opacity: 0.9 }} />}
        {pin && <CircleMarker center={pin} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: '#C62828', fillOpacity: 1 }} />}
        {onPick && <Picker onPick={onPick} />}
      </MapContainer>
    </div>
  );
}
