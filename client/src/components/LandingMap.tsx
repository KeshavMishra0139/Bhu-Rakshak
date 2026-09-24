// Live mini-map for the landing page: corridors coloured by their current worst risk level.
import 'leaflet/dist/leaflet.css';
import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { Road } from '../api/types';
import { useRiskStream } from '../live/RiskStreamProvider';
import { BASEMAPS, MAP_BOUNDS, basemapOverlays } from '../lib/mapConfig';
import { LEVEL_RANK, levelVar } from '../lib/risk';
import { placeName } from '../lib/format';
import type { Level } from '../api/types';

export default function LandingMap() {
  const { t, i18n } = useTranslation();
  const { locations, list } = useRiskStream();
  const [roads, setRoads] = useState<Road[]>([]);
  useEffect(() => { api.get<{ roads: Road[] }>('/roads').then((d) => setRoads(d.roads)).catch(() => {}); }, []);
  const sat = BASEMAPS[0];
  const worst = (ids: string[]) => ids.reduce<Level>((w, id) => { const lv = locations[id]?.risk?.level; return lv && LEVEL_RANK[lv] > LEVEL_RANK[w] ? lv : w; }, 'low');
  return (
    <MapContainer center={[27.3, 88.45]} zoom={8} minZoom={8} maxBounds={MAP_BOUNDS} dragging={false} scrollWheelZoom={false} doubleClickZoom={false}
      zoomControl={false} touchZoom={false} keyboard={false} boxZoom={false} className="h-full w-full" attributionControl>
      <TileLayer url={sat.url as string} attribution={sat.attribution} />
      {basemapOverlays(sat, 'light').map((o) => <TileLayer key={o.url} url={o.url} subdomains={o.subdomains || 'abc'} />)}
      {roads.map((r) => {
        const pts = r.path.map((id) => locations[id]).filter(Boolean).map((l) => [l.lat, l.lng] as [number, number]);
        return <Polyline key={r.id} positions={pts} pathOptions={{ color: levelVar(worst(r.path)), weight: 5, opacity: 0.95 }} />;
      })}
      {list.filter((l) => l.risk).map((l) => (
        <CircleMarker key={l.id} center={[l.lat, l.lng]} radius={l.risk!.level === 'critical' ? 8 : l.risk!.level === 'high' ? 7 : 5}
          pathOptions={{ color: '#fff', weight: 1.5, fillColor: levelVar(l.risk!.level), fillOpacity: 1 }}>
          <Tooltip>{placeName(l, i18n.language)}: {t(`levels.${l.risk!.level}`)}</Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
