// Corridor watch map for the authority dashboard, following the team's citizen-portal map:
// a plain Google map with Google's own controls and classic pins labelled by risk level.
import { useEffect } from 'react';
import { Map, Marker, useMap } from '@vis.gl/react-google-maps';
import type { Level, LocationSnap } from '../../api/types';
import { GoogleMapsFrame } from '../../lib/googleMaps';
import { MAP_CENTER } from '../../lib/mapConfig';
import { placeName } from '../../lib/format';

/** Pin label per level: tick for calm, dot to watch, exclamation for danger. */
export const PIN_LABEL: Record<Level, string> = { low: '✓', moderate: '•', high: '!', critical: '!!' };

export const levelAt = (l: LocationSnap, horizon: number): Level | null =>
  !l.risk ? null : horizon === 0 ? l.risk.level : (l.risk.forecast?.find((f) => f.h === horizon)?.level || l.risk.level);

function PanTo({ target }: { target: google.maps.LatLngLiteral | null }) {
  const map = useMap();
  useEffect(() => { if (map && target) map.panTo(target); }, [map, target?.lat, target?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

type Props = { locations: LocationSnap[]; horizon: number; activeId: string | null; onSelect: (id: string) => void; lang: string };

export function WatchMap({ locations, horizon, activeId, onSelect, lang }: Props) {
  const active = locations.find((l) => l.id === activeId);
  return (
    <GoogleMapsFrame className="h-full w-full min-h-[440px]">
      {(cfg) => (
        <Map mapId={cfg.map_id} defaultCenter={MAP_CENTER} defaultZoom={9} mapTypeControl fullscreenControl zoomControl streetViewControl
          className="h-full w-full min-h-[440px]">
          {locations.map((l) => {
            const lv = levelAt(l, horizon);
            if (!lv) return null;
            return (
              <Marker key={l.id} position={{ lat: l.lat, lng: l.lng }} title={placeName(l, lang)} zIndex={l.id === activeId ? 1000 : undefined}
                label={{ text: PIN_LABEL[lv], color: '#ffffff', fontWeight: '700' }} onClick={() => onSelect(l.id)} />
            );
          })}
          <PanTo target={active ? { lat: active.lat, lng: active.lng } : null} />
        </Map>
      )}
    </GoogleMapsFrame>
  );
}
