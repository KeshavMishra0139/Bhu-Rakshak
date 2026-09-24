// Developer / Admin mode bar. Only rendered for a real developer session (and never inside split-view panes).
// Every action here is enforced server-side under /api/dev/* and recorded in the audit log.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Wrench, Columns2, CloudLightning, Pause, Play, RotateCcw, Gauge, X } from 'lucide-react';
import { api, errorKey } from '../api/client';
import type { Level, Me } from '../api/types';
import { useAuth, homePathFor } from '../auth/AuthProvider';
import { useRiskStream } from '../live/RiskStreamProvider';
import { LanguageToggle } from '../components/LanguageToggle';
import { ThemeToggle } from '../components/ThemeToggle';
import { useToasts } from '../components/Toasts';
import { placeName } from '../lib/format';
import { LEVELS, riskConfig } from '../lib/risk';

const SUB_ROLES = ['district_officer', 'police', 'bro', 'rescue', 'sdma'] as const;
const DISTRICTS = ['All', 'East Sikkim', 'West Sikkim', 'North Sikkim', 'South Sikkim', 'Kalimpong', 'Darjeeling'];
type Role = 'developer' | 'authority' | 'citizen' | 'admin';

export function DevBar() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const loc = useLocation();
  const { me, setMe } = useAuth();
  const { controls, list, corridors } = useRiskStream();
  const toasts = useToasts();
  const va = me?.actor.viewing_as as { role?: Role; sub_role?: string; district?: string; home_location_id?: string } | null;
  const [role, setRole] = useState<Role>(va?.role || 'developer');
  const [sub, setSub] = useState(va?.sub_role || 'sdma');
  const [district, setDistrict] = useState(va?.district || 'All');
  const [home, setHome] = useState(va?.home_location_id || 'mangan');
  const [open, setOpen] = useState(false);
  const [storm, setStorm] = useState<string[]>(['north']);
  const [forceLoc, setForceLoc] = useState('mangan');
  const [forceLv, setForceLv] = useState<Level>('critical');
  const [err, setErr] = useState<string | null>(null);
  const split = loc.pathname.startsWith('/dev/split');
  const barRef = useRef<HTMLDivElement>(null);
  // Publish the bar height so full-height layouts can subtract it.
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--devbar-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => { ro.disconnect(); document.documentElement.style.setProperty('--devbar-h', '0px'); };
  }, []);

  async function call(path: string, body?: unknown) {
    setErr(null);
    try { return await api.post(path, body); } catch (e) { setErr(errorKey(e)); return null; }
  }
  async function applyView() {
    const body = role === 'developer' ? { role: null } : { role, sub_role: sub, district, home_location_id: home, language: i18n.language };
    const m = await call('/dev/view-as', body) as Me | null;
    if (m) { setMe(m); if (!split) nav(homePathFor(m)); }
  }
  const places = [...list].sort((a, b) => placeName(a, i18n.language).localeCompare(placeName(b, i18n.language)));
  const sel = 'rounded-md bg-white/10 border border-white/20 px-2 py-1 text-sm text-white [&>option]:text-ink';

  return (
    <div ref={barRef} className="no-print fixed top-0 inset-x-0 z-[1100] bg-[#2a1f4a] text-white text-sm">
      <div className="px-3 py-1.5 flex flex-wrap items-center gap-2">
        <span className="rounded-pill bg-[#f2b134] text-[#2a1f4a] px-2.5 py-0.5 font-bold inline-flex items-center gap-1"><Wrench size={14} aria-hidden />{t('dev.badge')}</span>
        <label htmlFor="dev-role" className="ml-1 font-semibold">{t('dev.view_as')}</label>
        <select id="dev-role" className={sel} value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {(['developer', 'authority', 'citizen', 'admin'] as Role[]).map((r) => <option key={r} value={r}>{t(`dev.as_${r}`)}</option>)}
        </select>
        {role === 'authority' && (
          <>
            <select aria-label={t('signup.sub_role')} className={sel} value={sub} onChange={(e) => setSub(e.target.value)}>
              {SUB_ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
            </select>
            <select aria-label={t('signup.district')} className={sel} value={district} onChange={(e) => setDistrict(e.target.value)}>
              {DISTRICTS.map((d) => <option key={d} value={d}>{t(`districts.${d}`)}</option>)}
            </select>
          </>
        )}
        {role === 'citizen' && (
          <select aria-label={t('settings.home')} className={sel} value={home} onChange={(e) => setHome(e.target.value)}>
            {places.map((l) => <option key={l.id} value={l.id}>{placeName(l, i18n.language)}</option>)}
          </select>
        )}
        <button type="button" className="rounded-md bg-white text-[#2a1f4a] px-2.5 py-1 font-semibold" onClick={applyView}>{t('common.confirm')}</button>
        <button type="button" className={`rounded-md px-2.5 py-1 font-semibold inline-flex items-center gap-1 ${split ? 'bg-[#f2b134] text-[#2a1f4a]' : 'bg-white/10 hover:bg-white/20'}`}
          onClick={() => nav(split ? homePathFor(me) : '/dev/split')}>
          <Columns2 size={15} aria-hidden />{split ? t('dev.exit_split') : t('dev.split')}
        </button>
        <button type="button" aria-expanded={open} className="rounded-md bg-white/10 hover:bg-white/20 px-2.5 py-1 font-semibold inline-flex items-center gap-1" onClick={() => setOpen((v) => !v)}>
          <Gauge size={15} aria-hidden />{t('dev.controls')}
        </button>
        {controls?.scenario.active && <span className="inline-flex items-center gap-1 text-[#f2b134] font-semibold"><CloudLightning size={15} aria-hidden />{t('dev.storm')}</span>}
        {controls?.paused && <span className="text-[#f2b134] font-semibold">{t('dev.pause')}</span>}
        <span className="flex-1" />
        <LanguageToggle onDark />
        <ThemeToggle onDark />
      </div>
      {err && <p className="px-3 pb-1 text-[#ffb4a8]" role="alert">{t(err)}</p>}
      {open && (
        <div className="absolute left-2 right-2 sm:left-auto sm:right-3 top-full mt-1 sm:w-[420px] rounded-card bg-surface text-ink shadow-2xl border border-line p-4 space-y-4">
          <div className="flex items-center justify-between"><h2 className="font-bold">{t('dev.controls')}</h2><button type="button" onClick={() => setOpen(false)} aria-label={t('common.close')}><X size={18} aria-hidden /></button></div>
          <fieldset>
            <legend className="font-semibold inline-flex items-center gap-1"><CloudLightning size={16} aria-hidden />{t('dev.storm')}</legend>
            <div className="mt-1 grid grid-cols-2 gap-1">
              {corridors.map((c) => (
                <label key={c.id} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={storm.includes(c.id)} onChange={(e) => setStorm((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))} />
                  <span className="truncate">{(i18n.language === 'hi' ? c.name_hi : c.name_en).split(' (')[0]}</span>
                </label>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn-primary !min-h-[36px] py-1 text-sm" disabled={!storm.length} onClick={() => call('/dev/scenario', { active: true, corridors: storm })}>{t('authority.scenario_start')}</button>
              <button type="button" className="btn-secondary !min-h-[36px] py-1 text-sm" onClick={() => call('/dev/scenario', { active: false })}>{t('authority.scenario_stop')}</button>
            </div>
          </fieldset>
          <fieldset>
            <legend className="font-semibold">{t('dev.force')}</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              <select aria-label={t('common.location')} className="input !min-h-[36px] py-1 text-sm flex-1" value={forceLoc} onChange={(e) => setForceLoc(e.target.value)}>
                {places.map((l) => <option key={l.id} value={l.id}>{placeName(l, i18n.language)}{controls?.forced[l.id] ? ` (${t(`levels.${controls.forced[l.id]}`)})` : ''}</option>)}
              </select>
              <select aria-label={t('common.level')} className="input !min-h-[36px] py-1 text-sm w-32" value={forceLv} onChange={(e) => setForceLv(e.target.value as Level)}>
                {LEVELS.map((lv) => <option key={lv} value={lv}>{t(`levels.${lv}`)}</option>)}
              </select>
            </div>
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn-primary !min-h-[36px] py-1 text-sm" onClick={() => call('/dev/force-risk', { location_id: forceLoc, level: forceLv })}>{t('dev.force')}</button>
              <button type="button" className="btn-secondary !min-h-[36px] py-1 text-sm" onClick={() => call('/dev/force-risk', { location_id: forceLoc, level: null })}>{t('dev.release')}</button>
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary !min-h-[36px] py-1 text-sm" onClick={() => call('/dev/pause', { paused: !controls?.paused })}>
              {controls?.paused ? <><Play size={15} aria-hidden />{t('dev.resume')}</> : <><Pause size={15} aria-hidden />{t('dev.pause')}</>}
            </button>
            <span className="text-sm font-semibold ml-2">{t('dev.speed')}</span>
            {riskConfig.live.speedOptions.map((s) => (
              <button key={s} type="button" aria-pressed={controls?.speed === s} onClick={() => call('/dev/speed', { speed: s })}
                className={`rounded-md px-2.5 py-1 text-sm font-mono font-semibold border ${controls?.speed === s ? 'bg-ink text-bg border-ink' : 'border-line'}`}>{s}×</button>
            ))}
          </div>
          <button type="button" className="btn-danger !min-h-[36px] py-1 text-sm" onClick={async () => {
            if (window.confirm(t('dev.reset_confirm')) && await call('/dev/reset')) toasts.push({ text: t('dev.reset_done') });
          }}><RotateCcw size={15} aria-hidden />{t('dev.reset')}</button>
        </div>
      )}
    </div>
  );
}
