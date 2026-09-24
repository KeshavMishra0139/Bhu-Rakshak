import { AlertCircle, AlertTriangle, OctagonAlert, ShieldCheck, TrendingDown, TrendingUp, MoveRight, type LucideIcon } from 'lucide-react';
import riskConfig from '@shared/config/risk.json';
import type { Level, Trend } from '../api/types';

export { riskConfig };
export const LEVELS: Level[] = ['low', 'moderate', 'high', 'critical'];
export const LEVEL_RANK: Record<Level, number> = { low: 0, moderate: 1, high: 2, critical: 3 };

/** Colour is never the only signal: every level also has its own icon shape and a word. */
export const LEVEL_ICON: Record<Level, LucideIcon> = {
  low: ShieldCheck,
  moderate: AlertCircle,
  high: AlertTriangle,
  critical: OctagonAlert,
};

export const TREND_ICON: Record<Trend, LucideIcon> = { rising: TrendingUp, steady: MoveRight, falling: TrendingDown };

export const levelVar = (l: Level) => `rgb(var(--risk-${l}))`;
export const levelInk = (l: Level) => (l === 'moderate' ? 'rgb(var(--risk-moderate-ink))' : '#fff');
