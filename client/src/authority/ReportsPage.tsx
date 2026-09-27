import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, ImageOff, Clock } from 'lucide-react';
import { api, errorKey } from '../api/client';
import type { Report } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { dateTimeIST, placeName, secondsSince } from '../lib/format';
import { riskConfig } from '../lib/risk';
import { useNow } from '../lib/useNow';
import { useLive } from './useLive';
import { useAuthority } from './AuthorityContext';

type F = 'submitted' | 'verified' | 'rejected' | 'resolved' | '';

export default function ReportsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { can } = useAuth();
  const { openOnMap } = useAuthority();
  const now = useNow(30000);
  const [filter, setFilter] = useState<F>('submitted');
  const [withIncident, setWithIncident] = useState<Record<string, boolean>>({});
  const [photo, setPhoto] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { data, reload } = useLive<{ reports: Report[] }>(`/reports${filter ? `?status=${filter}` : ''}`, ['report_updated']);
  const limit = riskConfig.management.unverifiedReportWarningMinutes;

  const [recorded, setRecorded] = useState<Record<string, boolean>>({});
  async function recordLandslide(r: Report) {
    try { await api.post('/ml/landslides', { report_id: r.id }); setRecorded((x) => ({ ...x, [r.id]: true })); } catch (e) {
      const k = errorKey(e);
      if (k === 'errors.already_recorded') setRecorded((x) => ({ ...x, [r.id]: true })); else setErr(k);
    }
  }
  async function setStatus(r: Report, status: string) {
    try { await api.post(`/reports/${r.id}/status`, { status, create_incident: status === 'verified' && !!withIncident[r.id] }); reload(); } catch (e) { setErr(errorKey(e)); }
  }

  return (
    <div className="mx-auto max-w-5xl p-4 space-y-4">
      <h1 className="text-2xl font-bold">{t('reports.title')}</h1>
      <div role="tablist" aria-label={t('common.status')} className="flex flex-wrap gap-1.5">
        {(['submitted', 'verified', 'rejected', 'resolved', ''] as F[]).map((f) => (
          <button key={f || 'all'} role="tab" type="button" aria-selected={filter === f} onClick={() => setFilter(f)}
            className={`rounded-pill px-3 py-1.5 text-sm font-semibold border ${filter === f ? 'bg-ink text-bg border-ink' : 'border-line text-muted hover:text-ink'}`}>
            {f ? t(`reports.f_${f}`) : t('common.all')}
          </button>
        ))}
      </div>
      {err && <p className="field-error" role="alert">{t(err)}</p>}
      {data && data.reports.length === 0 && <p className="card p-6 text-muted">{t('reports.empty')}</p>}
      <ul className="grid gap-3 md:grid-cols-2">
        {data?.reports.map((r) => {
          const mins = Math.floor((secondsSince(r.created_at, now) || 0) / 60);
          const overdue = r.status === 'submitted' && mins >= limit;
          return (
            <li key={r.id} className={`card p-4 space-y-2 ${overdue ? 'ring-2 ring-risk-high' : ''}`}>
              <div className="flex items-start gap-3">
                {r.has_photo ? (
                  <button type="button" onClick={() => setPhoto(`/api/reports/${r.id}/photo`)} className="shrink-0" aria-label={t('reports.photo')}>
                    <img src={`/api/reports/${r.id}/photo`} alt="" className="h-16 w-16 rounded-lg object-cover border border-line" loading="lazy" />
                  </button>
                ) : <span className="h-16 w-16 shrink-0 rounded-lg bg-surface-2 inline-flex items-center justify-center text-muted" title={t('reports.no_photo')}><ImageOff size={20} aria-hidden /></span>}
                <div className="flex-1 min-w-0">
                  <p className="font-bold">{t(`reports.ty_${r.type}`)}</p>
                  <p className="text-sm text-muted">{r.name_en ? placeName({ name_en: r.name_en, name_hi: r.name_hi || r.name_en }, lang) : ''}{r.district ? `, ${t(`districts.${r.district}`)}` : ''}</p>
                  <p className="label-mono">{dateTimeIST(r.created_at, lang)} · {t(`reports.st_${r.status}`)}</p>
                  {overdue && <p className="text-sm font-semibold text-risk-high inline-flex items-center gap-1"><Clock size={14} aria-hidden />{t('reports.overdue', { count: limit })}</p>}
                </div>
              </div>
              {r.description && <p className="text-[0.95rem]">{r.description}</p>}
              {r.reviewed_by && <p className="label-mono">{t('reports.reviewed_by', { name: r.reviewed_by })}</p>}
              <div className="flex flex-wrap gap-2 items-center">
                {r.location_id && <button type="button" className="btn-ghost !min-h-[36px] py-1 text-sm" onClick={() => openOnMap(r.location_id!)}><MapPin size={15} aria-hidden />{t('inbox.open_on_map')}</button>}
                {can('reports.verify') && r.status === 'submitted' && (
                  <>
                    <label className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={!!withIncident[r.id]} onChange={(e) => setWithIncident({ ...withIncident, [r.id]: e.target.checked })} />{t('reports.with_incident')}</label>
                    <button type="button" className="btn-primary !min-h-[36px] py-1 text-sm" onClick={() => setStatus(r, 'verified')}>{t('reports.verify')}</button>
                    <button type="button" className="btn-secondary !min-h-[36px] py-1 text-sm" onClick={() => setStatus(r, 'rejected')}>{t('reports.reject')}</button>
                  </>
                )}
                {can('reports.verify') && r.status === 'verified' && <button type="button" className="btn-secondary !min-h-[36px] py-1 text-sm" onClick={() => setStatus(r, 'resolved')}>{t('reports.resolve')}</button>}
                {can('landslides.record') && (r.status === 'verified' || r.status === 'resolved') && (
                  <button type="button" className="btn-secondary !min-h-[36px] py-1 text-sm" disabled={recorded[r.id]} onClick={() => recordLandslide(r)}>{recorded[r.id] ? t('ml.recorded') : t('ml.record_from_report')}</button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {photo && (
        <div role="dialog" aria-modal="true" aria-label={t('reports.photo')} className="fixed inset-0 z-[900] bg-black/70 flex items-center justify-center p-4" onClick={() => setPhoto(null)}>
          <img src={photo} alt="" className="max-h-[85vh] max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}
