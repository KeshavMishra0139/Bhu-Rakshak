// In-app guide: every page of the citizen site or the officer dashboard in a few plain steps, each with a button that
// opens that page. Content lives in data/guide.json (English, Hindi, Nepali; other languages read English).
// Citizens: /citizen/guide (linked from Profile, the header and the home tour). Officers: /authority/guide (header).
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight, Bell, BookOpen, Check, ClipboardList, Compass, Download, FileWarning, FlaskConical, Home, Inbox, Map as MapIcon,
  Megaphone, Phone, Route, Settings, Sparkles, Truck, UserRound, Wrench, type LucideIcon,
} from 'lucide-react';
import guide from '../data/guide.json';
import { withPane } from '../lib/viewAs';

type Text = { en: string; hi?: string; ne?: string };
type Section = { id: string; icon: string; to: string | null; title: Text; what: Text; steps: { en: string[]; hi?: string[]; ne?: string[] } };
type Role = 'citizen' | 'officer';

const ICONS: Record<string, LucideIcon> = {
  home: Home, map: MapIcon, route: Route, bell: Bell, megaphone: Megaphone, sparkles: Sparkles, phone: Phone, user: UserRound,
  download: Download, flask: FlaskConical, inbox: Inbox, clipboard: ClipboardList, 'file-warning': FileWarning, truck: Truck,
  wrench: Wrench, settings: Settings,
};

export default function GuidePage({ role }: { role: Role }) {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const lg = i18n.language === 'hi' || i18n.language === 'ne' ? i18n.language : 'en';
  const sections = (guide as unknown as Record<Role, Section[]>)[role];
  const pick = (x: Text) => x[lg] || x.en;
  const jump = (id: string) => document.getElementById(`g-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const replayTour = () => {
    try { localStorage.removeItem('br.tourDone'); } catch { /* private mode */ }
    nav(withPane('/citizen'));
  };

  return (
    <div className={`mx-auto max-w-3xl space-y-5 ${role === 'officer' ? 'p-4' : ''}`}>
      <header>
        <h1 className="flex items-center gap-2 text-[1.8rem] font-bold leading-tight"><BookOpen size={26} className="shrink-0 text-brand" aria-hidden />{t(`guide.title_${role}`)}</h1>
        <p className="mt-1 text-muted">{t(`guide.intro_${role}`)}</p>
        {role === 'officer' && <p className="mt-1 text-sm text-muted">{t('guide.roles_note')}</p>}
        <nav aria-label={t('guide.jump')} className="mt-4 flex flex-wrap gap-2">
          {sections.map((s) => (
            <button key={s.id} type="button" onClick={() => jump(s.id)} className="min-h-[36px] rounded-pill border border-line px-3 py-1 text-sm font-semibold hover:bg-surface-2">
              {pick(s.title)}
            </button>
          ))}
        </nav>
        {role === 'citizen' && (
          <button type="button" onClick={replayTour} className="btn-ghost mt-3 -ml-3"><Compass size={18} aria-hidden />{t('guide.replay_tour')}</button>
        )}
      </header>

      <ol className="space-y-4">
        {sections.map((s) => {
          const Icon = ICONS[s.icon] || BookOpen;
          return (
            <li key={s.id} id={`g-${s.id}`} className="card scroll-mt-4 p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand/12 text-brand ring-1 ring-brand/20"><Icon size={20} aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold leading-snug">{pick(s.title)}</h2>
                  <p className="text-muted">{pick(s.what)}</p>
                </div>
              </div>
              <ul className="mt-3 space-y-2">
                {(s.steps[lg] || s.steps.en).map((step, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <Check size={17} className="mt-1 shrink-0 text-brand" aria-hidden />
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
              {s.to && (
                <Link to={withPane(s.to)} className="btn-secondary mt-4">{t('guide.open')}<ArrowRight size={16} aria-hidden /></Link>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
