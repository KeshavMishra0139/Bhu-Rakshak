// Impact data for the "Why" card (OpenStreetMap counts + monitored road segments) and the recommended actions,
// which are simple rules on the risk level, its time window, road status and the main reason. The rules only
// repeat standard landslide safety advice; they never promise that a place is safe.
import type { Level, Risk } from '../api/types';
import type { RiskWindow } from './why';
import { api } from '../api/client';
import { isDeva } from './format';

export type RoadStatus = 'open' | 'caution' | 'restricted' | 'blocked' | 'cleared';
export type Impact = {
  location_id: string;
  radius_km: number | null;
  osm: {
    buildings: number; schools: number; school_names: string[]; health: number; hospitals: number; health_names: string[];
    road_km: number; roads: { name: string | null; ref: string | null; class: string; km: number }[];
  } | null;
  segments: { id: string; name_en: string; name_hi: string; status: RoadStatus; diversion_en: string | null; diversion_hi: string | null; eta_clear_hours: number | null }[];
  source: { name: string; generated_at: string; extracts: { file: string; downloaded: string }[] } | null;
};

const cache = new Map<string, Promise<Impact>>();
/** Fetched once per place per page load (the counts change only when the OSM file is rebuilt). */
export function loadImpact(id: string) {
  let p = cache.get(id);
  if (!p) { p = api.get<Impact>(`/impact/${id}`); p.catch(() => cache.delete(id)); cache.set(id, p); }
  return p;
}

const STATUS_RANK: Record<RoadStatus, number> = { blocked: 4, restricted: 3, caution: 2, open: 1, cleared: 0 };

/** The road to name in the advice: the worst monitored segment through the place, else the main mapped road. */
export function keyRoad(imp: Impact | null, lang: string) {
  const seg = [...(imp?.segments || [])].sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status])[0];
  if (seg) return { name: isDeva(lang) ? seg.name_hi : seg.name_en, status: seg.status, diversion: isDeva(lang) ? seg.diversion_hi : seg.diversion_en };
  const r = imp?.osm?.roads?.[0];
  if (r) return { name: r.ref || r.name || '', status: null, diversion: null };
  return null;
}

export type Action = { key: string; vars?: Record<string, string | number>; urgent?: boolean };

/** Recommended actions, most important first (translation keys under `impact.`). */
export function actionsFor(r: Pick<Risk, 'level' | 'drivers'>, w: RiskWindow, imp: Impact | null, lang: string, place: string): Action[] {
  const road = keyRoad(imp, lang);
  const out: Action[] = [];
  const level: Level = w.kind === 'calm' ? r.level : (w.level as Level);
  const roadName = road?.name || place;

  if (road?.status === 'blocked') out.push({ key: road.diversion ? 'act_blocked_div' : 'act_blocked', vars: { road: roadName, diversion: road.diversion || '' }, urgent: true });
  else if (road?.status === 'restricted') out.push({ key: 'act_restricted', vars: { road: roadName } });

  if (level === 'critical') {
    out.push({ key: 'act_critical_move', urgent: true });
    if (road && road.status !== 'blocked') out.push({ key: 'act_avoid_road', vars: { road: roadName }, urgent: true });
    out.push({ key: 'act_call_112' });
  } else if (level === 'high') {
    if (road && road.status !== 'blocked') out.push({ key: w.kind === 'later' ? 'act_avoid_road_later' : 'act_avoid_road', vars: { road: roadName, from: w.kind === 'later' ? w.from : 0 }, urgent: true });
    out.push({ key: 'act_bag' });
    out.push({ key: 'act_signs_leave' });
  } else if (level === 'moderate') {
    out.push({ key: road ? 'act_travel_check' : 'act_travel_check_noroad', vars: { road: roadName } });
    out.push({ key: 'act_watch_signs' });
  } else {
    out.push({ key: 'act_none' });
  }
  // After shaking, slopes can fail days later, even without rain.
  if (level !== 'low' && r.drivers?.[0]?.key === 'seismic') out.push({ key: 'act_after_quake' });
  return out.slice(0, 3);
}
