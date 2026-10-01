// Plain-language summary of a place's risk for the "Why" card: the level, when the risk is highest (from the
// engine's +6/12/24/48 h forecast), how sure the system is, and the top three reasons. Everything here is derived
// from the live risk record; nothing is invented.
import type { Driver, Level, Risk } from '../api/types';
import { LEVEL_RANK } from './risk';

export type RiskWindow =
  /** Nothing above "low" now or in the next 48 h. */
  | { kind: 'calm'; level: Level; to: number }
  /** The peak level starts now and lasts until `to` hours (`open` = still there at the end of the forecast). */
  | { kind: 'now'; level: Level; to: number; open: boolean }
  /** The peak level starts in `from` hours and lasts until `to`. */
  | { kind: 'later'; level: Level; from: number; to: number; open: boolean };

/** When the risk is highest over now + the forecast horizons. */
export function riskWindow(r: Pick<Risk, 'level' | 'forecast'>): RiskWindow {
  const pts = [{ h: 0, level: r.level }, ...(r.forecast || []).map((f) => ({ h: f.h, level: f.level }))].sort((a, b) => a.h - b.h);
  const last = pts[pts.length - 1].h;
  const peak = pts.reduce<Level>((m, p) => (LEVEL_RANK[p.level] > LEVEL_RANK[m] ? p.level : m), 'low');
  if (peak === 'low') return { kind: 'calm', level: 'low', to: last || 48 };
  const first = pts.findIndex((p) => p.level === peak);
  let end = first;
  while (end + 1 < pts.length && pts[end + 1].level === peak) end++;
  const open = end === pts.length - 1;
  if (pts[first].h === 0) return { kind: 'now', level: peak, to: pts[end].h, open };
  return { kind: 'later', level: peak, from: pts[first].h, to: pts[end].h, open };
}

export type ConfidenceBand = 'low' | 'medium' | 'high';
export const confidenceBand = (c: number): ConfidenceBand => (c >= 0.75 ? 'high' : c >= 0.5 ? 'medium' : 'low');

/** Top reasons, largest share first. */
export const topReasons = (drivers: Driver[] | undefined, n = 3) => [...(drivers || [])].sort((a, b) => b.contribution - a.contribution).slice(0, n);

/** IST clock time `hours` after `fromIso` (to show the window as real times). */
export const hoursFrom = (fromIso: string, hours: number) => new Date(new Date(fromIso).getTime() + hours * 3600000).toISOString();
