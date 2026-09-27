import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckSquare, Square, UserCheck, Megaphone, MapPin, X, Mountain } from 'lucide-react';
import { api, errorKey } from '../api/client';
import type { Incident, Resource, Sop, Stage } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { useStreamEvent } from '../live/RiskStreamProvider';
import { RiskBadge } from '../components/RiskBadge';
import { dateTimeIST, placeName, isDeva } from '../lib/format';
import { useAuthority } from './AuthorityContext';

export const STAGES: Stage[] = ['detected', 'under_verification', 'verified', 'alert_issued', 'response_underway', 'resolved', 'closed'];

export function IncidentDetail({ id, onClose }: { id: string; onClose?: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { me, can } = useAuth();
  const { openOnMap, draftAlert } = useAuthority();
  const [inc, setInc] = useState<Incident | null>(null);
  const [sops, setSops] = useState<Sop[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [note, setNote] = useState('');
  const [pick, setPick] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ incident: Incident; sops: Sop[] }>(`/incidents/${id}`);
      setInc(d.incident);
      setSops(d.sops);
    } catch (e) { setErr(errorKey(e)); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (can('resources.deploy')) api.get<{ resources: Resource[] }>('/resources').then((d) => setResources(d.resources)).catch(() => {}); }, [can, inc?.resources?.length]);
  useStreamEvent('incident_updated', (e) => { if (e.id === id) load(); });

  const [recorded, setRecorded] = useState(false);
  async function recordLandslide() {
    setErr(null);
    try { await api.post('/ml/landslides', { incident_id: id }); setRecorded(true); } catch (e) {
      const k = errorKey(e);
      if (k === 'errors.already_recorded') setRecorded(true); else setErr(k);
    }
  }
  async function act<T>(fn: () => Promise<T>) {
    setErr(null);
    try { const r = await fn() as unknown as { incident?: Incident }; if (r?.incident) setInc(r.incident); } catch (e) { setErr(errorKey(e)); }
  }
  if (!inc) return <div className="p-4 text-muted">{err ? t(err) : t('common.loading')}</div>;

  const ticks = new Map((inc.sop_ticks || []).map((x) => [x.sop_key, x]));
  const isLead = can('alerts.dispatch');
  const subRole = me?.actor.sub_role;
  const canManage = can('incidents.manage');
  const canRespond = can('incidents.respond');
  const allowedStages = STAGES.filter((s) => s !== inc.stage && (canManage || (canRespond && ['response_underway', 'resolved'].includes(s))));
  const assignedIds = new Set((inc.resources || []).map((r) => r.id));
  const assignable = resources.filter((r) => !assignedIds.has(r.id) && r.status !== 'unavailable')
    .sort((a, b) => Number(b.district === inc.district) - Number(a.district === inc.district));
  const addNote = (e: FormEvent) => { e.preventDefault(); if (note.trim()) act(() => api.post(`/incidents/${inc.id}/note`, { note })).then(() => setNote('')); };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h3 className="text-lg font-bold leading-snug">{inc.title}</h3>
          <p className="text-sm text-muted">{placeName(inc, lang)}, {t(`districts.${inc.district}`)} · {t(`incidents.src_${inc.source}`)}</p>
          <p className="label-mono">{t('incidents.detected_at', { time: dateTimeIST(inc.detected_at, lang) })}</p>
        </div>
        <RiskBadge level={inc.level} size="sm" />
        {onClose && <button type="button" onClick={onClose} className="p-1.5 text-muted hover:text-ink" aria-label={t('common.close')}><X size={18} aria-hidden /></button>}
      </div>

      {/* Lifecycle */}
      <ol className="flex flex-wrap gap-1" aria-label={t('common.status')}>
        {STAGES.map((s, i) => {
          const reached = STAGES.indexOf(inc.stage) >= i;
          return (
            <li key={s} aria-current={s === inc.stage ? 'step' : undefined}
              className={`rounded-pill px-2.5 py-1 text-xs font-semibold border ${s === inc.stage ? 'bg-brand text-white border-brand' : reached ? 'border-brand/40 text-brand' : 'border-line text-muted'}`}>
              {t(`stage.${s}`)}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm"><span className="text-muted">{t('incidents.owner')}:</span> <strong>{inc.owner_name || t('incidents.no_owner')}</strong></span>
        {canManage && inc.owner_id !== me?.user.id && (
          <button type="button" className="btn-ghost !min-h-[36px] py-1 text-sm" onClick={() => act(() => api.post(`/incidents/${inc.id}/owner`))}><UserCheck size={16} aria-hidden />{t('incidents.take')}</button>
        )}
      </div>
      {allowedStages.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`stage-${inc.id}`} className="text-sm font-semibold">{t('incidents.move_to')}</label>
          <select id={`stage-${inc.id}`} className="input !min-h-[40px] py-1.5 max-w-[240px]" value="" onChange={(e) => e.target.value && act(() => api.post(`/incidents/${inc.id}/stage`, { stage: e.target.value }))}>
            <option value="">—</option>
            {allowedStages.map((s) => <option key={s} value={s}>{t(`stage.${s}`)}</option>)}
          </select>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary !min-h-[38px] py-1.5 text-sm" onClick={() => openOnMap(inc.location_id)}><MapPin size={16} aria-hidden />{t('inbox.open_on_map')}</button>
        {isLead && <button type="button" className="btn-secondary !min-h-[38px] py-1.5 text-sm" onClick={() => draftAlert({ locationId: inc.location_id, severity: inc.level === 'low' ? 'moderate' : inc.level, incidentId: inc.id })}><Megaphone size={16} aria-hidden />{t('drawer.draft_alert')}</button>}
        {can('landslides.record') && <button type="button" className="btn-secondary !min-h-[38px] py-1.5 text-sm" disabled={recorded} onClick={recordLandslide}><Mountain size={16} aria-hidden />{recorded ? t('ml.recorded') : t('ml.record_from_incident')}</button>}
      </div>
      {err && <p className="field-error" role="alert">{t(err)}</p>}

      {/* SOP checklist */}
      {sops.length > 0 && (
        <section>
          <h4 className="font-bold">{t('incidents.sop')}</h4>
          <p className="text-sm text-muted">{t('incidents.sop_hint', { level: t(`levels.${inc.level}`) })}</p>
          <ul className="mt-2 space-y-1">
            {sops.map((s) => {
              const tick = ticks.get(s.key);
              const done = !!tick?.done;
              const allowed = isLead || (!!subRole && s.roles.includes(subRole));
              const Icon = done ? CheckSquare : Square;
              return (
                <li key={s.key}>
                  <button type="button" disabled={!allowed} onClick={() => act(() => api.post(`/incidents/${inc.id}/sop`, { key: s.key, done: !done }))}
                    className={`w-full text-left flex items-start gap-2.5 rounded-lg px-2 py-2 ${allowed ? 'hover:bg-surface-2' : 'opacity-60 cursor-not-allowed'}`} aria-pressed={done}>
                    <Icon size={20} className={done ? 'text-risk-low shrink-0' : 'text-muted shrink-0'} aria-hidden />
                    <span className="flex-1">
                      <span className={done ? 'line-through text-muted' : ''}>{isDeva(lang) ? s.text_hi : s.text_en}</span>
                      <span className="block text-xs text-muted">{t('incidents.sop_roles', { roles: s.roles.map((r) => t(`roles.${r}`)).join(', ') })}</span>
                      {tick && <span className="block label-mono">{tick.actor} · {dateTimeIST(tick.at, lang)}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Resources */}
      <section>
        <h4 className="font-bold">{t('incidents.resources')}</h4>
        <ul className="mt-2 space-y-1.5">
          {(inc.resources || []).length === 0 && <li className="text-sm text-muted">{t('incidents.none_assigned')}</li>}
          {(inc.resources || []).map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1"><strong>{r.name}</strong> <span className="text-muted">· {t(`resources.ty_${r.type}`)}</span></span>
              {can('resources.deploy') && <button type="button" className="text-brand font-semibold hover:underline" onClick={() => act(() => api.del(`/incidents/${inc.id}/resources/${r.id}`))}>{t('common.release')}</button>}
            </li>
          ))}
        </ul>
        {can('resources.deploy') && (
          <div className="mt-2 flex gap-2">
            <label htmlFor={`res-${inc.id}`} className="sr-only">{t('incidents.choose_resource')}</label>
            <select id={`res-${inc.id}`} className="input !min-h-[40px] py-1.5" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">{t('incidents.choose_resource')}</option>
              {assignable.map((r) => <option key={r.id} value={r.id}>{r.name} · {t(`districts.${r.district}`)} · {t(`resources.st_${r.status}`)}</option>)}
            </select>
            <button type="button" className="btn-secondary !min-h-[40px]" disabled={!pick}
              onClick={() => act(() => api.post(`/incidents/${inc.id}/resources`, { resource_id: pick })).then(() => setPick(''))}>{t('common.assign')}</button>
          </div>
        )}
      </section>

      {(inc.alerts || []).length > 0 && (
        <section>
          <h4 className="font-bold">{t('incidents.alerts')}</h4>
          <ul className="mt-1 text-sm space-y-1">
            {inc.alerts!.map((a) => <li key={a.id}>{isDeva(lang) ? a.title_hi : a.title_en} <span className="label-mono">{dateTimeIST(a.created_at, lang)}</span>{a.cancelled_at && ` · ${t('alertsx.cancelled')}`}</li>)}
          </ul>
        </section>
      )}

      {/* Timeline + notes */}
      <section>
        <h4 className="font-bold">{t('incidents.timeline')}</h4>
        <form onSubmit={addNote} className="mt-2 flex gap-2">
          <label htmlFor={`note-${inc.id}`} className="sr-only">{t('incidents.note_placeholder')}</label>
          <input id={`note-${inc.id}`} className="input !min-h-[40px] py-1.5" placeholder={t('incidents.note_placeholder')} value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="submit" className="btn-secondary !min-h-[40px]" disabled={!note.trim()}>{t('incidents.add_note')}</button>
        </form>
        <ol className="mt-3 border-l-2 border-line pl-4 space-y-2.5">
          {[...(inc.events || [])].reverse().map((e) => (
            <li key={e.id} className="text-sm">
              <span className="label-mono block">{dateTimeIST(e.at, lang)} · {e.actor}</span>
              {e.to_stage && <span className="font-semibold">{t('incidents.stage_changed', { stage: t(`stage.${e.to_stage}`) })}</span>}
              {e.note && <span className="block">{e.note}</span>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
