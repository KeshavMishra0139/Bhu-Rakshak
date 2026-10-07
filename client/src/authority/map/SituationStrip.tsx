// Situation strip above the officer map: the whole picture at one glance — stations per level right now, places in a
// red zone, open incidents, field reports waiting, and how fresh the rain data is. Each count links to its page.
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CloudRain, ShieldAlert, ClipboardList, FileWarning } from 'lucide-react';
import type { Incident, Level, LocationSnap, Report } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { useNow } from '../../lib/useNow';
import { withPane } from '../../lib/viewAs';
import { useLive } from '../useLive';
import { PIN_COLOR } from './WatchMap';

const ORDER: Level[] = ['critical', 'high', 'moderate', 'low'];
const OPEN = (i: Incident) => i.stage !== 'resolved' && i.stage !== 'closed';

export function SituationStrip({ list, reports }: { list: LocationSnap[]; reports: Report[] | undefined }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const now = useNow(30000);
  const incidents = useLive<{ incidents: Incident[] }>(can('incidents.view') ? '/incidents' : null, ['incident_updated']);

  const count = (lv: Level) => list.filter((l) => l.risk?.level === lv).length;
  const red = count('high') + count('critical');
  const openIncidents = incidents.data?.incidents.filter(OPEN).length;
  const waiting = reports?.filter((r) => r.status === 'submitted').length;
  // Rain freshness: the newest live Open-Meteo reading behind any station (none = typical weather only).
  const liveTimes = list.filter((l) => l.risk?.conditions?.data_source === 'open-meteo')
    .map((l) => Date.parse(String(l.risk!.conditions.data_fetched_at))).filter((x) => !Number.isNaN(x));
  const mins = liveTimes.length ? Math.max(0, Math.round((now - Math.max(...liveTimes)) / 60000)) : null;

  const item = 'flex shrink-0 items-center gap-2 rounded-xl px-3 py-1.5';
  const link = `${item} hover:bg-white/10 focus-visible:bg-white/10`;
  const num = 'text-lg font-bold leading-none tabular-nums text-white';
  const label = 'text-[11px] font-semibold leading-tight text-[#9fb3a6]';

  return (
    <section aria-label={t('sit.label')} className="flex items-center gap-1 overflow-x-auto rounded-2xl border border-[rgb(155_193_161/0.22)] bg-[#15241c] px-2 py-1.5 text-[#d7efd8] shadow-[0_10px_30px_rgb(6_17_12/0.18)] max-md:rounded-none max-md:border-x-0">
      <div className="flex shrink-0 items-center" role="group" aria-label={t('sit.by_level')}>
        {ORDER.map((lv) => (
          <div key={lv} className={item}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: PIN_COLOR[lv][0] }} aria-hidden />
            <span className={num}>{list.length ? count(lv) : '–'}</span>
            <span className={label}>{t(`levels.${lv}`)}</span>
          </div>
        ))}
      </div>
      <span className="mx-1 h-7 w-px shrink-0 bg-white/10" aria-hidden />
      <Link to={withPane('/authority/zones')} className={link}>
        <ShieldAlert size={16} className={red ? 'text-[#ff8a80]' : 'text-[#9fb3a6]'} aria-hidden />
        <span className={num}>{list.length ? red : '–'}</span><span className={label}>{t('sit.red_zones')}</span>
      </Link>
      {can('incidents.view') && (
        <>
          <Link to={withPane('/authority/incidents')} className={link}>
            <ClipboardList size={16} className="text-[#9fb3a6]" aria-hidden />
            <span className={num}>{openIncidents ?? '–'}</span><span className={label}>{t('sit.open_incidents')}</span>
          </Link>
          <Link to={withPane('/authority/reports')} className={link}>
            <FileWarning size={16} className={waiting ? 'text-[#f4c993]' : 'text-[#9fb3a6]'} aria-hidden />
            <span className={num}>{waiting ?? '–'}</span><span className={label}>{t('sit.reports_waiting')}</span>
          </Link>
        </>
      )}
      <div className={`${item} ml-auto`} title={t('sit.rain_title')}>
        <CloudRain size={16} className={mins == null ? 'text-[#f4c993]' : 'text-[#9dd2a6]'} aria-hidden />
        <span className="text-xs font-semibold text-[#d7efd8]">
          {mins == null ? t('sit.rain_not_live') : mins < 1 ? t('sit.rain_now') : t('sit.rain_age', { count: mins })}
        </span>
      </div>
    </section>
  );
}
