// Small Google map for citizen screens (road detail, report pin). Loaded lazily to keep pages light.
import { Map, Polyline } from '@vis.gl/react-google-maps';
import { GoogleMapsFrame, MapDot, useMapColorScheme } from '../lib/googleMaps';
import { MAP_BOUNDS, MAP_MIN_ZOOM, toLatLng } from '../lib/mapConfig';

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

export default function MiniMap({ center, zoom = 11, line, lineColor = '#1F7A8C', pin, onPick, label, height = 220 }: Props) {
  const colorScheme = useMapColorScheme();
  return (
    <div className="rounded-card overflow-hidden border border-line" style={{ height }} role="region" aria-label={label}>
      <GoogleMapsFrame>
        {(cfg) => (
          <Map mapId={cfg.map_id} colorScheme={colorScheme} mapTypeId="roadmap" defaultCenter={toLatLng(center)} defaultZoom={zoom}
            minZoom={MAP_MIN_ZOOM} restriction={{ latLngBounds: MAP_BOUNDS, strictBounds: false }} gestureHandling="cooperative"
            disableDefaultUI zoomControl clickableIcons={false} style={{ width: '100%', height: '100%' }}
            onClick={onPick ? (e) => { const p = e.detail.latLng; if (p) onPick([p.lat, p.lng]); } : undefined}>
            {line && line.length > 1 && <Polyline path={line.map(toLatLng)} strokeColor={lineColor} strokeWeight={6} strokeOpacity={0.9} clickable={false} />}
            {pin && <MapDot position={toLatLng(pin)} radius={9} fill="#C62828" stroke="#fff" strokeWidth={3} />}
          </Map>
        )}
      </GoogleMapsFrame>
    </div>
  );
}
