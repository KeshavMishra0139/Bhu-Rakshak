// "Why" card: one place's risk in plain words — the level, when it is highest, how sure the system is, and the top
// three reasons. Used as the side panel beside the citizen map (desktop), inside the bottom sheet (mobile) and at the
// top of the officer drawer (`embedded`, which drops the header the drawer already shows).
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Clock, Gauge, X, Info } from 'lucide-react';
import type { LocationSnap } from '../api/types';
import { RiskBadge } from './RiskBadge';
import { UpdatedAgo } from './UpdatedAgo';
import { groupOf } from './RiskMix';
import { driverLabel, driverPlain } from '../lib/factors';
import { LEVEL_ICON, TREND_ICON, levelVar } from '../lib/risk';
import { confidenceBand, hoursFrom, riskWindow, topReasons, type RiskWindow } from '../lib/why';
import { dateTimeIST, placeName } from '../lib/format';
import { isPreview } from '../lib/mapConfig';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "In 6–24 h" etc., plus the same window as clock times. */
export function windowText(w: RiskWindow, updatedAt: string, t: TFunction, lang: string) {
  const at = (h: number) => dateTimeIST(hoursFrom(updatedAt, h), lang);
  if (w.kind === 'calm') return { main: t('why.win_calm', { to: w.to }), sub: '' };
  if (w.kind === 'now') {
    if (w.open) return { main: t('why.win_now_open', { to: w.to }), sub: t('why.win_until', { time: at(w.to) }) };
    if (w.to === 0) return { main: t('why.win_now_short'), sub: '' };
    return { main: t('why.win_now', { to: w.to }), sub: t('why.win_until', { time: at(w.to) }) };
  }
  const sub = t('why.win_between', { start: at(w.from), end: at(w.to) });
  if (w.open) return { main: t('why.win_later_open', { from: w.from, to: w.to }), sub: t('why.win_from', { time: at(w.from) }) };
  if (w.from === w.to) return { main: t('why.win_around', { h: w.from }), sub: t('why.win_at', { time: at(w.from) }) };
  return { main: t('why.win_later', { from: w.from, to: w.to }), sub };
}

type Props = {
  loc: LocationSnap;
  /** panel: card beside the map; bare: same without the card box (inside a sheet); embedded: no header (officer drawer). */
  variant?: 'panel' | 'bare' | 'embedded';
  onClose?: () => void;
  /** Technical driver names next to the plain words (officers). */
  technical?: boolean;
  /** Extra sections (impact, actions) rendered after the reasons. */
  children?: ReactNode;
};

export function WhyCard({ loc, variant = 'panel', onClose, technical = false, children }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const r = loc.risk;
  if (!r) return null;
  const w = riskWindow(r);
  const win = windowText(w, r.updated_at, t, lang);
  const band = confidenceBand(r.confidence);
  const reasons = topReasons(r.drivers, 3);
  const Icon = LEVEL_ICON[r.level];
  const Trend = TREND_ICON[r.trend];
  const calm = w.kind === 'calm';
  const embedded = variant === 'embedded';

  const body = (
    <>
      <dl className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-surface-2 p-3">
          <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><Clock size={13} aria-hidden />{t('why.when')}</dt>
          <dd className="mt-1">
            {!calm && <span className="mb-1 block"><RiskBadge level={w.level} size="sm" /></span>}
            <span className="block font-bold leading-snug">{win.main}</span>
            {win.sub && <span className="mt-0.5 block text-xs text-muted">{win.sub}</span>}
          </dd>
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><Gauge size={13} aria-hidden />{technical ? t('why.confidence') : t('why.sure_title')}</dt>
          <dd className="mt-1">
            {/* Citizens get words ("Fairly sure"); officers keep the percentage. */}
            {technical ? (
              <>
                <span className="block text-2xl font-bold tabular-nums leading-none">{Math.round(r.confidence * 100)}%</span>
                <span className="mt-1 block text-xs font-semibold">{t(`why.conf_${band}`)}</span>
              </>
            ) : <span className="block text-lg font-bold leading-snug">{t(`why.sure_${band}`)}</span>}
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
              <span className="block h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${Math.round(r.confidence * 100)}%` }} />
            </span>
          </dd>
        </div>
      </dl>

      <section className="mt-4" aria-labelledby={`why-reasons-${loc.id}`}>
        <h3 id={`why-reasons-${loc.id}`} className="font-bold">{calm ? t('why.reasons_watch') : t('why.reasons')}</h3>
        <ol className="stagger mt-2 space-y-2">
          {reasons.map((d, i) => {
            const g = groupOf(d.key);
            const GIcon = g?.icon;
            return (
              <li key={d.key} className="flex items-start gap-3 rounded-xl border border-line p-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: `${g?.color || '#888'}22`, color: g?.color }}>
                  {GIcon ? <GIcon size={17} aria-hidden /> : <span className="text-sm font-bold">{i + 1}</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold leading-snug">{cap(driverPlain(d.key, lang))}</span>
                  {technical && <span className="block text-xs text-muted">{driverLabel(d.key, lang)}</span>}
                  <span className="mt-1.5 flex items-center gap-2" title={technical ? t('why.share_tip') : undefined}>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                      <span className="block h-full rounded-full" style={{ width: `${Math.min(100, d.contribution)}%`, background: g?.color || 'rgb(var(--brand))' }} />
                    </span>
                    {technical && <span className="font-mono text-xs tabular-nums text-muted">{t('why.share', { value: d.contribution })}</span>}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      {children}

      <p className="mt-4 flex items-start gap-1.5 text-xs text-muted">
        <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
        <span>{technical ? t('why.basis') : t('why.basis_plain')}</span>
      </p>
    </>
  );

  if (embedded) return <section aria-label={t('why.title')} className="rounded-2xl border border-line p-3">{body}</section>;

  return (
    <article className={variant === 'bare' ? 'overflow-hidden' : 'card overflow-hidden'} aria-labelledby={`why-title-${loc.id}`} lang={lang}>
      <header className={`flex items-start gap-3 ${variant === 'bare' ? 'px-1 pb-4 pt-1' : 'p-4'}`} style={variant === 'bare' ? undefined : { borderTop: `6px solid ${levelVar(r.level)}` }}>
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-white" style={{ background: levelVar(r.level) }}>
          <Icon size={26} aria-hidden strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t('why.title')}</p>
          <h2 id={`why-title-${loc.id}`} className="text-xl font-bold leading-tight">{placeName(loc, lang)}</h2>
          <p className="text-sm text-muted">{t(`districts.${loc.district}`)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <RiskBadge level={r.level} size="sm" />
            <span className="inline-flex items-center gap-1 text-xs font-semibold"><Trend size={14} aria-hidden />{t(`trend.${r.trend}`)}</span>
            <UpdatedAgo at={r.updated_at} />
          </div>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="-m-1 p-2 text-muted hover:text-ink" aria-label={t('common.close')}><X size={20} aria-hidden /></button>
        )}
      </header>
      <div className={variant === 'bare' ? 'px-1' : 'px-4 pb-4'}>
        {isPreview(loc) && (
          <p className="mb-3 rounded-md border border-[#a27ad6]/50 bg-[#a27ad6]/10 p-2 text-xs">
            <span className="font-bold uppercase tracking-wide">{technical ? t('preview.badge') : t('preview.badge_plain')}</span> · {technical ? t('preview.note') : t('preview.note_plain')}
          </p>
        )}
        {body}
      </div>
    </article>
  );
}
