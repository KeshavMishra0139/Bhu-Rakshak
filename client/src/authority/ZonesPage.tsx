// Red zones and relocation (PS SIH26191: hazard-based red zones, carrying capacity, immediate relocation needs).
// Zones come from the live risk level (same stream as the map): red at High/Critical, amber at Moderate. What is exposed
// comes from OpenStreetMap (real, but incomplete in the hills); the population figure is a seed estimate and says so.
// The relocation order is plain and explainable: level, then risk score, then buildings exposed. Carrying capacity is
// shown as an assessment framework: the inputs we have, and what an official assessment still needs (no invented limits).
import { useTranslation } from 'react-i18next';
import { Building2, School, Hospital, MapPin, Megaphone, ShieldAlert, ShieldCheck, Users, Info, Ruler } from 'lucide-react';
import type { LocationSnap } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { useRiskStream } from '../live/RiskStreamProvider';
import { RiskBadge } from '../components/RiskBadge';
import { dateTimeIST, num, placeName } from '../lib/format';
import { riskConfig } from '../lib/risk';
import { useAuthority } from './AuthorityContext';
import { useLive } from './useLive';
import { zoneOf } from './map/WatchMap';

type Exposure = {
  osm: { radius_km: number; generated_at: string } | null;
  places: Record<string, {
    osm: { buildings: number; schools: number; health: number; hospitals: number; road_km: number } | null;
    population_estimate: number | null;
    slope_deg_sample: number | null;
  }>;
};
const RANK = { critical: 3, high: 2, moderate: 1, low: 0 } as const;

