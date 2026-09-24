// Live mini-map for the landing page: corridors coloured by their current worst risk level.
import { useEffect, useState } from 'react';
import { Map, Polyline } from '@vis.gl/react-google-maps';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { Road } from '../api/types';
import { useRiskStream } from '../live/RiskStreamProvider';
import { GoogleMapsFrame, MapDot, useLevelColor } from '../lib/googleMaps';
import { MAP_BOUNDS } from '../lib/mapConfig';
import { LEVEL_RANK, levelVar } from '../lib/risk';
import { placeName } from '../lib/format';
import type { Level } from '../api/types';

export default function LandingMap() {
  const { t, i18n } = useTranslation();
  const { locations, list } = useRiskStream();
  const levelColor = useLevelColor();
  const [roads, setRoads] = useState<Road[]>([]);
  useEffect(() => { api.get<{ roads: Road[] }>('/roads').then((d) => setRoads(d.roads)).catch(() => {}); }, []);
  const worst = (ids: string[]) => ids.reduce<Level>((w, id) => { const lv = locations[id]?.risk?.level; return lv && LEVEL_RANK[lv] > LEVEL_RANK[w] ? lv : w; }, 'low');
  return (
    <GoogleMapsFrame>
      {(cfg) => (
        <Map mapId={cfg.map_id} mapTypeId="hybrid" defaultCenter={{ lat: 27.3, lng: 88.45 }} defaultZoom={8}
          restriction={{ latLngBounds: MAP_BOUNDS, strictBounds: false }} gestureHandling="none" disableDefaultUI keyboardShortcuts={false}
          clickableIcons={false} style={{ width: '100%', height: '100%' }}>
          {roads.map((r) => {
            const pts = r.path.map((id) => locations[id]).filter(Boolean).map((l) => ({ lat: l.lat, lng: l.lng }));
            return <Polyline key={r.id} path={pts} strokeColor={levelColor(worst(r.path))} strokeWeight={5} strokeOpacity={0.95} clickable={false} />;
          })}
          {list.filter((l) => l.risk).map((l) => (
            <MapDot key={l.id} position={{ lat: l.lat, lng: l.lng }} radius={l.risk!.level === 'critical' ? 8 : l.risk!.level === 'high' ? 7 : 5}
              fill={levelVar(l.risk!.level)} stroke="#fff" strokeWidth={1.5} title={`${placeName(l, i18n.language)}: ${t(`levels.${l.risk!.level}`)}`} />
          ))}
        </Map>
      )}
    </GoogleMapsFrame>
  );
}
