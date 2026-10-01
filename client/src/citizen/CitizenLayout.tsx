import { useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Home, Route, Bell, Megaphone, UserRound, Phone, Volume2, Map as MapIcon } from 'lucide-react';
import { Logo } from '../components/Logo';
import { LiveIndicator } from '../components/LiveIndicator';
import { LanguageToggle } from '../components/LanguageToggle';
import { ThemeToggle } from '../components/ThemeToggle';
import { audioUnlocked, onAudioState, unlockAudio } from '../lib/audio';
import { withPane } from '../lib/viewAs';
import { PageTransition } from '../components/PageTransition';
import { OfflineBanner, InstallButton } from '../components/OfflineBanner';
import { useCitizen } from './CitizenContext';

const NAV = [
  { to: '/citizen', key: 'citizen.home', Icon: Home, end: true },
  { to: '/citizen/map', key: 'riskmap.nav', Icon: MapIcon },
  { to: '/citizen/roads', key: 'citizen.roads_title', Icon: Route },
  { to: '/citizen/alerts', key: 'citizen.alerts_title', Icon: Bell },
  { to: '/citizen/report', key: 'nav.report', Icon: Megaphone },
  { to: '/citizen/profile', key: 'nav.profile', Icon: UserRound },
];

/** One-time friendly prompt: browsers need a tap before we can play the alarm. */
function SoundPrompt() {
  const { t } = useTranslation();
  const [on, setOn] = useState(audioUnlocked());
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem('br.soundPromptDismissed') === '1');
  useEffect(() => onAudioState(setOn), []);
  if (on || dismissed) return null;
  return (
    <div className="mx-auto max-w-[1100px] px-4 pt-4">
      <div className="card p-4 flex flex-wrap items-center gap-3 border-brand/40">
        <Volume2 size={24} className="text-brand shrink-0" aria-hidden />
        <div className="flex-1 min-w-[220px]">
          <p className="font-bold">{t('alarm.enable_title')}</p>
          <p className="text-muted">{t('alarm.enable_body')}</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => unlockAudio()}>{t('alarm.enable')}</button>
        <button type="button" className="btn-ghost" onClick={() => { sessionStorage.setItem('br.soundPromptDismissed', '1'); setDismissed(true); }}>{t('alarm.later')}</button>
      </div>
    </div>
  );
}

export function CitizenLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { active } = useCitizen(); // a High/Critical alarm turns the logo's warning waves red
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-lg font-semibold ${isActive ? 'bg-brand/12 text-brand' : 'text-muted hover:text-ink'}`;
  return (
    <div className="min-h-screen pb-24 md:pb-10">
      <header className="bg-surface border-b border-line">
        <div className="mx-auto max-w-[1100px] px-4 h-16 flex items-center gap-3">
          <NavLink to={withPane('/citizen')} aria-label={t('citizen.home')}><Logo alert={!!active && !active.acknowledged} /></NavLink>
          <nav className="hidden md:flex items-center gap-1 ml-4" aria-label={t('common.menu')}>
            {NAV.map((n) => <NavLink key={n.to} to={withPane(n.to)} end={n.end} className={linkCls}>{t(n.key)}</NavLink>)}
          </nav>
          <div className="flex-1" />
          <InstallButton />
          <span className="hidden sm:inline"><LiveIndicator /></span>
          <LanguageToggle />
          <span className="hidden md:inline"><ThemeToggle /></span>
        </div>
      </header>
      <div className="mx-auto max-w-[1100px] px-4 empty:hidden [&>*]:mt-3"><OfflineBanner /></div>
      <SoundPrompt />
      <main id="main" className="mx-auto max-w-[1100px] px-4 py-5"><PageTransition className="">{children}</PageTransition></main>

      {/* Sticky SOS: always one tap from emergency services. */}
      <a href="tel:112" className="fixed z-30 right-4 bottom-24 md:bottom-6 btn bg-risk-critical text-white shadow-lg rounded-pill px-5" aria-label={t('citizen.call_112')}>
        <Phone size={20} aria-hidden /> {t('citizen.sos')}
      </a>

      <nav className="md:hidden fixed z-30 bottom-0 inset-x-0 bg-surface border-t border-line grid grid-cols-6" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }} aria-label={t('common.menu')}>
        {NAV.map(({ to, key, Icon, end }) => (
          <NavLink key={to} to={withPane(to)} end={end}
            className={({ isActive }) => `flex flex-col items-center justify-center gap-0.5 min-h-[60px] text-[0.72rem] font-semibold ${isActive ? 'text-brand' : 'text-muted'}`}>
            <Icon size={22} aria-hidden />
            <span className="leading-tight text-center">{t(key)}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
