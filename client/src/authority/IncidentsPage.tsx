import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Incident } from '../api/types';
import { RiskBadge } from '../components/RiskBadge';
import { dateTimeIST, placeName } from '../lib/format';
import { useLive } from './useLive';
import { IncidentDetail, STAGES } from './IncidentDetail';
import { Clock, ClipboardList } from 'lucide-react';
import { useNow } from '../lib/useNow';

/** "45 min", "3 h 10 min", "2 d 4 h": how long an incident has been open. */
function openFor(since: string, now: number, t: (k: string, o?: Record<string, unknown>) => string) {
  const m = Math.max(0, Math.floor((now - Date.parse(since)) / 60000));
  if (m < 60) return t('incidents.dur_m', { m });
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? t('incidents.dur_hm', { h, m: m % 60 }) : t('incidents.dur_h', { h });
  return t('incidents.dur_dh', { d: Math.floor(h / 24), h: h % 24 });
}

export default function IncidentsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [params, setParams] = useSearchParams();
  const selected = params.get('id');
  const [showClosed, setShowClosed] = useState(false);
  const { data, error } = useLive<{ incidents: Incident[] }>('/incidents', ['incident_updated']);
  const now = useNow(60000);
  const stages = STAGES.filter((s) => showClosed || s !== 'closed');
  const select = (id: string | null) => { const p = new URLSearchParams(params); if (id) p.set('id', id); else p.delete('id'); setParams(p, { replace: true }); };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 min-w-0 overflow-auto">
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 pt-6 pb-5 sm:px-6">
          <h1 className="flex-1 text-[1.625rem] font-semibold leading-tight">{t('incidents.title')}</h1>
          <label className="inline-flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />{t('incidents.show_closed')}</label>
        </div>
        <div className="px-4 py-5 sm:px-6">
        {error && <p className="field-error" role="alert">{t(error)}</p>}
        <div className="flex gap-3 overflow-x-auto pb-3">
          {stages.map((s) => {
            const items = (data?.incidents || []).filter((i) => i.stage === s);
            return (
              <section key={s} className="w-[250px] shrink-0 rounded-card bg-surface-2/60 p-2" aria-labelledby={`col-${s}`}>
                <h2 id={`col-${s}`} className="flex items-center justify-between px-1.5 py-1 text-sm font-semibold">{t(`stage.${s}`)}<span className="min-w-[1.5rem] rounded-pill bg-surface px-1.5 text-center text-xs font-semibold tabular-nums text-muted shadow-sm">{items.length}</span></h2>
                <ul className="space-y-2 mt-1">
                  {!data && <li className="h-20 card animate-pulse" />}
                  {data && items.length === 0 && <li className="text-xs text-muted px-1 py-2">{t('incidents.empty')}</li>}
                  {items.map((i) => (
                    <li key={i.id}>
                      <button type="button" onClick={() => select(i.id)} aria-current={selected === i.id ? 'true' : undefined}
                        className={`w-full text-left card p-3 hover:border-brand ${selected === i.id ? 'border-brand ring-1 ring-brand' : ''}`}>
                        <span className="flex items-start gap-2"><span className="flex-1 font-semibold text-sm leading-snug">{i.title}</span><RiskBadge level={i.level} size="sm" /></span>
                        <span className="block text-xs text-muted mt-1">{placeName(i, lang)} · {i.owner_name || t('incidents.no_owner')}</span>
                        <span className="block label-mono mt-1">{dateTimeIST(i.detected_at, lang)}</span>
                        {s !== 'resolved' && s !== 'closed' && (
                          <span className="mt-1.5 inline-flex items-center gap-1 rounded-pill bg-surface-2 px-2 py-0.5 text-xs font-semibold tabular-nums">
                            <Clock size={12} aria-hidden />{t('incidents.open_for', { time: openFor(i.detected_at, now, t) })}
                          </span>
                        )}
                        {(i.resource_count || 0) > 0 && <span className="block text-xs mt-1">{t('incidents.resources')}: {i.resource_count}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
        </div>
      </div>
      <aside className={`${selected ? 'block' : 'hidden xl:block'} w-[420px] max-w-full shrink-0 border-l border-line bg-surface overflow-y-auto p-4 max-xl:absolute max-xl:inset-y-0 max-xl:right-0 max-xl:z-[700] max-xl:shadow-2xl`}>
        {selected ? <IncidentDetail key={selected} id={selected} onClose={() => select(null)} /> : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-surface-2" aria-hidden><ClipboardList size={24} /></span>
            <p className="max-w-[16rem]">{t('incidents.select_prompt')}</p>
          </div>
        )}
      </aside>
    </div>
  );
}
