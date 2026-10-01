// Road corridor checker helpers. The server cuts the route into ~2 km segments and ties each to the nearest
// monitored place within 8 km; here each segment takes that place's live risk level, so colours follow the stream.
import type { Level, LocationSnap } from '../api/types';
import { api } from '../api/client';
import { LEVEL_RANK } from './risk';

export type LatLng = [number, number];
export type Segment = { coords: LatLng[]; km: number; place_id: string | null; place_km: number | null };
export type CorridorRoute = {
  kind: 'main' | 'osrm_alternative' | 'diversion' | 'detour';
  via: string | null;
  distance_m: number;
  duration_s: number;
  segments: Segment[];
};
export type CorridorSource = { routing: string; segment_km: number; monitor_km: number };
export type SegLevel = Level | 'none';

export const fetchRoute = (from: LatLng, to: LatLng) =>
  api.get<{ routes: CorridorRoute[]; source: CorridorSource }>(`/corridor/route?from=${from.join(',')}&to=${to.join(',')}`);
export const fetchAlternative = (from: LatLng, to: LatLng) =>
  api.get<{ main_high: number; alternative: CorridorRoute | null; tried: number; source: CorridorSource }>(`/corridor/alternative?from=${from.join(',')}&to=${to.join(',')}`);

export const segLevel = (s: Segment, locations: Record<string, LocationSnap>): SegLevel =>
  (s.place_id && locations[s.place_id]?.risk?.level) || 'none';
export const isHigh = (l: SegLevel) => l === 'high' || l === 'critical';

export function summarise(route: CorridorRoute, locations: Record<string, LocationSnap>) {
  const by: Record<SegLevel, number> = { none: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  let start = 0;
  const rows = route.segments.map((s, i) => {
    const level = segLevel(s, locations);
    by[level]++;
    const row = { i, level, fromKm: start, toKm: start + s.km, seg: s };
    start += s.km;
    return row;
  });
  const worst = rows.reduce<SegLevel>((m, r) => (r.level !== 'none' && (m === 'none' || LEVEL_RANK[r.level] > LEVEL_RANK[m]) ? r.level : m), 'none');
  return { rows, by, total: rows.length, high: by.high + by.critical, worst };
}

export const SEG_COLOR_NONE = '#8a948d';

/** A few points spread along the route, so Google Maps follows the same roads. */
export function viaPoints(route: CorridorRoute, n = 3): LatLng[] {
  const pts = route.segments.flatMap((s) => s.coords);
  if (pts.length < 3) return [];
  return Array.from({ length: n }, (_, k) => pts[Math.round(((k + 1) * (pts.length - 1)) / (n + 1))]);
}

