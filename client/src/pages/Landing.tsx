import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CloudRain, Map, BadgeCheck, Siren } from 'lucide-react';
import { useAuth, homePathFor } from '../auth/AuthProvider';
import { useRiskStream } from '../live/RiskStreamProvider';
import { AppHeader } from '../components/AppHeader';
import { LiveIndicator } from '../components/LiveIndicator';
import { Contours } from '../components/Contours';
import { useUpdatedLabel } from '../components/UpdatedAgo';
import { timeIST } from '../lib/format';

const LandingMap = lazy(() => import('../components/LandingMap'));
const STEPS = [['predict', CloudRain], ['visualize', Map], ['verify', BadgeCheck], ['warn', Siren]] as const;

export default function Landing() {
  const { t, i18n } = useTranslation();
  const { me } = useAuth();
  const { list, weatherAt, lastUpdateAt } = useRiskStream();
  const watches = list.filter((l) => l.risk && (l.risk.level === 'high' || l.risk.level === 'critical')).length;
  const updated = useUpdatedLabel(lastUpdateAt);

  return (
    <>
      <AppHeader>
        <div className="flex justify-end gap-2">
          {me ? <Link to={homePathFor(me)} className="btn-primary">{t('landing.open_live')}</Link>
            : <><Link to="/login" className="btn-ghost">{t('common.sign_in')}</Link><Link to="/signup" className="btn-primary hidden sm:inline-flex">{t('landing.sign_up')}</Link></>}
        </div>
      </AppHeader>
      <main id="main">
        <section className="relative overflow-hidden bg-brand-deep text-on-brand">
          <Contours className="absolute -left-40 -bottom-40 w-[800px] h-[800px] text-[#7CC4CF] opacity-15 pointer-events-none" />
          <div className="relative mx-auto max-w-7xl px-5 py-12 lg:py-16 grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-center">
            <div>
              <h1 className="text-[2.5rem] lg:text-[3.4rem] font-bold leading-[1.04] text-white text-balance">{t('landing.headline')}</h1>
              <p className="mt-5 max-w-xl text-[1.15rem] text-on-brand/85">{t('landing.one_line')}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                {me ? <Link to={homePathFor(me)} className="btn bg-white text-brand-deep hover:bg-white/90">{t('landing.open_live')}</Link> : (
                  <>
                    <Link to="/signup" className="btn bg-white text-brand-deep hover:bg-white/90">{t('landing.for_residents')}</Link>
                    <Link to="/login" className="btn border border-white/30 text-white hover:bg-white/10">{t('landing.for_officials')}</Link>
                  </>
                )}
              </div>
              <dl className="mt-10 grid grid-cols-3 gap-4 max-w-lg">
                <div><dt className="text-sm text-on-brand/70">{t('landing.stat_monitored')}</dt><dd className="text-3xl font-bold text-white tabular-nums">{list.length || '–'}</dd></div>
                <div><dt className="text-sm text-on-brand/70">{t('landing.stat_watches')}</dt><dd className="text-3xl font-bold text-white tabular-nums">{list.length ? watches : '–'}</dd></div>
                <div><dt className="text-sm text-on-brand/70">{t('landing.stat_refresh')}</dt><dd className="text-3xl font-bold text-white tabular-nums">{weatherAt ? timeIST(weatherAt, i18n.language) : '–'}</dd></div>
              </dl>
            </div>
            <div className="relative">
              <div className="h-[380px] lg:h-[460px] rounded-2xl overflow-hidden border border-white/15 shadow-2xl">
                <Suspense fallback={<div className="h-full w-full bg-white/5 animate-pulse" />}><LandingMap /></Suspense>
              </div>
              <div className="absolute top-3 left-3 z-[500] rounded-lg bg-brand-deep/85 px-3 py-1.5 flex items-center gap-3">
                <LiveIndicator onDark /><span className="text-xs text-on-brand/70">{updated}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-14" aria-labelledby="how">
          <h2 id="how" className="text-2xl font-bold">{t('landing.how_title')}</h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([k, Icon], i) => (
              <li key={k} className="relative">
                <div className="flex items-center gap-3">
                  <span className="h-11 w-11 rounded-full bg-brand/12 text-brand inline-flex items-center justify-center"><Icon size={22} aria-hidden /></span>
                  <span className="font-mono text-sm text-muted">{i + 1} / 4</span>
                </div>
                <h3 className="mt-3 text-xl font-bold">{t(`landing.${k}`)}</h3>
                <p className="mt-1 text-muted">{t(`landing.${k}_d`)}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto max-w-7xl px-5 py-6 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>{t('app.team')}</span>
          <Link to="/about" className="font-semibold text-brand hover:underline">{t('about.title')}</Link>
        </div>
      </footer>
    </>
  );
}
