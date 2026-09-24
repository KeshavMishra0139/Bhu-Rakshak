import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, BadgeCheck, AlertOctagon } from 'lucide-react';
import type { AlertItem, Level, LocationSnap } from '../../api/types';
import { RiskBadge } from '../../components/RiskBadge';
import { placeName } from '../../lib/format';
import { LEVELS, LEVEL_RANK, TREND_ICON, levelVar } from '../../lib/risk';
import { levelAt } from './MapView';

type Sort = 'priority' | 'score' | 'name';
const DISTRICTS = ['East Sikkim', 'West Sikkim', 'North Sikkim', 'South Sikkim', 'Kalimpong', 'Darjeeling'];

export function LocationPanel({ locations, alerts, horizon, selectedId, onSelect, changedAt }: {
  locations: LocationSnap[]; alerts: AlertItem[]; horizon: number; selectedId: string | null; onSelect: (id: string) => void; changedAt: Record<string, number>;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [q, setQ] = useState('');
  const [district, setDistrict] = useState('');
  const [level, setLevel] = useState<Level | ''>('');
  const [road, setRoad] = useState('');
  const [sort, setSort] = useState<Sort>('priority');

  const roads = useMemo(() => [...new Set(locations.flatMap((l) => (l.road ? l.road.split(' / ') : [])))].sort(), [locations]);
  const counts = useMemo(() => {
    const c: Record<Level, number> = { low: 0, moderate: 0, high: 0, critical: 0 };
    locations.forEach((l) => { const lv = levelAt(l, horizon); if (lv) c[lv]++; });
    return c;
  }, [locations, horizon]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const arr = locations.filter((l) => (!s || l.name_en.toLowerCase().includes(s) || l.name_hi.includes(s) || l.district.toLowerCase().includes(s))
      && (!district || l.district === district) && (!level || levelAt(l, horizon) === level) && (!road || (l.road || '').includes(road)));
    return arr.sort((a, b) => sort === 'name' ? placeName(a, lang).localeCompare(placeName(b, lang))
      : sort === 'score' ? (b.risk?.score ?? 0) - (a.risk?.score ?? 0) : (b.risk?.priority ?? 0) - (a.risk?.priority ?? 0));
  }, [locations, q, district, level, road, sort, horizon, lang]);

  const noAlert = (l: LocationSnap) => l.risk?.level === 'critical' && !alerts.some((a) => !a.cancelled_at && a.kind === 'warning' && a.created_at >= l.risk!.level_since &&
    ((a.target_type === 'location' && a.target_id === l.id) || (a.target_type === 'corridor' && a.target_id === l.corridor_id) || (a.target_type === 'district' && a.target_id === l.district)));

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* Summary strip doubles as a quick level filter */}
      <div className="grid grid-cols-5 gap-1 p-3 border-b border-line" role="group" aria-label={t('common.level')}>
        <button type="button" onClick={() => setLevel('')} aria-pressed={!level} className={`rounded-lg py-1.5 text-center ${!level ? 'bg-surface-2' : ''}`}>
          <span className="block text-lg font-bold tabular-nums">{locations.length}</span><span className="block text-[0.7rem] text-muted">{t('map.total')}</span>
        </button>
        {[...LEVELS].reverse().map((lv) => (
          <button key={lv} type="button" onClick={() => setLevel(level === lv ? '' : lv)} aria-pressed={level === lv}
            className={`rounded-lg py-1.5 text-center border-b-4 ${level === lv ? 'bg-surface-2' : ''}`} style={{ borderBottomColor: levelVar(lv) }}>
            <span className="block text-lg font-bold tabular-nums">{counts[lv]}</span><span className="block text-[0.7rem] text-muted">{t(`levels.${lv}`)}</span>
          </button>
        ))}
      </div>
      <div className="p-3 space-y-2 border-b border-line">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <label htmlFor="loc-search" className="sr-only">{t('map.search')}</label>
          <input id="loc-search" className="input pl-9 !min-h-[40px] py-2" placeholder={t('map.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <select aria-label={t('common.district')} className="input !min-h-[36px] py-1.5 text-sm" value={district} onChange={(e) => setDistrict(e.target.value)}>
            <option value="">{t('common.all_districts')}</option>
            {DISTRICTS.map((d) => <option key={d} value={d}>{t(`districts.${d}`)}</option>)}
          </select>
          <select aria-label={t('common.road')} className="input !min-h-[36px] py-1.5 text-sm" value={road} onChange={(e) => setRoad(e.target.value)}>
            <option value="">{t('common.all_roads')}</option>
            {roads.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select aria-label={t('common.sort')} className="input !min-h-[36px] py-1.5 text-sm" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="priority">{t('common.priority')}</option>
            <option value="score">{t('drawer.score')}</option>
            <option value="name">A–Z</option>
          </select>
        </div>
      </div>
      <ul className="flex-1 overflow-y-auto" aria-label={t('nav.live_board')}>
        {shown.length === 0 && <li className="p-4 text-muted text-sm">{t('map.no_match')}</li>}
        {shown.map((l) => {
          const lv = levelAt(l, horizon);
          const Trend = l.risk ? TREND_ICON[l.risk.trend] : null;
          const sel = l.id === selectedId;
          return (
            <li key={`${l.id}:${changedAt[l.id] || 0}`} className={changedAt[l.id] ? 'value-flash' : ''}>
              <button type="button" onClick={() => onSelect(l.id)} aria-current={sel ? 'true' : undefined}
                className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-l-4 ${sel ? 'bg-surface-2' : 'hover:bg-surface-2/60'}`}
                style={{ borderLeftColor: lv ? levelVar(lv) : 'transparent' }}>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5 font-semibold truncate">
                    {placeName(l, lang)}
                    {l.field_verified_at && <BadgeCheck size={15} className="text-brand shrink-0" aria-label={t('map.field_verified')} />}
                  </span>
                  <span className="block text-xs text-muted truncate">{t(`districts.${l.district}`)}{l.road ? ` · ${l.road}` : ''}</span>
                  {horizon === 0 && noAlert(l) && (
                    <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-bold text-risk-critical"><AlertOctagon size={13} aria-hidden />{t('map.critical_no_alert')}</span>
                  )}
                </span>
                <span className="text-right">
                  {lv && <RiskBadge level={lv} size="sm" />}
                  <span className="mt-1 flex items-center justify-end gap-1 font-mono text-xs text-muted tabular-nums">
                    {Trend && <Trend size={13} aria-label={t(`trend.${l.risk!.trend}`)} />}
                    {horizon ? (l.risk?.forecast.find((f) => f.h === horizon)?.score ?? l.risk?.score ?? 0).toFixed(2) : (l.risk?.score ?? 0).toFixed(2)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export const worstLevel = (ls: LocationSnap[]) => ls.reduce<Level>((w, l) => (l.risk && LEVEL_RANK[l.risk.level] > LEVEL_RANK[w] ? l.risk.level : w), 'low');
