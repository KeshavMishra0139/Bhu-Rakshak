// "What's driving the risk": a place's risk drivers grouped into four families — rain, wet ground, slope & terrain,
// earthquakes — so the interface shows a multi-hazard picture rather than a rainfall reading.
import { useTranslation } from 'react-i18next';
import { Activity, CloudRain, Droplets, Mountain, Waves, History, type LucideIcon } from 'lucide-react';
import type { Driver } from '../api/types';

export type MixGroup = 'rain' | 'ground' | 'terrain' | 'quake';
export const GROUPS: { id: MixGroup; icon: LucideIcon; color: string }[] = [
  { id: 'rain', icon: CloudRain, color: '#4b9fd5' },
  { id: 'ground', icon: Droplets, color: '#b9844f' },
  { id: 'terrain', icon: Mountain, color: '#8fa35a' },
  { id: 'quake', icon: Activity, color: '#9267d6' },
];
const GROUP_OF: Record<string, MixGroup> = {
  rain_72h: 'rain', rain_24h: 'rain', rain_intensity: 'rain', rain_forecast: 'rain', imd_warning: 'rain',
  soil_saturation: 'ground', freeze_thaw: 'ground',
  slope: 'terrain', history: 'terrain', lithology: 'terrain', road_cutting: 'terrain', river_proximity: 'terrain', fault: 'terrain', low_vegetation: 'terrain',
  seismic: 'quake',
};
export const groupOf = (key: string) => GROUPS.find((g) => g.id === GROUP_OF[key]);

/** Share of the risk (0–100) from each family, from the top drivers. */
export function mixOf(drivers: Driver[] | undefined) {
  const out: Record<MixGroup, number> = { rain: 0, ground: 0, terrain: 0, quake: 0 };
  for (const d of drivers || []) { const g = GROUP_OF[d.key]; if (g) out[g] += d.contribution; }
  const total = Object.values(out).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Math.round((v / total) * 100)])) as Record<MixGroup, number>;
}

/** Thin segmented bar. `labelled` adds a legend with percentages underneath. */
export function RiskMix({ drivers, labelled = false, onDark = false }: { drivers: Driver[] | undefined; labelled?: boolean; onDark?: boolean }) {
  const { t } = useTranslation();
  const mix = mixOf(drivers);
  const parts = GROUPS.filter((g) => mix[g.id] > 0);
  if (!parts.length) return null;
  const summary = parts.map((g) => `${t(`mix.${g.id}`)} ${mix[g.id]}%`).join(', ');
  return (
    <div className={labelled ? 'space-y-2' : ''}>
      <div role="img" aria-label={`${t('mix.title')}: ${summary}`} title={summary}
        className={`flex overflow-hidden rounded-full ${labelled ? 'h-2.5' : 'h-1'} ${onDark ? 'bg-white/10' : 'bg-surface-2'}`}>
        {parts.map((g) => <span key={g.id} className="h-full transition-[width] duration-700 ease-out" style={{ width: `${mix[g.id]}%`, background: g.color }} />)}
      </div>
      {labelled && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {GROUPS.map((g) => (
            <li key={g.id} className={`inline-flex items-center gap-1.5 ${mix[g.id] ? '' : 'text-muted'}`}>
              <g.icon size={14} style={{ color: g.color }} aria-hidden />
              {t(`mix.${g.id}`)} <span className="font-mono tabular-nums">{mix[g.id]}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Small row of the hazards the system watches (citizen home, landing page). */
const WATCH: { id: string; icon: LucideIcon; color: string }[] = [
  { id: 'rain', icon: CloudRain, color: '#4b9fd5' },
  { id: 'ground', icon: Droplets, color: '#b9844f' },
  { id: 'terrain', icon: Mountain, color: '#8fa35a' },
  { id: 'quake', icon: Activity, color: '#9267d6' },
  { id: 'rivers', icon: Waves, color: '#3aa6b9' },
  { id: 'history', icon: History, color: '#d98b3a' },
];
export function WatchStrip({ onDark = false, compact = false }: { onDark?: boolean; compact?: boolean }) {
  const { t } = useTranslation();
  const items = compact ? WATCH.slice(0, 4) : WATCH;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`text-xs font-semibold uppercase tracking-wide ${onDark ? 'text-on-brand/70' : 'text-muted'}`}>{t('mix.watching')}</span>
      <ul className="stagger flex flex-wrap gap-1.5">
        {items.map((w) => (
          <li key={w.id} className={`inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-xs font-semibold ${onDark ? 'bg-white/10 text-white' : 'border border-line bg-surface'}`}>
            <w.icon size={13} style={{ color: w.color }} aria-hidden />{t(`mix.w_${w.id}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}
