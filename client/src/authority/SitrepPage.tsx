import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Printer, ArrowLeft } from 'lucide-react';
import { api } from '../api/client';
import type { Level } from '../api/types';
import { RiskBadge } from '../components/RiskBadge';
import { Logo } from '../components/Logo';
import { dateTimeIST, placeName } from '../lib/format';
import { driverLabel } from '../lib/factors';
import { LEVELS } from '../lib/risk';
import { withPane } from '../lib/viewAs';

type Sitrep = {
  generated_at: string; levels: Record<Level, number>;
  top_locations: { id: string; name_en: string; name_hi: string; district: string; level: Level; score: number; trend: string; drivers: { key: string; contribution: number }[] }[];
  incidents: { id: string; title: string; stage: string; level: Level; detected_at: string; name_en: string; name_hi: string }[];
  alerts_today: { id: string; severity: Level; kind: string; title_en: string; title_hi: string; created_at: string; cancelled_at: string | null }[];
  roads_not_open: { id: string; name_en: string; name_hi: string; status: string; eta_clear_hours: number | null }[];
  resources: { type: string; status: string; n: number }[];
  reports: { total: number; pending: number | null };
  citizen_acks_today: number;
};

export default function SitrepPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [s, setS] = useState<Sitrep | null>(null);
  useEffect(() => { api.get<Sitrep>('/situation-report').then(setS).catch(() => {}); }, []);
  const H = ({ children }: { children: string }) => <h2 className="text-lg font-bold mt-6 mb-2 border-b border-line pb-1">{children}</h2>;
  const none = <p className="text-muted">{t('sitrep.none')}</p>;
  return (
    <div className="mx-auto max-w-4xl p-6 print:p-0 bg-surface print:bg-white">
      <div className="no-print flex gap-2 mb-4">
        <Link to={withPane('/authority')} className="btn-ghost"><ArrowLeft size={18} aria-hidden />{t('sitrep.back')}</Link>
        <button type="button" className="btn-primary" onClick={() => window.print()}><Printer size={18} aria-hidden />{t('sitrep.print')}</button>
      </div>
      {!s ? <div className="h-64 card animate-pulse" /> : (
        <article>
          <header className="flex items-center justify-between gap-4">
            <Logo />
            <div className="text-right">
              <h1 className="text-2xl font-bold">{t('sitrep.title')}</h1>
              <p className="label-mono">{t('sitrep.generated', { time: dateTimeIST(s.generated_at, lang) })}</p>
            </div>
          </header>
          <H>{t('sitrep.risk_counts')}</H>
          <div className="grid grid-cols-4 gap-2">{[...LEVELS].reverse().map((lv) => <div key={lv} className="card p-3 text-center"><RiskBadge level={lv} size="sm" /><p className="text-2xl font-bold mt-1">{s.levels[lv]}</p></div>)}</div>
          <H>{t('sitrep.top')}</H>
          <table className="w-full text-sm"><tbody className="divide-y divide-line">
            {s.top_locations.map((l) => (
              <tr key={l.id}><td className="py-1.5 font-semibold">{placeName(l, lang)}</td><td>{t(`districts.${l.district}`)}</td><td><RiskBadge level={l.level} size="sm" /></td>
                <td className="font-mono">{l.score.toFixed(2)}</td><td className="text-muted">{l.drivers.map((d) => driverLabel(d.key, lang)).join(', ')}</td></tr>
            ))}
          </tbody></table>
          <H>{t('sitrep.incidents')}</H>
          {s.incidents.length ? <ul className="list-disc pl-5">{s.incidents.map((i) => <li key={i.id}>{i.title} ({placeName(i, lang)}): {t(`stage.${i.stage}`)}</li>)}</ul> : none}
          <H>{t('sitrep.alerts')}</H>
          {s.alerts_today.length ? <ul className="list-disc pl-5">{s.alerts_today.map((a) => <li key={a.id}>{dateTimeIST(a.created_at, lang)}: {lang === 'hi' ? a.title_hi : a.title_en}{a.cancelled_at ? ` (${t('alertsx.cancelled')})` : ''}</li>)}</ul> : none}
          <H>{t('sitrep.roads')}</H>
          {s.roads_not_open.length ? <ul className="list-disc pl-5">{s.roads_not_open.map((r) => <li key={r.id}>{lang === 'hi' ? r.name_hi : r.name_en}: {t(`roads.st_${r.status}`)}{r.eta_clear_hours != null ? `, ${t('roads.eta', { count: r.eta_clear_hours })}` : ''}</li>)}</ul> : none}
          <H>{t('sitrep.resources')}</H>
          <ul className="grid grid-cols-2 gap-1 text-sm">{s.resources.map((r) => <li key={`${r.type}${r.status}`}>{t(`resources.ty_${r.type}`)}: {r.n} {t(`resources.st_${r.status}`)}</li>)}</ul>
          <H>{t('sitrep.reports')}</H>
          <p>{t('sitrep.reports_line', { total: s.reports.total || 0, pending: s.reports.pending || 0 })}</p>
          <p className="mt-1">{t('sitrep.acks', { count: s.citizen_acks_today })}</p>
        </article>
      )}
    </div>
  );
}
