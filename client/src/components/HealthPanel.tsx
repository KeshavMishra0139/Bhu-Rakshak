import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { UpdatedAgo } from './UpdatedAgo';
import { dateTimeIST } from '../lib/format';

type Health = {
  live_updated_at: string | null;
  feeds?: Record<'weather' | 'imd' | 'prediction' | 'seismic' | 'sensors', { status?: string; last_success?: string | null; last_update?: string | null }>;
  active_users?: number; alerts_sent_today?: number; avg_detection_to_alert_min?: number | null;
  reports?: { total: number; verified_pct: number | null };
};
const DOT: Record<string, string> = { ok: 'bg-risk-low', degraded: 'bg-risk-moderate', error: 'bg-risk-critical', not_connected: 'bg-muted', not_configured: 'bg-muted' };

/** Small, discreet System health panel (authority tools menu and admin page). */
export function HealthPanel({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => {
    const load = () => api.get<Health>('/health').then(setH).catch(() => {});
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);
  const feeds = ['weather', 'imd', 'prediction', 'seismic', 'sensors'] as const;
  const stats: [string, string][] = [
    [t('admin.active_users'), String(h?.active_users ?? '–')],
    [t('admin.alerts_today'), String(h?.alerts_sent_today ?? '–')],
    [t('admin.detect_to_alert'), h?.avg_detection_to_alert_min == null ? t('admin.none_yet') : t('admin.minutes', { count: h.avg_detection_to_alert_min })],
    [t('admin.reports_verified'), h?.reports?.verified_pct == null ? t('admin.none_yet') : `${h.reports.verified_pct}%`],
  ];
  return (
    <div className={compact ? 'space-y-3 text-sm' : 'space-y-4'}>
      <ul className="divide-y divide-line">
        {feeds.map((k) => {
          const f = h?.feeds?.[k];
          const status = f?.status || 'not_connected';
          const when = f?.last_success || f?.last_update;
          return (
            <li key={k} className="flex items-center gap-3 py-2">
              <span className={`h-2.5 w-2.5 rounded-full ${DOT[status] || 'bg-muted'}`} aria-hidden />
              <span className="flex-1"><span className="font-semibold">{t(`admin.feed_${k}`)}</span> <span className="text-muted">· {t(`admin.status_${status}`)}</span></span>
              {when && <span className="label-mono">{dateTimeIST(when, i18n.language)}</span>}
            </li>
          );
        })}
      </ul>
      <dl className={`grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-lg bg-surface-2 p-3">
            <dt className="text-muted text-sm">{k}</dt>
            <dd className={`${compact ? 'text-lg' : 'text-2xl'} font-bold tabular-nums`}>{v}</dd>
          </div>
        ))}
      </dl>
      <UpdatedAgo at={h?.live_updated_at} />
    </div>
  );
}
