import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Route as RouteIcon } from 'lucide-react';
import { withPane } from '../lib/viewAs';
import { useTranslation } from 'react-i18next';
import { api, errorKey } from '../api/client';
import type { Road } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { dateTimeIST, isDeva } from '../lib/format';
import { useLive } from './useLive';
import { PageHeader, PAGE_BODY } from '../components/PageHeader';

const STATUS: Road['status'][] = ['open', 'caution', 'restricted', 'blocked', 'cleared'];
const COLOR: Record<Road['status'], string> = { open: 'rgb(var(--risk-low))', cleared: 'rgb(var(--risk-low))', caution: 'rgb(var(--risk-moderate))', restricted: 'rgb(var(--risk-high))', blocked: 'rgb(var(--risk-critical))' };

function RoadRow({ road, onSaved }: { road: Road; onSaved: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { can } = useAuth();
  const canClose = can('roads.close');
  const canStatus = can('roads.status');
  const [f, setF] = useState({ status: road.status, eta: road.eta_clear_hours ?? '', den: road.diversion_en || '', dhi: road.diversion_hi || '', ta: road.tourist_advisory, hva: road.heavy_vehicle_advisory });
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const allowedStatuses = canClose ? STATUS : STATUS.filter((s) => s !== 'restricted');
  async function save() {
    setErr(null);
    const body: Record<string, unknown> = { status: f.status, eta_clear_hours: f.eta === '' ? null : Number(f.eta) };
    if (canClose) Object.assign(body, { diversion_en: f.den, diversion_hi: f.dhi, tourist_advisory: f.ta, heavy_vehicle_advisory: f.hva });
    try { await api.put(`/roads/${road.id}`, body); setSaved(true); setTimeout(() => setSaved(false), 2000); onSaved(); } catch (e) { setErr(errorKey(e)); }
  }
  return (
    <li className="card p-4 space-y-3" style={{ borderLeft: `6px solid ${COLOR[road.status]}` }}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold flex-1">{isDeva(lang) ? road.name_hi : road.name_en}</h2>
        <span className="rounded-pill px-2.5 py-0.5 text-xs font-bold" style={{ background: COLOR[road.status], color: road.status === 'caution' ? 'rgb(var(--risk-moderate-ink))' : '#fff' }}>{t(`roads.st_${road.status}`)}</span>
      </div>
      <p className="label-mono">{t('common.updated', { time: dateTimeIST(road.updated_at, lang) })}{road.updated_by ? ` · ${road.updated_by}` : ''}</p>
      {canClose || canStatus ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor={`st-${road.id}`}>{t('common.status')}</label>
            <select id={`st-${road.id}`} className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Road['status'] })}>
              {allowedStatuses.map((s) => <option key={s} value={s}>{t(`roads.st_${s}`)}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor={`eta-${road.id}`}>{t('roads.eta_label')}</label>
            <input name="eta" autoComplete="off" id={`eta-${road.id}`} className="input" type="number" min={0} step={0.5} value={f.eta} onChange={(e) => setF({ ...f, eta: e.target.value })} />
          </div>
          {canClose && (
            <>
              <div><label className="field-label" htmlFor={`den-${road.id}`}>{t('roads.diversion_en')}</label><input name="diversion_en" autoComplete="off" id={`den-${road.id}`} className="input" value={f.den} onChange={(e) => setF({ ...f, den: e.target.value })} /></div>
              <div><label className="field-label" htmlFor={`dhi-${road.id}`}>{t('roads.diversion_hi')}</label><input name="diversion_hi" autoComplete="off" id={`dhi-${road.id}`} lang="hi" className="input" value={f.dhi} onChange={(e) => setF({ ...f, dhi: e.target.value })} /></div>
              <label className="inline-flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={f.ta} onChange={(e) => setF({ ...f, ta: e.target.checked })} />{t('roads.tourist')}</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={f.hva} onChange={(e) => setF({ ...f, hva: e.target.checked })} />{t('roads.heavy')}</label>
            </>
          )}
          <div className="sm:col-span-2 flex items-center gap-3">
            <button type="button" className="btn-primary !min-h-[40px]" onClick={save}>{t('roads.save')}</button>
            {saved && <span className="text-risk-low font-semibold" role="status">{t('common.saved')}</span>}
            {err && <span className="field-error" role="alert">{t(err)}</span>}
          </div>
        </div>
      ) : (
        <>
          {road.eta_clear_hours != null && <p>{t('roads.eta', { count: road.eta_clear_hours })}</p>}
          {(isDeva(lang) ? road.diversion_hi : road.diversion_en) && <p><strong>{t('roads.diversion')}:</strong> {isDeva(lang) ? road.diversion_hi : road.diversion_en}</p>}
        </>
      )}
    </li>
  );
}

export default function RoadsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { data, reload } = useLive<{ roads: Road[] }>('/roads', ['road_updated']);
  return (
    <div>
      <PageHeader title={t('roads.title')}
        intro={!can('roads.close') && !can('roads.status') ? t('roads.read_only') : undefined}
        actions={<Link to={withPane('/authority/roads/check')} className="btn-secondary"><RouteIcon size={16} aria-hidden />{t('corridor.cta')}</Link>} />
      <div className={PAGE_BODY}>
        <ul className="grid gap-3 lg:grid-cols-2">{data?.roads.map((r) => <RoadRow key={`${r.id}-${r.updated_at}`} road={r} onSaved={reload} />)}</ul>
      </div>
    </div>
  );
}
