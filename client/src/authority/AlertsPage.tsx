import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Send, RefreshCw, Ban, ShieldCheck, Megaphone } from 'lucide-react';
import { api, errorKey } from '../api/client';
import type { AlertItem, Level } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { useRiskStream } from '../live/RiskStreamProvider';
import { RiskBadge } from '../components/RiskBadge';
import { useToasts } from '../components/Toasts';
import { dateTimeIST, placeName, isDeva } from '../lib/format';
import { useLive } from './useLive';
import { LEVEL_ICON } from '../lib/risk';
import { EmptyState, PageHeader, PAGE_BODY } from '../components/PageHeader';

// Severity options: an outlined tile; the chosen one takes its level's colour as a tint and a 2px edge.
const SEV = 'inline-flex min-h-[40px] items-center gap-2 rounded-[10px] border px-3 text-sm font-semibold transition-colors';

type Draft = { target_type: string; target_id: string; severity: Level; kind: 'warning' | 'all_clear'; title_en: string; title_hi: string; body_en: string; body_hi: string };
const DISTRICTS = ['East Sikkim', 'West Sikkim', 'North Sikkim', 'South Sikkim', 'Kalimpong', 'Darjeeling'];

export default function AlertsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { can } = useAuth();
  const toasts = useToasts();
  const { list, corridors } = useRiskStream();
  const [params] = useSearchParams();
  const { data, reload } = useLive<{ alerts: AlertItem[] }>('/alerts?limit=100', ['alert_published', 'alert_cancelled']);
  const [f, setF] = useState<Draft>({
    target_type: params.get('target_type') || 'location', target_id: params.get('target_id') || '', severity: (params.get('severity') as Level) || 'high',
    kind: 'warning', title_en: '', title_hi: '', body_en: '', body_hi: '',
  });
  const [nonce, setNonce] = useState(0);
  const [channels, setChannels] = useState<string[]>(['dashboard']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const incidentId = params.get('incident');
  const inboxId = params.get('inbox');

  // Auto-draft bilingual text whenever the target, severity or kind changes.
  useEffect(() => {
    if (!f.target_id || !can('alerts.dispatch')) return;
    const sev = f.severity === 'low' ? 'moderate' : f.severity;
    api.get<{ draft: Draft }>(`/alerts/draft?target_type=${f.target_type}&target_id=${encodeURIComponent(f.target_id)}&severity=${sev}&kind=${f.kind}`)
      .then((d) => setF((x) => ({ ...x, title_en: d.draft.title_en, title_hi: d.draft.title_hi, body_en: d.draft.body_en, body_hi: d.draft.body_hi })))
      .catch(() => {});
  }, [f.target_type, f.target_id, f.severity, f.kind, can, nonce]);

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post('/alerts', { ...f, channels, incident_id: incidentId || undefined, inbox_message_id: inboxId || undefined });
      toasts.push({ text: t('alertsx.sent'), level: f.kind === 'all_clear' ? 'low' : f.severity });
      reload();
    } catch (e2) { setErr(errorKey(e2)); } finally { setBusy(false); }
  }

  const targets = f.target_type === 'location' ? [...list].sort((a, b) => placeName(a, lang).localeCompare(placeName(b, lang))).map((l) => ({ id: l.id, name: placeName(l, lang) }))
    : f.target_type === 'corridor' ? corridors.map((c) => ({ id: c.id, name: isDeva(lang) ? c.name_hi : c.name_en }))
      : DISTRICTS.map((d) => ({ id: d, name: t(`districts.${d}`) }));
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <div>
    <PageHeader title={t('nav.alerts')} />
    <div className={`${PAGE_BODY} grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]`}>
      {can('alerts.dispatch') ? (
        <form onSubmit={send} className="card p-5 space-y-4 self-start" aria-labelledby="dispatch-title">
          <h2 id="dispatch-title" className="text-xl font-semibold">{t('alertsx.dispatch')}</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="a-tt" className="field-label">{t('alertsx.target_type')}</label>
              <select id="a-tt" className="input" value={f.target_type} onChange={(e) => setF({ ...f, target_type: e.target.value, target_id: '' })}>
                {(['location', 'corridor', 'district'] as const).map((k) => <option key={k} value={k}>{t(`alertsx.t_${k}`)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="a-tid" className="field-label">{t('common.location')}</label>
              <select id="a-tid" className="input" value={f.target_id} onChange={set('target_id')} required>
                <option value="">{t('alertsx.choose_target')}</option>
                {targets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('alertsx.severity')}>
            {(['moderate', 'high', 'critical'] as Level[]).map((lv) => {
              const on = f.kind === 'warning' && f.severity === lv;
              const Icon = LEVEL_ICON[lv];
              return (
                <button key={lv} type="button" role="radio" aria-checked={on} onClick={() => setF({ ...f, kind: 'warning', severity: lv })}
                  className={`${SEV} ${on ? 'border-transparent text-ink' : 'border-line text-muted hover:bg-surface-2 hover:text-ink'}`}
                  style={on ? { background: `rgb(var(--risk-${lv}) / 0.12)`, boxShadow: `inset 0 0 0 2px rgb(var(--risk-${lv}))` } : undefined}>
                  <Icon size={16} strokeWidth={2.4} style={{ color: `rgb(var(--risk-${lv}))` }} aria-hidden />{t(`levels.${lv}`)}
                </button>
              );
            })}
            <button type="button" role="radio" aria-checked={f.kind === 'all_clear'} onClick={() => setF({ ...f, kind: 'all_clear' })}
              className={`${SEV} ${f.kind === 'all_clear' ? 'border-transparent text-ink' : 'border-line text-muted hover:bg-surface-2 hover:text-ink'}`}
              style={f.kind === 'all_clear' ? { background: 'rgb(var(--risk-low) / 0.12)', boxShadow: 'inset 0 0 0 2px rgb(var(--risk-low))' } : undefined}>
              <ShieldCheck size={16} strokeWidth={2.4} className="text-risk-low" aria-hidden />{t('alertsx.kind_all_clear')}
            </button>
          </div>
          {(['title_en', 'title_hi', 'body_en', 'body_hi'] as const).map((k) => (
            <div key={k}>
              <label htmlFor={`a-${k}`} className="field-label">{t(`alertsx.${k}`)}</label>
              {k.startsWith('title')
                ? <input name={k} autoComplete="off" id={`a-${k}`} className="input" lang={k.endsWith('hi') ? 'hi' : 'en'} value={f[k]} onChange={set(k)} required maxLength={160} />
                : <textarea name={k} autoComplete="off" id={`a-${k}`} className="input min-h-[90px]" lang={k.endsWith('hi') ? 'hi' : 'en'} value={f[k]} onChange={set(k)} required maxLength={1000} />}
            </div>
          ))}
          <fieldset>
            <legend className="field-label">{t('alertsx.channels')}</legend>
            {(['dashboard', 'sms', 'push'] as const).map((c) => (
              <label key={c} className="flex items-center gap-2 py-1">
                <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" disabled={c === 'dashboard'} checked={channels.includes(c)}
                  onChange={(e) => setChannels((x) => (e.target.checked ? [...x, c] : x.filter((y) => y !== c)))} />
                {t(`alertsx.ch_${c}`)}
              </label>
            ))}
          </fieldset>
          {incidentId && <p className="text-sm text-brand font-semibold">{t('alertsx.linked_incident')}</p>}
          {err && <p className="field-error" role="alert">{t(err)}</p>}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={busy || !f.target_id}><Send size={18} aria-hidden />{f.kind === 'all_clear' ? t('alertsx.all_clear_btn') : t('alertsx.send')}</button>
            <button type="button" className="btn-ghost" onClick={() => setNonce((n) => n + 1)} title={t('alertsx.redraft')} aria-label={t('alertsx.redraft')}><RefreshCw size={18} aria-hidden /></button>
          </div>
        </form>
      ) : <div />}

      <section aria-labelledby="history-title" className="space-y-3">
        <h2 id="history-title" className="text-xl font-semibold">{t('alertsx.history')}</h2>
        {data && data.alerts.length === 0 && <EmptyState icon={<Megaphone size={24} />}><p>{t('alertsx.empty')}</p></EmptyState>}
        {!data && <div className="h-32 card animate-pulse" />}
        <ul className="space-y-3">
          {data?.alerts.map((a) => (
            <li key={a.id} className={`card p-4 ${a.cancelled_at ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-center gap-2">
                {a.kind === 'all_clear' ? <span className="rounded-pill bg-risk-low text-white px-2.5 py-0.5 text-xs font-semibold">{t('alertsx.kind_all_clear')}</span> : <RiskBadge level={a.severity} size="sm" />}
                <span className="text-sm font-semibold">{isDeva(lang) ? a.target_name_hi : a.target_name_en}</span>
                {a.cancelled_at && <span className="text-sm font-semibold">{t('alertsx.cancelled')}</span>}
                <span className="label-mono ml-auto">{dateTimeIST(a.created_at, lang)}</span>
              </div>
              <p className="mt-1.5 font-bold">{isDeva(lang) ? a.title_hi : a.title_en}</p>
              <p className="text-sm text-muted">{isDeva(lang) ? a.body_hi : a.body_en}</p>
              {a.created_by && <p className="label-mono mt-1">{t('alertsx.sent_by', { name: a.created_by })}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-semibold">{t('alertsx.acks', { count: a.ack_count || 0 })}</span>
                {a.deliveries?.map((d, i) => <span key={i} className="text-muted">{t(`alertsx.ch_${d.channel}`)}: {t(`alertsx.d_${d.status}`)}</span>)}
              </div>
              {can('alerts.dispatch') && !a.cancelled_at && (
                <button type="button" className="btn-ghost !min-h-[36px] py-1 mt-2 text-sm" onClick={() => { if (window.confirm(t('alertsx.cancel_confirm'))) api.post(`/alerts/${a.id}/cancel`).then(reload); }}><Ban size={15} aria-hidden />{t('alertsx.cancel')}</button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
    </div>
  );
}
