// Optional first-visit tour of the citizen home: a small "New here?" prompt, then four steps that highlight the
// status card, the Why? button, the SOS button and Ask Saathi. Skippable at every step; once finished or
// dismissed it is never shown again on this device. Targets are marked with data-tour="…".
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Compass, X } from 'lucide-react';
import { useCitizen } from './CitizenContext';

const KEY = 'br.tourDone';
const STEPS = ['status', 'why', 'sos', 'saathi'] as const;
const done = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const markDone = () => { try { localStorage.setItem(KEY, '1'); } catch { /* private mode: shows again next visit */ } };

type Box = { top: number; left: number; width: number; height: number };

/** `ready`: the status card is on screen (a place with risk data is shown). */
export function CitizenTour({ ready }: { ready: boolean }) {
  const { t } = useTranslation();
  const { active } = useCitizen();
  const [state, setState] = useState<'hidden' | 'prompt' | 'touring'>(() => (done() ? 'hidden' : 'prompt'));
  const [step, setStep] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const next = useRef<HTMLButtonElement>(null);

  const finish = useCallback(() => { markDone(); setState('hidden'); }, []);
  const target = () => document.querySelector<HTMLElement>(`[data-tour="${STEPS[step]}"]`);

  // Measure the highlighted element (and follow it on scroll / resize).
  const measure = useCallback(() => {
    const el = document.querySelector<HTMLElement>(`[data-tour="${STEPS[step]}"]`);
    if (!el) { setBox(null); return; }
    const r = el.getBoundingClientRect();
    setBox({ top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 });
  }, [step]);

  useLayoutEffect(() => {
    if (state !== 'touring') return;
    target()?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    measure();
    const id = window.setTimeout(measure, 400); // after the smooth scroll
    next.current?.focus();
    return () => window.clearTimeout(id);
  }, [state, step]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state !== 'touring') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(); };
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('scroll', measure, true); window.removeEventListener('resize', measure); window.removeEventListener('keydown', onKey); };
  }, [state, measure, finish]);

  // Never during an unacknowledged High/Critical alarm: that screen is for acting, not learning.
  if (!ready || state === 'hidden' || (active && !active.acknowledged)) return null;

  // Rendered into <body>, so the page's entrance animation (a transform) can't pin it to the page.
  if (state === 'prompt') {
    return createPortal(
      <div role="dialog" aria-labelledby="tour-prompt" className="pop-enter fixed inset-x-4 z-[41] mx-auto max-w-sm bottom-[calc(9.5rem+env(safe-area-inset-bottom,0px))] md:bottom-24">
        <div className="card flex items-start gap-3 p-4 shadow-xl">
          <Compass size={22} className="mt-0.5 shrink-0 text-brand" aria-hidden />
          <div className="min-w-0 flex-1">
            <p id="tour-prompt" className="font-semibold">{t('citizen.tour_prompt')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-primary" onClick={() => { setStep(0); setState('touring'); }}>{t('citizen.tour_start')}</button>
              <button type="button" className="btn-ghost" onClick={finish}>{t('citizen.tour_no')}</button>
            </div>
          </div>
          <button type="button" onClick={finish} className="-m-1 p-2 text-muted hover:text-ink" aria-label={t('citizen.tour_no')}><X size={18} aria-hidden /></button>
        </div>
      </div>,
      document.body,
    );
  }

  // Tip card goes to the half of the screen away from the highlighted element.
  const low = box ? box.top + box.height / 2 > window.innerHeight / 2 : false;
  const last = step === STEPS.length - 1;
  return createPortal(
    <>
      {box && (
        <div aria-hidden className="pointer-events-none fixed z-[41] rounded-2xl ring-4 ring-brand transition-all duration-300"
          style={{ ...box, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.45)' }} />
      )}
      <div role="dialog" aria-labelledby="tour-text" aria-live="polite"
        className={`fixed inset-x-4 z-[42] mx-auto max-w-sm ${low ? 'top-20' : 'bottom-[calc(9.5rem+env(safe-area-inset-bottom,0px))] md:bottom-24'}`}>
        <div className="card p-4 shadow-xl">
          <p className="label-mono">{t('citizen.tour_step', { n: step + 1, total: STEPS.length })}</p>
          <p id="tour-text" className="mt-1 text-[1.05rem] font-semibold">{t(`citizen.tour_${STEPS[step]}`)}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button ref={next} type="button" className="btn-primary" onClick={() => (last ? finish() : setStep((s) => s + 1))}>
              {last ? t('citizen.tour_done') : t('citizen.tour_next')}
            </button>
            {!last && <button type="button" className="btn-ghost" onClick={finish}>{t('citizen.tour_skip')}</button>}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
