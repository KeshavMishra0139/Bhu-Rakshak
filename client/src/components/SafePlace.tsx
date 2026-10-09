// "Nearest safe place" row: the closest listed relief shelter / safe assembly point to the place being viewed.
// The list is client/src/data/safe_places.SAMPLE.json. While it is sample data the row says so plainly and shows
// no Directions button, so nobody is sent to a made-up place; the button appears once the official list is in.
import { useTranslation } from 'react-i18next';
import { MapPin, Navigation } from 'lucide-react';
import data from '../data/safe_places.SAMPLE.json';
import { useRiskStream } from '../live/RiskStreamProvider';
import { googleDirectionsUrl } from '../lib/directions';
import { isDeva } from '../lib/format';

type Place = { id: string; name_en: string; name_hi: string; district: string; lat?: number; lng?: number; near?: string };
/** Only list places within this distance; further than that is no help in an emergency. */
const MAX_KM = 50;

const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

type Props = {
  from: { lat: number; lng: number } | null | undefined;
  /** Translate in another language than the interface (Saathi's answer language). */
  T?: (key: string, opts?: Record<string, unknown>) => string;
  lang?: string;
  /** card: inside an app card; saathi: inside the always-light Saathi panel. */
  tone?: 'card' | 'saathi';
};

export function SafePlace({ from, T, lang, tone = 'card' }: Props) {
  const { t, i18n } = useTranslation();
  const { locations } = useRiskStream();
  const tr = T || ((k: string, o?: Record<string, unknown>) => t(k, o));
  const lg = lang || i18n.language;
  const nearest = !from ? null : (data.places as Place[])
    .map((p) => {
      const at = p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : p.near && locations[p.near] ? { lat: locations[p.near].lat, lng: locations[p.near].lng } : null;
      return at ? { ...p, at, d: km(from, at) } : null;
    })
    .filter((p): p is NonNullable<typeof p> => !!p && p.d <= MAX_KM)
    .sort((a, b) => a.d - b.d)[0] || null;

  const box = tone === 'saathi' ? 'rounded-2xl border border-[#e1eaec] bg-white p-3.5 text-[#16242a]' : 'rounded-lg bg-surface-2 p-3';
  const muted = tone === 'saathi' ? 'text-[#3e5a63]' : 'text-muted';
  return (
    <div className={box}>
      <p className={`flex items-center gap-1.5 text-sm font-semibold ${muted}`}><MapPin size={15} aria-hidden />{tr('citizen.safe_place')}</p>
      {nearest ? (
        <>
          <p className="mt-1 font-bold leading-snug">
            {isDeva(lg) ? nearest.name_hi : nearest.name_en}
            <span className={`ml-1.5 font-normal ${muted}`}>· {nearest.d < 1 ? tr('citizen.safe_place_near') : tr('citizen.safe_place_km', { km: nearest.d < 10 ? nearest.d.toFixed(1) : Math.round(nearest.d) })}</span>
          </p>
          {data.sample ? (
            <p className="mt-1.5 inline-block rounded bg-[#fff3df] px-2 py-1 text-xs font-semibold text-[#7a4a12]">{tr('citizen.safe_place_sample')}</p>
          ) : (
            <a href={googleDirectionsUrl({ destination: nearest.at })} target="_blank" rel="noreferrer"
              className={tone === 'saathi' ? 'mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[#cbdde1] px-3.5 text-[14px] font-bold text-[#0b2a33] hover:bg-[#e4eff1]' : 'btn-secondary mt-2'}>
              <Navigation size={16} aria-hidden />{tr('citizen.safe_place_go')}
            </a>
          )}
        </>
      ) : <p className="mt-1 text-[0.95rem]">{tr('citizen.safe_place_none')}</p>}
    </div>
  );
}
