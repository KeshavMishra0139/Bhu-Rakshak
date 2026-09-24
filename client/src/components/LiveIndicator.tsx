import { useTranslation } from 'react-i18next';
import { useRiskStream } from '../live/RiskStreamProvider';

export function LiveIndicator({ onDark = false }: { onDark?: boolean }) {
  const { t } = useTranslation();
  const { status } = useRiskStream();
  const live = status === 'live';
  const dot = live ? 'bg-risk-low live-dot' : status === 'offline' ? 'bg-risk-critical' : 'bg-risk-moderate';
  const label = live ? t('live.live') : t(`live.${status}`);
  return (
    <span className={`inline-flex items-center gap-2 text-sm font-semibold ${onDark ? 'text-on-brand' : 'text-ink'}`} role="status" aria-live="polite">
      <span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden />
      {label}
    </span>
  );
}
