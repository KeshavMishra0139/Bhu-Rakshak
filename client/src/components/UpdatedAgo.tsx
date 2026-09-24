import { useTranslation } from 'react-i18next';
import { secondsSince } from '../lib/format';
import { useNow } from '../lib/useNow';

export function useUpdatedLabel(iso: string | null | undefined) {
  const { t } = useTranslation();
  const now = useNow(5000);
  const s = secondsSince(iso, now);
  if (s == null) return '';
  if (s < 5) return t('live.updated_just_now');
  if (s < 60) return t('live.updated_seconds', { count: s });
  if (s < 3600) return t('live.updated_minutes', { count: Math.floor(s / 60) });
  return t('live.updated_hours', { count: Math.floor(s / 3600) });
}

export function UpdatedAgo({ at, className = '' }: { at: string | null | undefined; className?: string }) {
  const label = useUpdatedLabel(at);
  return <span className={`label-mono ${className}`}>{label}</span>;
}
