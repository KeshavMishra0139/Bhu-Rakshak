// "In-person view": Google Street View beside the watch map, showing street-level imagery nearest to the
// selected place or to wherever the officer clicks. Linked to the map, so the map shows where the viewer stands.
import { useEffect, useRef, useState } from 'react';
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Loader2, PersonStanding, X } from 'lucide-react';

/** Search radii in metres: close first, then wider (mountain roads have sparse coverage). */
const RADII = [300, 2000, 10000];

export type ViewTarget = { lat: number; lng: number; label: string };
type Found = { panoId: string; pos: google.maps.LatLngLiteral; distanceM: number; description: string | null };

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

export function InPersonView({ target, onClose }: { target: ViewTarget | null; onClose: () => void }) {
  const { t } = useTranslation();
  const map = useMap();
  const svLib = useMapsLibrary('streetView');
  const el = useRef<HTMLDivElement>(null);
  const pano = useRef<google.maps.StreetViewPanorama | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'found' | 'none'>('idle');
  const [found, setFound] = useState<Found | null>(null);

  // One panorama for the panel's lifetime, linked to the map (the map then shows the viewer's position).
  useEffect(() => {
    if (!svLib || !el.current || pano.current) return;
    pano.current = new svLib.StreetViewPanorama(el.current, {
      visible: false, addressControl: true, fullscreenControl: true, motionTracking: false, enableCloseButton: false, zoomControl: true,
    });
    if (map) map.setStreetView(pano.current);
    return () => {
      if (map) map.setStreetView(null);
      pano.current?.setVisible(false);
      pano.current = null;
    };
  }, [svLib, map]);

  // Find the nearest outdoor imagery to the target, widening the search if needed.
  useEffect(() => {
    if (!svLib || !target || !pano.current) return;
    let cancelled = false;
    const service = new svLib.StreetViewService();
    setState('loading');
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
            // Face from the imagery towards the requested point, so the place is in front of the viewer.
            const heading = bearing(pos, target);
            pano.current!.setPano(loc.pano);
            pano.current!.setPov({ heading, pitch: 0 });
            pano.current!.setVisible(true);
            setFound({ panoId: loc.pano, pos, distanceM: distanceM(target, pos), description: loc.description || null });
            setState('found');
            return;
          }
        } catch { /* ZERO_RESULTS at this radius: try wider */ }
      }
      if (!cancelled) { pano.current?.setVisible(false); setFound(null); setState('none'); }
    })();
    return () => { cancelled = true; };
  }, [svLib, target?.lat, target?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const km = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

  return (
    <section className="relative flex flex-col min-h-[320px] h-full bg-[#15241c] text-white" aria-labelledby="inperson-title">
      <header className="flex items-start gap-2 px-3 py-2 border-b border-white/10">
        <PersonStanding size={18} className="mt-0.5 text-[#9dc6a5] shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="inperson-title" className="text-sm font-bold">{t('map.in_person')}{target ? ` · ${target.label}` : ''}</h2>
          <p className="text-[11px] text-[#91a297] truncate" role="status">
            {state === 'loading' && t('map.in_person_loading')}
            {state === 'found' && found && (found.distanceM > 150 ? t('map.in_person_dist', { d: km(found.distanceM) }) : (found.description || t('map.in_person_here')))}
            {state === 'none' && t('map.in_person_none', { d: km(RADII[RADII.length - 1]) })}
            {state === 'idle' && t('map.in_person_hint')}
          </p>
        </div>
        {found && state === 'found' && (
          <a className="shrink-0 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-[#d7efd8] hover:bg-white/10"
            href={`https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(found.panoId)}`} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={13} aria-hidden />{t('map.in_person_open')}
          </a>
        )}
        <button type="button" onClick={onClose} className="shrink-0 p-1 rounded-lg hover:bg-white/10" aria-label={t('map.in_person_close')}><X size={16} aria-hidden /></button>
      </header>
      <div className="relative flex-1 min-h-[260px]">
        <div ref={el} className="absolute inset-0" />
        {state !== 'found' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-[#b9c8bd]">
            {state === 'loading' ? <Loader2 size={22} className="animate-spin" aria-hidden /> : <PersonStanding size={28} className="text-[#9dc6a5]" aria-hidden />}
            <p className="max-w-xs">{state === 'none' ? t('map.in_person_none', { d: km(RADII[RADII.length - 1]) }) : state === 'loading' ? t('map.in_person_loading') : t('map.in_person_hint')}</p>
          </div>
        )}
      </div>
    </section>
  );
}
