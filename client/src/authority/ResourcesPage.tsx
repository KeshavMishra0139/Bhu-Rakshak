import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { Resource } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { placeName } from '../lib/format';
import { useLive } from './useLive';
import { PageHeader, PAGE_BODY } from '../components/PageHeader';

const TYPES: Resource['type'][] = ['excavator', 'rescue_team', 'ambulance', 'shelter'];
const DOT = { available: 'bg-risk-low', deployed: 'bg-risk-high', unavailable: 'bg-muted' } as const;

export default function ResourcesPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { can } = useAuth();
  const { data, reload } = useLive<{ resources: Resource[] }>('/resources', ['resource_updated', 'incident_updated']);
  const update = (id: string, body: Record<string, unknown>) => api.put(`/resources/${id}`, body).then(reload).catch(() => {});
  return (
    <div>
      <PageHeader title={t('resources.title')} />
      <div className={`${PAGE_BODY} space-y-6`}>
      {TYPES.map((ty) => (
        <section key={ty} aria-labelledby={`ty-${ty}`}>
          <h2 id={`ty-${ty}`} className="text-lg font-semibold mb-2">{t(`resources.ty_${ty}`)}</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data?.resources.filter((r) => r.type === ty).map((r) => (
              <li key={r.id} className="card p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${DOT[r.status]}`} aria-hidden />
                  <span className="font-semibold flex-1">{r.name}</span>
                  {r.incident_id && <span className="text-xs text-brand font-semibold">{t('resources.on_incident')}</span>}
                </div>
                <p className="text-sm text-muted">{r.location_en ? placeName({ name_en: r.location_en, name_hi: r.location_hi || r.location_en }, lang) : ''}, {t(`districts.${r.district}`)}</p>
                {can('resources.deploy') ? (
                  <select aria-label={t('common.status')} className="input !min-h-[38px] py-1.5 text-sm" value={r.status} onChange={(e) => update(r.id, { status: e.target.value })}>
                    {(['available', 'deployed', 'unavailable'] as const).map((s) => <option key={s} value={s}>{t(`resources.st_${s}`)}</option>)}
                  </select>
                ) : <p className="text-sm font-semibold">{t(`resources.st_${r.status}`)}</p>}
                {ty === 'shelter' && r.capacity != null && (
                  <div>
                    <p className="text-sm">{t('resources.occupancy', { n: r.occupancy, cap: r.capacity })}</p>
                    <div className="h-2 rounded-pill bg-surface-2 mt-1"><div className="h-full rounded-pill bg-brand" style={{ width: `${Math.min(100, (r.occupancy / r.capacity) * 100)}%` }} /></div>
                    {can('resources.deploy') && (
                      <input type="range" min={0} max={r.capacity} step={5} defaultValue={r.occupancy} aria-label={t('resources.capacity_people', { cap: r.capacity })}
                        className="w-full mt-1 accent-[rgb(var(--brand))]" onPointerUp={(e) => update(r.id, { occupancy: Number((e.target as HTMLInputElement).value) })}
                        onKeyUp={(e) => update(r.id, { occupancy: Number((e.target as HTMLInputElement).value) })} />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      </div>
    </div>
  );
}
