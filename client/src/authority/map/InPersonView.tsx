// "In-person view": real Google Street View for a chosen spot, shown in the map area through Google's
// standard "Embed a map" iframe (free, no API key). The iframe includes Google's own navigation arrows,
// compass and "View on Google Maps" link; where Google has no imagery it says "No Street View available".
import { useTranslation } from 'react-i18next';
import { streetViewEmbedUrl } from '../../lib/mapConfig';

export type ViewTarget = { lat: number; lng: number; label: string };

export function InPersonView({ target }: { target: ViewTarget }) {
  const { t } = useTranslation();
  const src = streetViewEmbedUrl(target.lat, target.lng);
  return (
    <iframe key={src} src={src} title={`${t('map.in_person')}: ${target.label}`} className="absolute inset-0 h-full w-full border-0 bg-black"
      loading="lazy" allowFullScreen referrerPolicy="no-referrer-when-downgrade" />
  );
}
