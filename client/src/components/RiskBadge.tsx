import { useTranslation } from 'react-i18next';
import type { Level } from '../api/types';
import { LEVEL_ICON, levelInk, levelVar } from '../lib/risk';

type Props = { level: Level; size?: 'sm' | 'md' | 'lg'; className?: string };

/** Icon + word + colour, so the level reads without colour vision. */
export function RiskBadge({ level, size = 'md', className = '' }: Props) {
  const { t } = useTranslation();
  const Icon = LEVEL_ICON[level];
  const sizes = {
    sm: 'text-xs px-2 py-0.5 gap-1',
    md: 'text-sm px-2.5 py-1 gap-1.5',
    lg: 'text-lg px-4 py-2 gap-2 font-bold',
  }[size];
  const icon = { sm: 13, md: 15, lg: 22 }[size];
  return (
    <span
      className={`inline-flex items-center rounded-pill font-semibold whitespace-nowrap ${sizes} ${className}`}
      style={{ background: levelVar(level), color: levelInk(level) }}
    >
      <Icon size={icon} aria-hidden strokeWidth={2.4} />
      {t(`levels.${level}`)}
    </span>
  );
}
