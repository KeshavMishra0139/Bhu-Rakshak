import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertTriangle, Ban } from 'lucide-react';
import type { Road } from '../api/types';

/** Citizens see three plain states: Open / Caution / Avoid (icon + colour + word). */
export const citizenRoadState = (s: Road['status']) => (s === 'open' || s === 'cleared' ? 'open' : s === 'caution' ? 'caution' : 'avoid');

export function RoadBadge({ status }: { status: Road['status'] }) {
  const { t } = useTranslation();
  const c = citizenRoadState(status);
  const map = {
    open: { Icon: CheckCircle2, bg: 'rgb(var(--risk-low))', fg: '#fff' },
    caution: { Icon: AlertTriangle, bg: 'rgb(var(--risk-moderate))', fg: 'rgb(var(--risk-moderate-ink))' },
    avoid: { Icon: Ban, bg: 'rgb(var(--risk-critical))', fg: '#fff' },
  }[c];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-sm font-bold whitespace-nowrap" style={{ background: map.bg, color: map.fg }}>
      <map.Icon size={15} aria-hidden />{t(`roads.c_${c}`)}
    </span>
  );
}
