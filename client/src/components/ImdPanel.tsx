// Official IMD district warning (today + next two days) and any active nowcast.
// IMD's API guidelines require attribution, so the source line is always shown with the data.
import { useTranslation } from 'react-i18next';
import { CloudRain } from 'lucide-react';
import type { ImdColor, ImdSummary } from '../api/types';
import { timeIST } from '../lib/format';

// IMD's own colour scale, with dark text on yellow for contrast.
const CHIP: Record<ImdColor, string> = {
  green: 'bg-[#2e7d32] text-white',
  yellow: 'bg-[#f2c200] text-[#3a2e00]',
  orange: 'bg-[#ef7d00] text-white',
  red: 'bg-[#c62828] text-white',
};
const DAY_KEYS = ['imd.today', 'imd.tomorrow', 'imd.day3'];

export function ImdPanel({ imd, className = '' }: { imd: ImdSummary | null | undefined; className?: string }) {
  const { t, i18n } = useTranslation();
  if (!imd) return null;
  const lang = i18n.language;
  const colorLabel = (c: ImdColor | null) => (c ? t(`imd.color_${c}`) : t('imd.none'));
  return (
    <section className={`rounded-lg border border-line p-3 space-y-2 ${className}`} aria-labelledby="imd-title">
      <h3 id="imd-title" className="font-bold inline-flex items-center gap-1.5"><CloudRain size={17} aria-hidden />{t('imd.title')}</h3>
      {imd.nowcast && (
        <div className="text-sm">
          <p className="font-semibold">{t('imd.nowcast')}
            {imd.nowcast.valid_until && <span className="font-normal text-muted"> · {t('imd.valid_until', { time: timeIST(imd.nowcast.valid_until, lang) })}</span>}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5">
            {imd.nowcast.color && <span className={`rounded-pill px-2 py-0.5 text-xs font-bold ${CHIP[imd.nowcast.color]}`}>{colorLabel(imd.nowcast.color)}</span>}
            <span>{imd.nowcast.cats.map((c) => t(`imd.n_${c}`, { defaultValue: '' })).filter(Boolean).join(' · ')}</span>
          </p>
        </div>
      )}
      {imd.days.length > 0 && (
        <dl className="grid grid-cols-3 gap-2 text-sm">
          {imd.days.map((d, i) => (
            <div key={i} className="rounded-md bg-surface-2 p-2">
              <dt className="text-muted">{t(DAY_KEYS[i])}</dt>
              <dd className="mt-1 space-y-1">
                <span className={`inline-block rounded-pill px-2 py-0.5 text-xs font-bold ${d.color ? CHIP[d.color] : 'bg-surface text-muted'}`}>{colorLabel(d.color)}</span>
                {d.codes.length > 0 && <span className="block">{d.codes.map((c) => t(`imd.w_${c}`, { defaultValue: '' })).filter(Boolean).join(', ')}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-xs text-muted">{t('imd.source')}</p>
    </section>
  );
}
