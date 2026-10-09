// Recent earthquake shaking at a location (National Center for Seismology, USGS as backup) and its nearest
// NCS seismograph. Shown next to the IMD panel in the station drawer.
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import type { SeismicSummary } from '../api/types';
import { dateTimeIST } from '../lib/format';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const roman = (mmi: number) => ROMAN[Math.max(1, Math.min(12, Math.round(mmi))) - 1];

export function SeismicPanel({ seismic, className = '' }: { seismic: SeismicSummary | null | undefined; className?: string }) {
  const { t, i18n } = useTranslation();
  if (!seismic) return null;
  const lang = i18n.language;
  const s = seismic.strongest;
  const felt = s && s.severity > 0;
  return (
    <section className={`rounded-lg border border-line p-3 space-y-2 ${className}`} aria-labelledby="seismic-title">
      <h3 id="seismic-title" className="font-semibold inline-flex items-center gap-1.5"><Activity size={17} aria-hidden />{t('seismic.title')}</h3>
      <p className="text-sm">
        {felt
          ? <span className="font-semibold text-risk-high">{t('seismic.shaken', { mmi: roman(s.mmi) })}</span>
          : <span className="font-semibold">{t('seismic.quiet')}</span>}
        {' '}<span className="text-muted">{t('seismic.events_7d', { count: seismic.events_7d })}</span>
      </p>
      {s && (
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-md bg-surface-2 p-2 col-span-2">
            <dt className="text-muted">{t('seismic.strongest')}</dt>
            <dd className="mt-0.5"><span className="font-bold">M{s.mag.toFixed(1)}</span> · {t('seismic.km_away', { km: s.distance_km })} · {t('seismic.depth_km', { km: Math.round(s.depth_km) })}
              <span className="block text-muted">{dateTimeIST(s.time, lang)} · {s.source}{s.place ? ` · ${s.place}` : ''}</span></dd>
          </div>
          <div className="rounded-md bg-surface-2 p-2">
            <dt className="text-muted">{t('seismic.intensity_here')}</dt>
            <dd className="mt-0.5 font-bold">{roman(s.mmi)} <span className="font-normal text-muted">({t(`seismic.mmi_${Math.max(1, Math.min(7, Math.round(s.mmi)))}`)})</span></dd>
          </div>
          {seismic.nearest_station && (
            <div className="rounded-md bg-surface-2 p-2">
              <dt className="text-muted">{t('seismic.nearest_station')}</dt>
              <dd className="mt-0.5 font-bold">{seismic.nearest_station.name} <span className="font-mono font-normal">[{seismic.nearest_station.code}]</span>
                <span className="block font-normal text-muted">{t('seismic.km_away', { km: seismic.nearest_station.distance_km })}</span></dd>
            </div>
          )}
        </dl>
      )}
      <p className="text-xs text-muted">{t('seismic.source')}</p>
    </section>
  );
}
