import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Contours } from '../components/Contours';
import { Logo } from '../components/Logo';
import { LiveIndicator } from '../components/LiveIndicator';
import { RiskBadge } from '../components/RiskBadge';
import { UpdatedAgo } from '../components/UpdatedAgo';
import { useRiskStream } from '../live/RiskStreamProvider';
import { placeName } from '../lib/format';

/** Left panel on sign-in / sign-up: brand, purpose, and the live state of the region. */
export function BrandPanel() {
  const { t, i18n } = useTranslation();
  const { list, lastUpdateAt } = useRiskStream();
  const top = list.filter((l) => l.risk).slice(0, 4);
  return (
    <aside className="relative overflow-hidden bg-brand-deep text-on-brand px-6 py-6 lg:px-10 lg:py-10 flex flex-col">
      <Contours className="absolute -right-24 -top-10 w-[720px] h-[720px] text-[#7CC4CF] opacity-[0.22] pointer-events-none" />
      <Link to="/" className="relative self-start"><Logo onDark /></Link>
      <div className="relative mt-10 lg:mt-auto max-w-md hidden sm:block">
        <p className="font-display text-[2rem] lg:text-[2.4rem] font-bold leading-[1.1] tracking-[-0.02em] text-white text-balance">{t('landing.headline')}</p>
        <p className="mt-3 text-on-brand/80 text-[1.02rem]">{t('app.tagline')}</p>
      </div>
      <section className="relative mt-8 lg:mt-12 max-w-md" aria-labelledby="live-strip">
        <div className="flex items-center justify-between gap-3">
          <h2 id="live-strip" className="text-sm font-semibold text-on-brand/80">{t('auth.live_strip_title')}</h2>
          <LiveIndicator onDark />
        </div>
        <ul className="mt-3 divide-y divide-white/10 border-y border-white/10">
          {top.length === 0 && <li className="py-3 text-on-brand/60 text-sm">{t('common.loading')}</li>}
          {top.map((l) => (
            <li key={l.id} className="py-2.5 flex items-center gap-3">
              <span className="flex-1 min-w-0">
                <span className="block font-semibold text-white truncate">{placeName(l, i18n.language)}</span>
                <span className="block text-xs text-on-brand/60">{t(`districts.${l.district}`)}</span>
              </span>
              <span className="font-mono text-sm text-on-brand/80 tabular-nums">{l.risk!.score.toFixed(2)}</span>
              <RiskBadge level={l.risk!.level} size="sm" />
            </li>
          ))}
        </ul>
        <UpdatedAgo at={lastUpdateAt} className="!text-on-brand/60 mt-2 inline-block" />
      </section>
      <p className="relative mt-8 text-xs text-on-brand/50 hidden lg:block">{t('app.team')}</p>
    </aside>
  );
}
