// Home card: the landslide warning signs people should watch for. Each sign opens the report form with that sign
// already chosen; "Report it" opens the form as it is. Sign names are the report form's own labels.
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Droplets, Megaphone, Mountain, TreePine, Zap, type LucideIcon } from 'lucide-react';
import { withPane } from '../lib/viewAs';

const SIGNS: { type: string; Icon: LucideIcon }[] = [
  { type: 'crack', Icon: Zap },
  { type: 'water_seepage', Icon: Droplets },
  { type: 'tilting', Icon: TreePine },
  { type: 'rockfall', Icon: Mountain },
];

export function WarningSigns() {
  const { t } = useTranslation();
  return (
    <section className="card p-5 lg:col-span-2" aria-labelledby="signs-title">
      <h2 id="signs-title" className="text-lg font-semibold">{t('citizen.signs_title')}</h2>
      <p className="text-muted">{t('citizen.signs_body')}</p>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {SIGNS.map(({ type, Icon }) => (
          <li key={type}>
            <Link to={withPane(`/citizen/report?type=${type}`)} className="flex h-full min-h-[64px] items-center gap-3 rounded-lg border border-line p-3 font-semibold leading-snug hover:bg-surface-2">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand"><Icon size={20} aria-hidden /></span>
              {t(`reports.ty_${type}`)}
            </Link>
          </li>
        ))}
      </ul>
      <Link to={withPane('/citizen/report')} className="btn-primary mt-4 w-full sm:w-auto"><Megaphone size={18} aria-hidden />{t('citizen.report_it')}</Link>
    </section>
  );
}
