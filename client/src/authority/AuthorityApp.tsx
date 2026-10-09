import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Route, Routes, Link, useNavigate } from 'react-router-dom';
import { PageTransition } from '../components/PageTransition';
import { useTranslation } from 'react-i18next';
import { Map, Inbox, ClipboardList, Megaphone, FileWarning, Route as RouteIcon, Truck, Wrench, ScrollText, Activity, FileText, UserRound, LogOut, Settings, BookOpen, ShieldAlert } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { useStreamEvent, useRiskStream } from '../live/RiskStreamProvider';
import { Logo } from '../components/Logo';
import { LiveIndicator } from '../components/LiveIndicator';
import { UpdatedAgo } from '../components/UpdatedAgo';
import { LanguageToggle } from '../components/LanguageToggle';
import { ThemeToggle } from '../components/ThemeToggle';
import { HealthPanel } from '../components/HealthPanel';
import { SettingsForm } from '../components/SettingsForm';
import { ScenarioControl } from '../components/authority/ScenarioControl';
import { useToasts } from '../components/Toasts';
import { placeName } from '../lib/format';
import { playChime, audioUnlocked, unlockAudio } from '../lib/audio';
import { withPane } from '../lib/viewAs';
import { AuthorityProvider } from './AuthorityContext';
import MapPage from './map/MapPage';
import InboxPage from './InboxPage';
import IncidentsPage from './IncidentsPage';
import AlertsPage from './AlertsPage';
import ReportsPage from './ReportsPage';
import RoadsPage from './RoadsPage';
const CorridorCheckPage = lazy(() => import('../citizen/CorridorCheckPage'));
import ResourcesPage from './ResourcesPage';
import AuditPage from './AuditPage';
import SitrepPage from './SitrepPage';
import GuidePage from '../pages/GuidePage';
import ZonesPage from './ZonesPage';
import { OfflineBanner } from '../components/OfflineBanner';
import { PageHeader, PAGE_BODY } from '../components/PageHeader';

