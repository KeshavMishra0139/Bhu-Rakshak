import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ChevronDown, Siren, MapPin, ClipboardPlus, Megaphone, Truck, Search, Inbox } from 'lucide-react';
import { api, errorKey } from '../api/client';
import type { Incident, InboxMessage } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { useRiskStream, useStreamEvent } from '../live/RiskStreamProvider';
import { RiskBadge } from '../components/RiskBadge';
import { dateTimeIST, num, placeName, isDeva } from '../lib/format';
import { driverLabel } from '../lib/factors';
import { levelVar } from '../lib/risk';
import { withPane } from '../lib/viewAs';
import { useAuthority } from './AuthorityContext';

const FILTERS = ['all', 'critical', 'high', 'unread', 'my_district', 'escalated'] as const;
type Filter = (typeof FILTERS)[number];
const PAGE = 50;

export default function InboxPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const nav = useNavigate();
  const { me, can } = useAuth();
  const { corridors } = useRiskStream();
  const { openOnMap, draftAlert } = useAuthority();
  // Filters live in the address (?filter=critical&corridor=…&sort=priority&q=…), so a view can be bookmarked or shared.
  const [params, setParams] = useSearchParams();
  const setParam = (k: string, v: string, fallback: string) =>
    setParams((p) => { const n = new URLSearchParams(p); if (v && v !== fallback) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  const filter = (FILTERS as readonly string[]).includes(params.get('filter') || '') ? (params.get('filter') as Filter) : 'all';
  const corridor = params.get('corridor') || '';
  const q = params.get('q') || '';
  const sort: 'newest' | 'priority' = params.get('sort') === 'priority' ? 'priority' : 'newest';
  const setFilter = (v: Filter) => setParam('filter', v, 'all');
  const setCorridor = (v: string) => setParam('corridor', v, '');
  const setQ = (v: string) => setParam('q', v, '');
  const setSort = (v: 'newest' | 'priority') => setParam('sort', v, 'newest');
  const [messages, setMessages] = useState<InboxMessage[] | null>(null);
  // Long lists render 50 at a time ("Show more").
  const [shown, setShown] = useState(PAGE);
  useEffect(() => { setShown(PAGE); }, [filter, corridor, q, sort]);
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ filter, sort, limit: '150' });
    if (corridor) p.set('corridor', corridor);
    if (q.trim()) p.set('q', q.trim());
    try { setMessages((await api.get<{ messages: InboxMessage[] }>(`/inbox?${p}`)).messages); setErr(null); } catch (e) { setErr(errorKey(e)); }
  }, [filter, sort, corridor, q]);
  useEffect(() => { const id = setTimeout(load, 200); return () => clearTimeout(id); }, [load]);
  useStreamEvent('inbox_message', () => { load(); });
  useStreamEvent('inbox_updated', () => { load(); });

  async function markRead(ids: string[]) {
    if (!ids.length) return;
    await api.post('/inbox/read', { ids }).catch(() => {});
    setMessages((prev) => prev?.map((m) => (ids.includes(m.id) ? { ...m, read: true } : m)) || prev);
    setSelected(new Set());
  }
  async function ack(m: InboxMessage) {
    try { await api.post(`/inbox/${m.id}/ack`); load(); } catch (e) { setErr(errorKey(e)); }
  }
  async function ensureIncident(m: InboxMessage): Promise<string | null> {
    if (m.incident_id) return m.incident_id;
    try {
      const d = await api.post<{ incident: Incident }>('/incidents', {
        location_id: m.location_id, level: m.level, inbox_message_id: m.id,
        title: t(m.title_key, { place: placeName(m.params, 'en'), level: t(`levels.${m.level}`, { lng: 'en' }) }),
      });
      load();
      return d.incident.id;
    } catch (e) { setErr(errorKey(e)); return null; }
  }
  const goIncident = async (m: InboxMessage) => { const id = await ensureIncident(m); if (id) nav(withPane(`/authority/incidents?id=${id}`)); };

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const filters: Filter[] = ['all', 'critical', 'high', 'unread', 'escalated', ...(me?.actor.district && me.actor.district !== 'All' ? ['my_district' as Filter] : [])];

  return (
    <div className="mx-auto max-w-5xl p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold flex-1">{t('inbox.heading')}</h1>
        {selected.size > 0 && <button type="button" className="btn-secondary" onClick={() => markRead([...selected])}>{t('inbox.mark_read')} ({t('inbox.selected', { count: selected.size })})</button>}
        <button type="button" className="btn-ghost" onClick={() => api.post('/inbox/read', { all: true }).then(load)}>{t('inbox.mark_all_read')}</button>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <div role="tablist" aria-label={t('common.status')} className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button key={f} role="tab" type="button" aria-selected={filter === f} onClick={() => setFilter(f)}
              className={`rounded-pill px-3 py-1.5 text-sm font-semibold border ${filter === f ? 'bg-ink text-bg border-ink' : 'border-line text-muted hover:text-ink'}`}>
              {t(`inbox.filter_${f}`)}
            </button>
          ))}
        </div>
        <select aria-label={t('common.corridor')} className="input !min-h-[38px] py-1.5 max-w-[220px] text-sm" value={corridor} onChange={(e) => setCorridor(e.target.value)}>
          <option value="">{t('common.all_corridors')}</option>
          {corridors.map((c) => <option key={c.id} value={c.id}>{isDeva(lang) ? c.name_hi : c.name_en}</option>)}
        </select>
        <select aria-label={t('common.sort')} className="input !min-h-[38px] py-1.5 max-w-[150px] text-sm" value={sort} onChange={(e) => setSort(e.target.value as 'newest' | 'priority')}>
          <option value="newest">{t('common.newest')}</option>
          <option value="priority">{t('common.priority')}</option>
        </select>
        <div className="relative flex-1 min-w-[180px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <label htmlFor="inbox-q" className="sr-only">{t('inbox.search_placeholder')}</label>
          <input name="search" autoComplete="off" id="inbox-q" className="input !min-h-[38px] py-1.5 pl-9 text-sm" placeholder={t('inbox.search_placeholder')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {err && <p className="field-error" role="alert">{t(err)}</p>}

      {messages && messages.length === 0 && (
        <div className="card p-10 text-center text-muted">
          <Inbox size={36} className="mx-auto mb-2" aria-hidden />
          <p>{t('inbox.empty')}</p>
        </div>
      )}
      {!messages && !err && <div className="space-y-2">{[0, 1, 2].map((k) => <div key={k} className="h-20 card animate-pulse" />)}</div>}

      <ul className="space-y-2">
        {messages?.slice(0, shown).map((m) => {
          const p = m.params;
          const place = placeName(p, lang);
          const expanded = open === m.id;
          const needsAck = m.type !== 'deescalation' && !m.acknowledged_at;
          return (
            <li key={m.id} className={`card overflow-hidden ${m.escalated && !m.acknowledged_at ? 'ring-2 ring-risk-critical' : ''} ${m.read ? '' : 'bg-surface-2/40'}`}
              style={{ borderLeft: `6px solid ${levelVar(m.level)}` }}>
              <div className="flex items-start gap-3 p-3">
                <input type="checkbox" className="mt-1.5 h-4 w-4 accent-[rgb(var(--brand))]" checked={selected.has(m.id)} onChange={() => toggle(m.id)} aria-label={t('inbox.select')} />
                <button type="button" className="flex-1 text-left" aria-expanded={expanded}
                  onClick={() => { setOpen(expanded ? null : m.id); if (!m.read) markRead([m.id]); }}>
                  <span className="flex flex-wrap items-center gap-2">
                    <RiskBadge level={m.level} size="sm" />
                    {m.escalated && <span className="inline-flex items-center gap-1 text-xs font-bold text-risk-critical"><Siren size={13} aria-hidden />{t('inbox.escalated')}</span>}
                    {m.incident_id && <span className="text-xs font-semibold text-brand">{t('inbox.incident_linked')}</span>}
                    {!m.read && <span className="h-2 w-2 rounded-full bg-brand" aria-label={t('inbox.filter_unread')} />}
                    <span className="label-mono ml-auto">{dateTimeIST(m.created_at, lang)}</span>
                  </span>
                  <span className={`block mt-1 text-[1.02rem] ${m.read ? 'font-medium' : 'font-bold'}`}>{t(m.title_key, { place, level: t(`levels.${m.level}`) })}</span>
                  <span className="block text-sm text-muted">
                    {t(`districts.${p.district}`)} · {t('inbox.moved', { from: t(`levels.${p.from}`), to: t(`levels.${p.to}`) })} · {t('inbox.confidence', { value: Math.round((p.confidence || 0) * 100) })} · {t('inbox.trend', { trend: t(`trend.${p.trend}`) })}
                  </span>
                </button>
                <ChevronDown size={18} aria-hidden className={`mt-1 shrink-0 ${expanded ? 'rotate-180' : ''}`} />
              </div>
              {expanded && (
                <div className="px-4 pb-4 pl-10 grid gap-4 md:grid-cols-2 text-[0.95rem]">
                  <div>
                    <h3 className="font-semibold text-sm">{t('inbox.reasons')}</h3>
                    <ul className="mt-1 space-y-0.5">{p.drivers.map((d) => <li key={d.key}>{driverLabel(d.key, lang)} <span className="font-mono text-muted">{d.contribution}%</span></li>)}</ul>
                    {p.forecast?.length > 0 && (
                      <>
                        <h3 className="font-semibold text-sm mt-3">{t('inbox.forecast')}</h3>
                        <p className="font-mono text-sm">{p.forecast.map((f) => `+${f.h}h ${t(`levels.${f.level}`)}`).join(' · ')}</p>
                      </>
                    )}
                    <h3 className="font-semibold text-sm mt-3">{t('inbox.at_risk')}</h3>
                    <p className="text-muted">{t('inbox.exposure_line', { people: t('common.people_count', { n: num(p.exposure.population, lang) }), roads: p.exposure.roads.join(', ') || '–' })}</p>
                    {(p.exposure.facilities.length > 0 || p.exposure.critical_infra.length > 0) && <p className="text-muted">{[...p.exposure.facilities, ...p.exposure.critical_infra].join(', ')}</p>}
                  </div>
                  <div>
                    {p.sops?.length > 0 && (
                      <>
                        <h3 className="font-semibold text-sm">{t('inbox.suggested')}</h3>
                        <ul className="mt-1 list-disc pl-5">{p.sops.map((s) => <li key={s.key}>{isDeva(lang) ? s.hi : s.en}</li>)}</ul>
                      </>
                    )}
                    {m.acknowledged_at && (
                      <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-risk-low font-semibold">
                        <CheckCircle2 size={16} aria-hidden />{m.acknowledged_by_name ? t('inbox.acknowledged_by', { name: m.acknowledged_by_name }) : t('inbox.acknowledged')}
                        <span className="label-mono">{dateTimeIST(m.acknowledged_at, lang)}</span>
                      </p>
                    )}
                  </div>
                  <div className="md:col-span-2 flex flex-wrap gap-2">
                    {needsAck && <button type="button" className="btn-primary !min-h-[40px]" onClick={() => ack(m)}>{t('inbox.acknowledge')}</button>}
                    <button type="button" className="btn-secondary !min-h-[40px]" onClick={() => openOnMap(m.location_id)}><MapPin size={16} aria-hidden />{t('inbox.open_on_map')}</button>
                    {can('incidents.manage') && <button type="button" className="btn-secondary !min-h-[40px]" onClick={() => goIncident(m)}><ClipboardPlus size={16} aria-hidden />{t('inbox.create_incident')}</button>}
                    {can('alerts.dispatch') && m.type !== 'deescalation' && (
                      <button type="button" className="btn-secondary !min-h-[40px]" onClick={() => draftAlert({ locationId: m.location_id, severity: m.level, inboxId: m.id, incidentId: m.incident_id || undefined })}>
                        <Megaphone size={16} aria-hidden />{t('inbox.draft_alert')}
                      </button>
                    )}
                    {can('resources.deploy') && <button type="button" className="btn-secondary !min-h-[40px]" onClick={() => goIncident(m)}><Truck size={16} aria-hidden />{t('inbox.assign_resource')}</button>}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {messages && messages.length > shown && (
        <button type="button" className="btn-secondary w-full" onClick={() => setShown((n) => n + PAGE)}>
          {t('common.show_more', { count: Math.min(PAGE, messages.length - shown) })}
        </button>
      )}
    </div>
  );
}
