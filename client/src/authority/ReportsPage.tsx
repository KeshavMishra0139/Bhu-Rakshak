import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { MapPin, ImageOff, Clock, X, FileWarning } from 'lucide-react';
import { api, errorKey } from '../api/client';
import type { Report } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { dateTimeIST, placeName, secondsSince } from '../lib/format';
import { riskConfig } from '../lib/risk';
import { useNow } from '../lib/useNow';
import { useLive } from './useLive';
import { useAuthority } from './AuthorityContext';
import { EmptyState, PageHeader, PAGE_BODY } from '../components/PageHeader';

type F = 'submitted' | 'verified' | 'rejected' | 'resolved' | '';

export default function ReportsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { can } = useAuth();
  const { openOnMap } = useAuthority();
  const now = useNow(30000);
  const [filter, setFilter] = useState<F>('submitted');
  const [withIncident, setWithIncident] = useState<Record<string, boolean>>({});
  const [photo, setPhoto] = useState<{ src: string; alt: string } | null>(null);
  const closePhoto = useCallback(() => setPhoto(null), []);
  // Describes the evidence for screen readers, e.g. "Photo: Debris, Mangan, North Sikkim".
  const photoAlt = (r: Report) => {
    const place = r.name_en ? placeName({ name_en: r.name_en, name_hi: r.name_hi || r.name_en }, lang) : '';
    const where = [place, r.district ? t(`districts.${r.district}`) : ''].filter(Boolean).join(', ');
    return `${t('reports.photo')}: ${t(`reports.ty_${r.type}`)}${where ? `, ${where}` : ''}`;
  };
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
    <div>
      <PageHeader title={t('reports.title')}>
      <div role="tablist" aria-label={t('common.status')} className="seg">
        {(['submitted', 'verified', 'rejected', 'resolved', ''] as F[]).map((f) => (
          <button key={f || 'all'} role="tab" type="button" aria-selected={filter === f} onClick={() => setFilter(f)} className="seg-btn">
            {f ? t(`reports.f_${f}`) : t('common.all')}
          </button>
        ))}
      </div>
      </PageHeader>
      <div className={`${PAGE_BODY} space-y-4`}>
      {err && <p className="field-error" role="alert">{t(err)}</p>}
      {data && data.reports.length === 0 && <EmptyState icon={<FileWarning size={24} />}><p>{t('reports.empty')}</p></EmptyState>}
      <ul className="grid gap-3 md:grid-cols-2">
        {data?.reports.map((r) => {
          const mins = Math.floor((secondsSince(r.created_at, now) || 0) / 60);
          const overdue = r.status === 'submitted' && mins >= limit;
          return (
            <li key={r.id} className={`card p-4 space-y-2 ${overdue ? 'ring-2 ring-risk-high' : ''}`}>
              <div className="flex items-start gap-3">
                {r.has_photo ? (
                  <button type="button" onClick={() => setPhoto({ src: `/api/reports/${r.id}/photo`, alt: photoAlt(r) })} className="shrink-0">
                    <img src={`/api/reports/${r.id}/photo`} alt={photoAlt(r)} width={64} height={64} className="h-16 w-16 rounded-lg object-cover border border-line" loading="lazy" />
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
      </div>
      {photo && <PhotoDialog src={photo.src} alt={photo.alt} onClose={closePhoto} />}
    </div>
  );
}

/** Full-size report photo: Escape or the close button closes it; focus moves in, stays in, and returns to the thumbnail. */
function PhotoDialog({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const { t } = useTranslation();
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'Tab') { e.preventDefault(); closeBtn.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); opener?.focus(); };
  }, [onClose]);
  // Rendered into <body>: the page's entrance animation (a transform) would otherwise pin "fixed" to the page,
  // leaving the header uncovered and clickable behind a modal.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={alt} className="fixed inset-0 z-[900] bg-black/70 flex items-center justify-center p-4 overscroll-contain" onClick={onClose}>
      <img src={src} alt={alt} className="max-h-[85vh] max-w-full rounded-lg" onClick={(e) => e.stopPropagation()} />
      <button ref={closeBtn} type="button" onClick={onClose} aria-label={t('common.close')}
        className="btn absolute right-4 top-4 bg-black/60 px-3 text-white hover:bg-black/80">
        <X size={20} aria-hidden />
      </button>
    </div>,
    document.body,
  );
}