export default function ZonesPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { can } = useAuth();
  const { list } = useRiskStream();
  const { openOnMap, draftAlert } = useAuthority();
  const { data } = useLive<Exposure>('/zones/exposure', []);
  const ex = (id: string) => data?.places[id];
  const buildings = (l: LocationSnap) => ex(l.id)?.osm?.buildings ?? 0;
  const order = (a: LocationSnap, b: LocationSnap) =>
    RANK[b.risk!.level] - RANK[a.risk!.level] || b.risk!.score - a.risk!.score || buildings(b) - buildings(a);

  const scored = list.filter((l) => l.risk);
  const red = scored.filter((l) => zoneOf(l.risk!.level) === 'red').sort(order);
  const amber = scored.filter((l) => zoneOf(l.risk!.level) === 'amber').sort(order);
  const sum = (ls: LocationSnap[], f: (id: string) => number) => ls.reduce((a, l) => a + f(l.id), 0);
  const redBuildings = sum(red, (id) => ex(id)?.osm?.buildings ?? 0);
  const redFacilities = sum(red, (id) => (ex(id)?.osm?.schools ?? 0) + (ex(id)?.osm?.health ?? 0));
  const km = riskConfig.zones.radiusKm;

  const Row = ({ l, rank, compact = false }: { l: LocationSnap; rank?: number; compact?: boolean }) => {
    const e = ex(l.id);
    const o = e?.osm;
    return (
      <li className={`flex flex-wrap items-start gap-x-4 gap-y-2 ${compact ? 'py-3' : 'py-4'}`}>
        {rank != null && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-risk-critical/12 font-bold tabular-nums text-risk-critical">{rank}</span>}
        <div className="min-w-[180px] flex-1">
          <p className="font-bold leading-tight">{placeName(l, lang)}</p>
          <p className="text-sm text-muted">{t(`districts.${l.district}`)} · {t('zones.since', { time: dateTimeIST(l.risk!.level_since, lang) })}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {o ? (
              <>
                <span className="inline-flex items-center gap-1.5" title={t('zones.osm_tip', { km: data?.osm?.radius_km ?? 1 })}><Building2 size={15} className="text-muted" aria-hidden /><b className="tabular-nums">{num(o.buildings, lang)}</b> {t('zones.buildings')}</span>
                <span className="inline-flex items-center gap-1.5"><School size={15} className="text-muted" aria-hidden /><b className="tabular-nums">{o.schools}</b> {t('zones.schools')}</span>
                <span className="inline-flex items-center gap-1.5"><Hospital size={15} className="text-muted" aria-hidden /><b className="tabular-nums">{o.health}</b> {t('zones.health')}</span>
              </>
            ) : <span className="text-muted">{t('zones.no_osm')}</span>}
            {e?.population_estimate != null && (
              <span className="inline-flex items-center gap-1.5 text-muted" title={t('zones.pop_tip')}><Users size={15} aria-hidden />{t('zones.people_est', { n: num(e.population_estimate, lang) })}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="flex items-center gap-2"><span className="font-mono text-sm tabular-nums text-muted">{l.risk!.score.toFixed(2)}</span><RiskBadge level={l.risk!.level} size="sm" /></span>
          <span className="flex gap-1.5">
            <button type="button" className="btn-ghost !min-h-[34px] px-2.5 py-1 text-sm" onClick={() => openOnMap(l.id)}><MapPin size={15} aria-hidden />{t('inbox.open_on_map')}</button>
            {can('alerts.dispatch') && !compact && (
              <button type="button" className="btn-secondary !min-h-[34px] px-2.5 py-1 text-sm" onClick={() => draftAlert({ locationId: l.id, severity: l.risk!.level })}><Megaphone size={15} aria-hidden />{t('inbox.draft_alert')}</button>
            )}
          </span>
        </div>
      </li>
    );
  };

  const stat = (label: string, value: string | number, note?: string, tone = '') => (
    <div className="card p-4">
      <p className="text-sm font-semibold text-muted">{label}</p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${tone}`}>{value}</p>
      {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4">
      <header>
        <p className="label-mono">{t('zones.ps')}</p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold"><ShieldAlert size={24} className="text-risk-critical" aria-hidden />{t('zones.title')}</h1>
        <p className="mt-1 max-w-3xl text-muted">{t('zones.intro')}</p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stat(t('zones.stat_red'), list.length ? red.length : '–', undefined, red.length ? 'text-risk-critical' : '')}
        {stat(t('zones.stat_amber'), list.length ? amber.length : '–')}
        {stat(t('zones.stat_buildings'), data ? num(redBuildings, lang) : '–', t('zones.stat_osm_note'))}
        {stat(t('zones.stat_facilities'), data ? redFacilities : '–', t('zones.stat_osm_note'))}
      </div>

      <section className="card p-5" aria-labelledby="relocate-title">
        <h2 id="relocate-title" className="text-lg font-bold">{t('zones.relocate_title')}</h2>
        <p className="text-sm text-muted">{t('zones.relocate_order')}</p>
        {red.length ? (
          <ol className="mt-1 divide-y divide-line">{red.map((l, i) => <Row key={l.id} l={l} rank={i + 1} />)}</ol>
        ) : (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-risk-low/10 p-3 font-semibold"><ShieldCheck size={20} className="mt-0.5 shrink-0 text-risk-low" aria-hidden />{t('zones.relocate_empty')}</p>
        )}
      </section>

      <section className="card p-5" aria-labelledby="watch-title">
        <h2 id="watch-title" className="text-lg font-bold">{t('zones.watch_title')}</h2>
        <p className="text-sm text-muted">{t('zones.watch_intro')}</p>
        {amber.length ? <ul className="mt-1 divide-y divide-line">{amber.map((l) => <Row key={l.id} l={l} compact />)}</ul>
          : <p className="mt-3 text-muted">{t('zones.watch_empty')}</p>}
      </section>

      <section className="card p-5" aria-labelledby="cc-title">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="cc-title" className="flex-1 text-lg font-bold">{t('zones.cc_title')}</h2>
          <span className="rounded-pill bg-risk-moderate/15 px-3 py-1 text-xs font-bold text-[rgb(var(--risk-moderate-ink))] dark:text-risk-moderate">{t('zones.cc_status')}</span>
        </div>
        <p className="mt-1 text-[0.95rem]">{t('zones.cc_body')}</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg bg-surface-2 p-4">
            <h3 className="text-sm font-bold">{t('zones.cc_have')}</h3>
            <ul className="mt-2 space-y-2 text-sm">
              <li className="flex gap-2"><Building2 size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />{t('zones.cc_have_osm')}</li>
              <li className="flex gap-2"><Ruler size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />{t('zones.cc_have_slope')}</li>
              <li className="flex gap-2"><Users size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />{t('zones.cc_have_pop')}</li>
            </ul>
          </div>
          <div className="rounded-lg border border-dashed border-line p-4">
            <h3 className="text-sm font-bold">{t('zones.cc_need')}</h3>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
              <li>{t('zones.cc_need_1')}</li>
              <li>{t('zones.cc_need_2')}</li>
              <li>{t('zones.cc_need_3')}</li>
            </ul>
          </div>
        </div>
      </section>

      <p className="flex items-start gap-2 text-sm text-muted"><Info size={16} className="mt-0.5 shrink-0" aria-hidden />{t('zones.method', { km })}</p>
    </div>
  );
}
