// Authority map on the left, the citizen website at phone width on the right. Each pane carries its own
// "view as" (?pane=), so both react to the same live events at the same time from one developer session.
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthProvider';
import { useRiskStream } from '../live/RiskStreamProvider';
import { encodePane } from '../lib/viewAs';
import { placeName } from '../lib/format';

const SUB_ROLES = ['sdma', 'district_officer', 'police', 'bro', 'rescue'] as const;

export default function SplitView() {
  const { t, i18n } = useTranslation();
  const { me } = useAuth();
  const { list } = useRiskStream();
  const [sub, setSub] = useState<string>('sdma');
  const [home, setHome] = useState('mangan');
  const [clang, setClang] = useState<'en' | 'hi'>(i18n.language === 'hi' ? 'hi' : 'en');
  if (!me?.dev_mode) return <Navigate to="/" replace />;
  const left = `/authority?pane=${encodePane({ role: 'authority', sub_role: sub, district: sub === 'sdma' ? 'All' : 'North Sikkim', language: i18n.language })}`;
  const right = `/citizen?pane=${encodePane({ role: 'citizen', home_location_id: home, language: clang })}`;
  const places = [...list].sort((a, b) => placeName(a, i18n.language).localeCompare(placeName(b, i18n.language)));
  return (
    <div className="flex flex-col" style={{ height: 'calc(100dvh - var(--devbar-h, 0px))' }}>
      <div className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-line bg-surface text-sm">
        <span className="font-bold">{t('dev.split_left')}</span>
        <select aria-label={t('signup.sub_role')} className="input !min-h-[34px] py-1 w-44 text-sm" value={sub} onChange={(e) => setSub(e.target.value)}>
          {SUB_ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
        </select>
        <span className="flex-1" />
        <span className="font-bold">{t('dev.split_right')}</span>
        <select aria-label={t('settings.home')} className="input !min-h-[34px] py-1 w-40 text-sm" value={home} onChange={(e) => setHome(e.target.value)}>
          {places.map((l) => <option key={l.id} value={l.id}>{placeName(l, i18n.language)}</option>)}
        </select>
        <select aria-label={t('lang.label')} className="input !min-h-[34px] py-1 w-28 text-sm" value={clang} onChange={(e) => setClang(e.target.value as 'en' | 'hi')}>
          <option value="en">English</option><option value="hi">हिन्दी</option>
        </select>
      </div>
      <div className="flex-1 min-h-0 flex gap-3 p-3 bg-surface-2">
        <iframe key={left} src={left} title={t('dev.split_left')} className="flex-1 min-w-0 h-full rounded-card border border-line bg-surface" />
        <iframe key={right} src={right} title={t('dev.split_right')} className="w-[390px] shrink-0 h-full rounded-[22px] border-4 border-ink/80 bg-surface" allow="autoplay; geolocation" />
      </div>
    </div>
  );
}
