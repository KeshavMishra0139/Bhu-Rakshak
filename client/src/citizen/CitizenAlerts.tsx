import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Phone, Share2, CheckCircle2, ShieldCheck } from 'lucide-react';
import { api, errorKey } from '../api/client';
import type { AlertItem } from '../api/types';
import { useRiskStream, useStreamEvent } from '../live/RiskStreamProvider';
import { useCitizen } from './CitizenContext';
import { RiskBadge } from '../components/RiskBadge';
import { dateTimeIST, isDeva } from '../lib/format';
import { levelVar } from '../lib/risk';

const ACKED = 'br.alertAcks';
const readAcked = (): string[] => { try { return JSON.parse(localStorage.getItem(ACKED) || '[]'); } catch { return []; } };

export default function CitizenAlerts() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { locations } = useRiskStream();
  const { homeId } = useCitizen();
  const [alerts, setAlerts] = useState<AlertItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [acked, setAcked] = useState<string[]>(readAcked);
  const home = homeId ? locations[homeId] : undefined;

  const load = () => api.get<{ alerts: AlertItem[] }>('/alerts').then((d) => setAlerts(d.alerts)).catch((e) => setErr(errorKey(e)));
  useEffect(() => { load(); }, []);
  useStreamEvent('alert_published', (a) => setAlerts((prev) => [a, ...(prev || []).filter((x) => x.id !== a.id)]));
  useStreamEvent('alert_cancelled', () => { load(); });

  const inMyArea = (a: AlertItem) => !!home && (
    (a.target_type === 'location' && a.target_id === home.id) || (a.target_type === 'corridor' && a.target_id === home.corridor_id) || (a.target_type === 'district' && a.target_id === home.district));

  async function ack(a: AlertItem) {
    await api.post(`/alerts/${a.id}/ack`).catch(() => {});
    const next = [...acked, a.id];
    setAcked(next);
    try { localStorage.setItem(ACKED, JSON.stringify(next.slice(-200))); } catch { /* ignore */ }
  }

  const share = (a: AlertItem) => {
    const title = isDeva(lang) ? a.title_hi : a.title_en;
    const body = isDeva(lang) ? a.body_hi : a.body_en;
    return `https://wa.me/?text=${encodeURIComponent(`${title}\n${body}\n— ${t('app.name')} (${dateTimeIST(a.created_at, lang)} IST)`)}`;
  };

  return (
    <div className="space-y-4">
      <h1 className="text-[1.8rem] font-bold">{t('citizen.alerts_title')}</h1>
      {err && <p className="field-error" role="alert">{t(err)}</p>}
      {!alerts && !err && <div className="space-y-3">{[0, 1].map((k) => <div key={k} className="h-32 card animate-pulse" />)}</div>}
      {alerts && alerts.length === 0 && <p className="card p-6 text-muted">{t('citizen.alerts_empty')}</p>}
      <ul className="space-y-3">
        {alerts?.map((a) => {
          const clear = a.kind === 'all_clear';
          const cancelled = !!a.cancelled_at;
          const color = clear ? 'rgb(var(--risk-low))' : levelVar(a.severity);
          return (
            <li key={a.id} className={`card p-5 ${cancelled ? 'opacity-60' : ''}`} style={{ borderLeft: `6px solid ${color}` }}>
              <div className="flex flex-wrap items-center gap-2">
                {clear ? (
                  <span className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-sm font-semibold text-white" style={{ background: color }}>
                    <ShieldCheck size={15} aria-hidden />{t('citizen.all_clear')}
                  </span>
                ) : <RiskBadge level={a.severity} size="sm" />}
                {inMyArea(a) && <span className="rounded-pill bg-brand/15 text-brand px-2.5 py-1 text-sm font-semibold">{t('citizen.your_area')}</span>}
                {cancelled && <span className="text-sm font-semibold">{t('citizen.cancelled')}</span>}
                <span className="label-mono ml-auto">{dateTimeIST(a.created_at, lang)}</span>
              </div>
              <h2 className="mt-2 text-xl font-bold">{isDeva(lang) ? a.title_hi : a.title_en}</h2>
              <p className="text-sm text-muted">{isDeva(lang) ? a.target_name_hi : a.target_name_en}</p>
              <p className="mt-2 text-[1.05rem]">{isDeva(lang) ? a.body_hi : a.body_en}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {!clear && !cancelled && (acked.includes(a.id)
                  ? <span className="inline-flex items-center gap-1.5 text-risk-low font-semibold min-h-[44px]"><CheckCircle2 size={18} aria-hidden />{t('citizen.thanks_ack')}</span>
                  : <button type="button" className="btn-primary" onClick={() => ack(a)}>{t('citizen.understood')}</button>)}
                <a className="btn-secondary" href={share(a)} target="_blank" rel="noopener noreferrer"><Share2 size={18} aria-hidden />{t('citizen.share_whatsapp')}</a>
                <a className="btn-secondary" href="tel:112"><Phone size={18} aria-hidden />{t('citizen.call_112')}</a>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