function Popover({ label, icon, children, align = 'right' }: { label: string; icon: ReactNode; children: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      {/* On the dark header in both themes (btn-ghost alone gives dark text, invisible in the light theme). */}
      <button type="button" className="btn-ghost px-3 text-on-brand hover:bg-white/10" aria-expanded={open} aria-haspopup="true" title={label} onClick={() => setOpen((v) => !v)}>
        {/* Label hidden on narrower screens but still read out by screen readers. */}
        {icon}<span className="sr-only xl:not-sr-only">{label}</span>
      </button>
      {open && <div className={`pop-enter absolute ${align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'} top-full mt-1 z-[1000] w-[340px] max-w-[92vw] card shadow-2xl p-4`} onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setOpen(false); }}>{children}</div>}
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const { me, can, logout } = useAuth();
  const { lastUpdateAt } = useRiskStream();
  const toasts = useToasts();
  const [unread, setUnread] = useState({ unread: 0, critical: 0 });
  const loadUnread = useCallback(() => { if (can('inbox.read')) api.get<typeof unread>('/inbox/unread-count').then(setUnread).catch(() => {}); }, [can]);
  useEffect(() => { loadUnread(); }, [loadUnread]);
  useStreamEvent('inbox_updated', loadUnread);
  useStreamEvent('inbox_message', (m) => {
    loadUnread();
    if (m.type === 'deescalation') return;
    const place = placeName(m.params, i18n.language);
    toasts.push({ text: t(m.title_key, { place, level: t(`levels.${m.level}`) }), level: m.level, urgent: m.level === 'critical' });
    if (me?.user.prefs?.inbox_chime !== false && (m.level === 'high' || m.level === 'critical')) playChime(m.level);
  });
  // Officers interact constantly, so unlock audio on the first click anywhere (for the inbox chime).
  useEffect(() => {
    if (audioUnlocked()) return;
    const once = () => { unlockAudio(); document.removeEventListener('pointerdown', once); };
    document.addEventListener('pointerdown', once);
    return () => document.removeEventListener('pointerdown', once);
  }, []);

  const items = [
    { to: '/authority', key: 'nav.map', Icon: Map, end: true, show: true },
    { to: '/authority/zones', key: 'nav.zones', Icon: ShieldAlert, show: can('incidents.view') },
    { to: '/authority/inbox', key: 'nav.inbox', Icon: Inbox, show: can('inbox.read'), badge: unread.unread, badgeCritical: unread.critical > 0 },
    { to: '/authority/incidents', key: 'nav.incidents', Icon: ClipboardList, show: can('incidents.view') },
    { to: '/authority/alerts', key: 'nav.alerts', Icon: Megaphone, show: can('incidents.view') },
    { to: '/authority/reports', key: 'nav.reports', Icon: FileWarning, show: can('incidents.view') },
    { to: '/authority/roads', key: 'nav.roads', Icon: RouteIcon, show: true },
    { to: '/authority/resources', key: 'nav.resources', Icon: Truck, show: can('incidents.view') },
  ].filter((x) => x.show);
  const role = me?.actor.role === 'authority' && me.actor.sub_role ? t(`roles.${me.actor.sub_role}`) : t(`roles.${me?.actor.role || 'developer'}`);
  const district = me?.actor.district ? t(`districts.${me.actor.district}`, { defaultValue: me.actor.district }) : t('districts.All');

  return (
    <div className="flex flex-col" style={{ height: 'calc(100dvh - var(--devbar-h, 0px))' }}>
      <header className="no-print shrink-0 bg-brand-deep text-on-brand">
        <div className="h-14 px-3 flex items-center gap-2">
          <Link to={withPane('/authority')} className="mr-1" aria-label={t('app.name')}><Logo onDark compact /></Link>
          <nav className="flex-1 min-w-0 overflow-x-auto flex items-center gap-0.5" aria-label={t('common.menu')}>
            {items.map(({ to, key, Icon, end, badge, badgeCritical }) => (
              <NavLink key={to} to={withPane(to)} end={end} title={t(key)}
                className={({ isActive }) => `relative shrink-0 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-semibold ${isActive ? 'bg-white/15 text-white' : 'text-on-brand/80 hover:text-white hover:bg-white/10'}`}>
                <Icon size={17} aria-hidden /><span className="sr-only lg:not-sr-only">{t(key)}</span>
                {!!badge && (
                  <span className={`ml-0.5 rounded-pill px-1.5 text-[0.7rem] font-bold tabular-nums ${badgeCritical ? 'bg-risk-critical text-white' : 'bg-white text-brand-deep'}`}
                    aria-label={t('inbox.unread_count', { count: badge })}>{badge}</span>
                )}
              </NavLink>
            ))}
          </nav>
          {/* "Updated …" only on very wide screens, so every menu item fits at laptop width (the Live dot stays). */}
          <div className="hidden md:flex items-center gap-2 mr-1"><LiveIndicator onDark /><UpdatedAgo at={lastUpdateAt} className="hidden 2xl:inline !text-on-brand/60" /></div>
          <NavLink to={withPane('/authority/guide')} className={({ isActive }) => `btn-ghost px-3 ${isActive ? 'bg-white/15 text-white' : 'text-on-brand hover:bg-white/10'}`}
            title={t('guide.link')} aria-label={t('guide.link')}>
            <BookOpen size={18} aria-hidden />
          </NavLink>
          <Popover label={t('nav.tools')} icon={<Wrench size={18} aria-hidden />}>
            <div className="space-y-4 text-ink">
              <div className="flex flex-col gap-1">
                {can('sitrep.generate') && <Link to={withPane('/authority/sitrep')} className="btn-ghost justify-start"><FileText size={17} aria-hidden />{t('nav.sitrep')}</Link>}
                {can('audit.read') && <Link to={withPane('/authority/audit')} className="btn-ghost justify-start"><ScrollText size={17} aria-hidden />{t('nav.audit')}</Link>}
              </div>
              {can('scenario.control') && <ScenarioControl />}
              {can('health.read') && (
                <section>
                  <h3 className="font-semibold mb-1 inline-flex items-center gap-2"><Activity size={17} aria-hidden />{t('nav.health')}</h3>
                  <HealthPanel compact />
                </section>
              )}
            </div>
          </Popover>
          <LanguageToggle onDark />
          {/* Only on very wide screens, so every menu item fits at laptop width (theme is also in Settings). */}
          <span className="hidden 2xl:block"><ThemeToggle onDark /></span>
          <Popover label={me?.user.name || ''} icon={<UserRound size={18} aria-hidden />}>
            <div className="text-ink space-y-2">
              <p className="font-bold">{me?.user.name}</p>
              <p className="text-sm text-muted">{t('authority.signed_in_as', { role, district })}</p>
              <Link to={withPane('/authority/settings')} className="btn-ghost w-full justify-start"><Settings size={17} aria-hidden />{t('nav.settings')}</Link>
              <button type="button" className="btn-ghost w-full justify-start" onClick={async () => { await logout(); nav('/login'); }}><LogOut size={17} aria-hidden />{t('common.sign_out')}</button>
            </div>
          </Popover>
        </div>
      </header>
      <div className="px-3 empty:hidden [&>*]:mt-2"><OfflineBanner /></div>
      <main id="main" className="flex-1 min-h-0 overflow-auto relative"><PageTransition>{children}</PageTransition></main>
    </div>
  );
}

function SettingsPage() {
  const { t } = useTranslation();
  return <div><PageHeader title={t('settings.title')} /><div className={PAGE_BODY}><div className="max-w-3xl"><SettingsForm variant="authority" /></div></div></div>;
}

export default function AuthorityApp() {
  return (
    <AuthorityProvider>
      <Routes>
        <Route path="sitrep" element={<SitrepPage />} />
        <Route path="*" element={
          <Shell>
            <Routes>
              <Route index element={<MapPage />} />
              <Route path="inbox" element={<InboxPage />} />
              <Route path="incidents" element={<IncidentsPage />} />
              <Route path="alerts" element={<AlertsPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="roads" element={<RoadsPage />} />
              <Route path="roads/check" element={<div className="mx-auto max-w-6xl p-4"><Suspense fallback={<div className="h-[60vh] rounded-card bg-surface-2 animate-pulse" />}><CorridorCheckPage backTo="/authority/roads" /></Suspense></div>} />
              <Route path="resources" element={<ResourcesPage />} />
              <Route path="audit" element={<AuditPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="guide" element={<GuidePage role="officer" />} />
              <Route path="zones" element={<ZonesPage />} />
              <Route path="*" element={<MapPage />} />
            </Routes>
          </Shell>
        } />
      </Routes>
    </AuthorityProvider>
  );
}
