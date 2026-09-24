// "In-person view": switches the watch map itself into Google Street View at the nearest street-level imagery
// to the selected place (or a clicked spot). Uses the map's own panorama, so the officer toggles between
// Map and In-person view in one map area, and Google's pegman does the same.
import { useEffect, useRef } from 'react';
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps';

/** Search radii in metres: close first, then wider (mountain roads have sparse coverage). */
export const RADII = [300, 2000, 10000];

export type ViewTarget = { lat: number; lng: number; label: string };
export type StreetStatus =
  | { state: 'idle' | 'loading' | 'none' }
  | { state: 'found'; panoId: string; distanceM: number; description: string | null };

const distanceM = (a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral) => {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Compass bearing in degrees from a to b. */
const bearing = (a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral) => {
  const rad = Math.PI / 180;
  const dLng = (b.lng - a.lng) * rad;
  const y = Math.sin(dLng) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos(dLng);
  return (Math.atan2(y, x) / rad + 360) % 360;
};

type Props = {
  /** In-person mode is on. Turning it off returns the map area to the map. */
  enabled: boolean;
  target: ViewTarget | null;
  onStatus: (s: StreetStatus) => void;
  /** Street view shown or hidden (including via Google's pegman). */
  onVisibleChange: (visible: boolean) => void;
};

/** Render inside <Map>. Drives the map's built-in street view; draws nothing itself. */
export function InPersonController({ enabled, target, onStatus, onVisibleChange }: Props) {
  const map = useMap();
  const svLib = useMapsLibrary('streetView');
  const cb = useRef({ onStatus, onVisibleChange });
  cb.current = { onStatus, onVisibleChange };

  useEffect(() => {
    if (!map) return;
    const sv = map.getStreetView();
    // Our Map / In-person toggle replaces Google's back arrow; the map already has its own fullscreen button.
    sv.setOptions({ addressControl: true, enableCloseButton: false, fullscreenControl: false, motionTracking: false, zoomControl: true });
    const l = sv.addListener('visible_changed', () => cb.current.onVisibleChange(sv.getVisible()));
    return () => { l.remove(); sv.setVisible(false); };
  }, [map]);

  useEffect(() => {
    if (!map || !svLib) return;
    const sv = map.getStreetView();
    if (!enabled) { sv.setVisible(false); cb.current.onStatus({ state: 'idle' }); return; }
    if (!target) { cb.current.onStatus({ state: 'idle' }); return; }
    let cancelled = false;
    const service = new svLib.StreetViewService();
    cb.current.onStatus({ state: 'loading' });
    (async () => {
      for (const radius of RADII) {
        try {
          const { data } = await service.getPanorama({
            location: target, radius, preference: svLib.StreetViewPreference.NEAREST, sources: [svLib.StreetViewSource.OUTDOOR],
          });
          const loc = data.location;
          if (cancelled) return;
          if (loc?.pano && loc.latLng) {
            const pos = loc.latLng.toJSON();
            sv.setPano(loc.pano);
            // Face from the imagery towards the chosen point, so the place is in front of the viewer.
            sv.setPov({ heading: bearing(pos, target), pitch: 0 });
            sv.setVisible(true);
            cb.current.onStatus({ state: 'found', panoId: loc.pano, distanceM: distanceM(target, pos), description: loc.description || null });
            return;
          }
        } catch { /* ZERO_RESULTS at this radius: try wider */ }
      }
      if (!cancelled) { sv.setVisible(false); cb.current.onStatus({ state: 'none' }); }
    })();
    return () => { cancelled = true; };
  }, [map, svLib, enabled, target?.lat, target?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
