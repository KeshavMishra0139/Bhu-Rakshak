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
import { WatchStrip } from '../components/RiskMix';
import { ComparisonTable } from '../components/ComparisonTable';

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
            : <><Link to="/login" className="btn-ghost whitespace-nowrap">{t('common.sign_in')}</Link><Link to="/signup" className="btn-primary hidden sm:inline-flex">{t('landing.sign_up')}</Link></>}
        </div>
      </AppHeader>
      <main id="main">
        <section className="relative overflow-hidden bg-brand-deep text-on-brand">
          <Contours className="absolute -left-40 -bottom-40 w-[800px] h-[800px] text-[#7CC4CF] opacity-15 pointer-events-none" />
          <div className="relative mx-auto max-w-7xl px-5 py-12 lg:py-16 grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-center">
            <div>
              <h1 className="text-[2.5rem] lg:text-[3.4rem] font-semibold leading-[1.04] text-white text-balance">{t('landing.headline')}</h1>
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
                <div><dt className="text-sm text-on-brand/70">{t('landing.stat_monitored')}</dt><dd className="text-2xl sm:text-3xl font-bold text-white tabular-nums">{list.length || '–'}</dd></div>
                <div><dt className="text-sm text-on-brand/70">{t('landing.stat_watches')}</dt><dd className="text-2xl sm:text-3xl font-bold text-white tabular-nums">{list.length ? watches : '–'}</dd></div>
                <div><dt className="text-sm text-on-brand/70">{t('landing.stat_refresh')}</dt><dd className="text-2xl sm:text-3xl font-bold text-white tabular-nums">{weatherAt ? timeIST(weatherAt, i18n.language) : '–'}</dd></div>
              </dl>
              <div className="mt-6"><WatchStrip onDark /></div>
              <p className="mt-5 text-sm text-on-brand/65">{t('landing.open_data')}</p>
            </div>
            <div className="relative isolate">
              {/* A soft glow behind the map lifts it off the hero without a hard frame. */}
              <div aria-hidden className="absolute -inset-10 -z-10 rounded-[3rem] bg-[radial-gradient(closest-side,rgb(124_196_207/0.16),transparent)]" />
              <div className="h-[380px] lg:h-[460px] rounded-2xl overflow-hidden border border-white/15 shadow-2xl ring-1 ring-black/20">
                <Suspense fallback={<div className="h-full w-full bg-white/5 animate-pulse" />}><LandingMap /></Suspense>
              </div>
              <div className="absolute top-3 left-3 z-[500] rounded-lg bg-brand-deep/85 px-3 py-1.5 flex items-center gap-3">
                <LiveIndicator onDark /><span className="text-xs text-on-brand/70">{updated}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-14" aria-labelledby="how">
          <h2 id="how" className="text-2xl font-semibold">{t('landing.how_title')}</h2>
          {/* The four steps as one flow: a line joins the icons on wide screens (the order is already the list's). */}
          <ol className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
            {STEPS.map(([k, Icon], i) => (
              <li key={k} className="relative">
                <div className="flex items-center gap-3">
                  <span className="relative z-[1] h-12 w-12 rounded-2xl bg-brand/12 text-brand ring-1 ring-brand/20 inline-flex items-center justify-center"><Icon size={22} aria-hidden /></span>
                  {i < STEPS.length - 1 && <span aria-hidden className="hidden lg:block h-px flex-1 bg-gradient-to-r from-brand/40 to-brand/5" />}
                </div>
                <h3 className="mt-4 text-xl font-semibold">{t(`landing.${k}`)}</h3>
                <p className="mt-1.5 max-w-[34ch] text-muted">{t(`landing.${k}_d`)}</p>
              </li>
            ))}
          </ol>
        </section>
        <ComparisonTable className="mx-auto max-w-7xl px-5 pb-14" />
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto max-w-7xl px-5 py-6 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>{t('app.team')}</span>
          <span className="flex flex-wrap gap-4">
            <Link to="/hindcast" className="font-semibold text-brand hover:underline">{t('hindcast.link')}</Link>
            <Link to="/about" className="font-semibold text-brand hover:underline">{t('about.title')}</Link>
          </span>
        </div>
      </footer>
    </>
  );
}
