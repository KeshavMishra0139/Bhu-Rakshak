import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Megaphone, ClipboardPlus, BadgeCheck, Users } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer, YAxis, XAxis, Tooltip as RTooltip, ReferenceLine } from 'recharts';
import { api, errorKey } from '../../api/client';
import type { ImdSummary, Incident, LocationSnap, Resource, Road, Sop } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { useRiskStream, useStreamEvent } from '../../live/RiskStreamProvider';
import { RiskBadge } from '../../components/RiskBadge';
import { UpdatedAgo } from '../../components/UpdatedAgo';
import { ImdPanel } from '../../components/ImdPanel';
import { dateTimeIST, num, pct, placeName, timeIST } from '../../lib/format';
import { driverLabel, factorLabel, factorMeta, notConnectedFactors } from '../../lib/factors';
import { TREND_ICON, levelVar, riskConfig } from '../../lib/risk';
import { IncidentDetail } from '../IncidentDetail';
import { useAuthority } from '../AuthorityContext';

type Detail = {
  location: LocationSnap & { field_verified_at: string | null };
  roads: Road[];
  history?: { score: number; level: string; at: string }[];
  static?: Record<string, number | string | null>;
  exposure?: { population: number; roads: string[]; bridges: string[]; facilities: { type: string; name: string }[]; critical_infra: string[]; tourist_zone: boolean; exposure_score: number; source: string };
  incidents?: Incident[];
  resources?: Resource[];
};
type Tab = 'overview' | 'conditions' | 'terrain' | 'exposure' | 'response';
const TABS: Tab[] = ['overview', 'conditions', 'terrain', 'exposure', 'response'];

function SourceTag({ k }: { k: string }) {
  const { t } = useTranslation();
  const src = factorMeta(k)?.source || 'generated';
  const cls = src === 'real_feed' ? 'text-risk-low' : src === 'not_connected' ? 'text-muted' : 'text-brand';
  return <span className={`text-[0.7rem] font-mono ${cls}`}>{t(`drawer.src_${src}`)}</span>;
}

function FactorRow({ k, value }: { k: string; value: unknown }) {
  const { i18n } = useTranslation();
  const m = factorMeta(k);
  const v = value == null || value === '' ? '–' : typeof value === 'number' ? (Number.isInteger(value) ? String(value) : value.toFixed(value < 1 ? 3 : 1)) : String(value);
  return (
    <div className="flex items-baseline gap-2 py-1.5 border-b border-line/60 last:border-0">
      <dt className="flex-1 text-sm">{factorLabel(k, i18n.language)} <SourceTag k={k} /></dt>
      <dd className="font-mono tabular-nums text-sm">{v}{m && m.unit !== 'flag' && m.unit !== 'class' && m.unit !== 'list' && m.unit !== 'date' && v !== '–' ? ` ${m.unit}` : ''}</dd>
    </div>
  );
}

export function DetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { can } = useAuth();
  const { locations } = useRiskStream();
  const { draftAlert } = useAuthority();
  const [tab, setTab] = useState<Tab>('overview');
  const [d, setD] = useState<Detail | null>(null);
  const [sops, setSops] = useState<Sop[]>([]);
  const [acks, setAcks] = useState(0);
  const [openInc, setOpenInc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const live = locations[id];
  const r = live?.risk;

  const load = useCallback(() => api.get<Detail>(`/locations/${id}`).then(setD).catch((e) => setErr(errorKey(e))), [id]);
  useEffect(() => { setD(null); setOpenInc(null); load(); }, [load]);
  useEffect(() => { api.get<{ sops: Sop[] }>('/sops').then((x) => setSops(x.sops)).catch(() => {}); }, []);
  useEffect(() => {
    api.get<{ acks: { location_id: string; count: number }[] }>('/risk-acks').then((x) => setAcks(x.acks.filter((a) => a.location_id === id).reduce((s, a) => s + a.count, 0))).catch(() => {});
  }, [id, r?.level]);
  useStreamEvent('incident_updated', (e) => { if (!e.location_id || e.location_id === id) load(); });
  useStreamEvent('citizen_ack', (e) => { if (e.location_id === id) setAcks((n) => n + 1); });

  async function createIncident() {
    try {
      const x = await api.post<{ incident: Incident }>('/incidents', { location_id: id, level: r?.level || 'moderate', title: `${lang === 'hi' ? live.name_hi : live.name_en}: ${t(`levels.${r?.level || 'moderate'}`)}` });
      setTab('response');
      setOpenInc(x.incident.id);
      load();
    } catch (e) { setErr(errorKey(e)); }
  }

  if (!live) return null;
  const Trend = r ? TREND_ICON[r.trend] : null;
  const c = (r?.conditions || {}) as Record<string, unknown>;
  const levelSops = sops.filter((s) => s.level === r?.level);
  const hist = (d?.history || []).map((h) => ({ t: timeIST(h.at, lang), score: h.score }));

  return (
    <aside className="flex flex-col h-full min-h-0" aria-labelledby="drawer-title">
      <div className="p-4 border-b border-line">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 id="drawer-title" className="text-xl font-bold leading-tight flex items-center gap-1.5">
              {placeName(live, lang)}
              {live.field_verified_at && <BadgeCheck size={18} className="text-brand" aria-label={t('map.field_verified')} />}
            </h2>
            <p className="text-sm text-muted">{t(`districts.${live.district}`)}{live.road ? ` · ${live.road}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 -m-1 text-muted hover:text-ink" aria-label={t('drawer.close')}><X size={20} aria-hidden /></button>
        </div>
        {r && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <RiskBadge level={r.level} />
            <span className="font-mono text-lg tabular-nums">{r.score.toFixed(2)}</span>
            {Trend && <span className="inline-flex items-center gap-1 text-sm"><Trend size={16} aria-hidden />{t(`trend.${r.trend}`)}</span>}
            <span className="text-sm text-muted">{t('drawer.confidence')} {pct(r.confidence)}</span>
          </div>
        )}
      </div>
      <div role="tablist" aria-label={t('common.details')} className="flex overflow-x-auto border-b border-line px-2">
        {TABS.map((k) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`px-3 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 ${tab === k ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
            {t(`drawer.${k}`)}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-5" role="tabpanel">
        {err && <p className="field-error" role="alert">{t(err)}</p>}

        {tab === 'overview' && r && (
          <>
            <div className="flex flex-wrap gap-2">
              {can('incidents.manage') && <button type="button" className="btn-secondary !min-h-[40px] py-1.5 text-sm" onClick={createIncident}><ClipboardPlus size={16} aria-hidden />{t('drawer.create_incident')}</button>}
              {can('alerts.dispatch') && <button type="button" className="btn-primary !min-h-[40px] py-1.5 text-sm" onClick={() => draftAlert({ locationId: id, severity: r.level === 'low' ? 'moderate' : r.level })}><Megaphone size={16} aria-hidden />{t('drawer.draft_alert')}</button>}
            </div>
            <p className="text-sm">{t('drawer.level_since', { time: dateTimeIST(r.level_since, lang) })} · <UpdatedAgo at={r.updated_at} /></p>
            <p className="text-sm font-semibold">{r.time_to_threshold ? t('drawer.next_threshold', { level: t(`levels.${r.time_to_threshold.level}`), hours: r.time_to_threshold.hours }) : t('drawer.no_threshold')}</p>
            <ImdPanel imd={c.imd as ImdSummary | null} />
            <section>
              <h3 className="font-bold mb-2">{t('drawer.drivers')}</h3>
              <ul className="space-y-2">
                {r.drivers.map((dr) => (
                  <li key={dr.key}>
                    <div className="flex justify-between text-sm"><span>{driverLabel(dr.key, lang)}</span><span className="font-mono">{dr.contribution}%</span></div>
                    <div className="h-2 rounded-pill bg-surface-2 mt-1"><div className="h-full rounded-pill bg-brand transition-all duration-700" style={{ width: `${dr.contribution}%` }} /></div>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="font-bold mb-2">{t('drawer.forecast')}</h3>
              <div className="grid grid-cols-4 gap-2">
                {r.forecast.map((f) => (
                  <div key={f.h} className="rounded-lg border border-line p-2 text-center" style={{ borderTop: `4px solid ${levelVar(f.level)}` }}>
                    <div className="label-mono">+{f.h}h</div>
                    <div className="font-mono font-bold tabular-nums">{f.score.toFixed(2)}</div>
                    <div className="text-xs">{t(`levels.${f.level}`)}</div>
                  </div>
                ))}
              </div>
            </section>
            {hist.length > 1 && (
              <section>
                <h3 className="font-bold mb-2">{t('drawer.history_24h')}</h3>
                <div className="h-28" role="img" aria-label={t('drawer.history_24h')}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={hist} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                      <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: 'rgb(var(--muted))' }} ticks={[0, 0.5, 1]} />
                      <XAxis dataKey="t" hide />
                      <RTooltip contentStyle={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', fontSize: 12 }} />
                      {(['moderate', 'high', 'critical'] as const).map((lv) => <ReferenceLine key={lv} y={riskConfig.thresholds[lv]} stroke={levelVar(lv)} strokeDasharray="3 3" />)}
                      <Area type="monotone" dataKey="score" stroke="rgb(var(--brand))" fill="rgb(var(--brand) / 0.2)" isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}
            {(r.level === 'high' || r.level === 'critical') && (
              <p className="text-sm inline-flex items-center gap-2"><Users size={16} aria-hidden />{t('drawer.citizens_ack', { count: acks })}</p>
            )}
          </>
        )}

        {tab === 'conditions' && (
          <>
            <p className="label-mono">{t('drawer.data_fetched', { time: dateTimeIST(String(c.data_fetched_at || ''), lang) })}</p>
            {([
              ['rain', ['rain_intensity', 'rain_3h', 'rain_24h', 'rain_72h', 'rain_7d', 'rain_fc_24h', 'rain_fc_48h', 'imd_rain_severity', 'cloudburst']],
              ['soil', ['sm_0_1', 'sm_1_3', 'sm_3_9', 'sm_9_27', 'sm_27_81', 'saturation_index']],
              ['temp_snow', ['temperature', 'soil_temperature', 'freezing_level', 'snowfall_24h', 'snow_depth', 'freeze_thaw_cycles', 'humidity', 'cloud_cover', 'weather_code']],
            ] as const).map(([g, keys]) => (
              <section key={g}>
                <h3 className="font-bold">{t(`drawer.${g}`)}</h3>
                <dl className="mt-1">{keys.map((k) => <FactorRow key={k} k={k} value={c[k]} />)}</dl>
              </section>
            ))}
            <section>
              <dl>{notConnectedFactors().map((f) => <FactorRow key={f.key} k={f.key} value={null} />)}</dl>
            </section>
          </>
        )}

        {tab === 'terrain' && (d?.static ? (
          <dl>
            {['slope_deg', 'aspect_deg', 'elevation_m', 'curvature', 'lithology_class', 'fault_distance_km', 'ndvi', 'land_cover', 'dist_road_m', 'dist_river_m', 'road_cutting', 'landslide_history_count', 'last_event_date']
              .map((k) => <FactorRow key={k} k={k} value={k === 'road_cutting' ? (d.static![k] ? t('common.yes') : t('common.no')) : k === 'lithology_class' || k === 'land_cover' ? String(d.static![k] || '').replace(/_/g, ' ') : d.static![k]} />)}
            {d.static.river && <FactorRow k="dist_river_m" value={`${d.static.dist_river_m} m · ${d.static.river}`} />}
          </dl>
        ) : <div className="h-40 rounded bg-surface-2 animate-pulse" />)}

        {tab === 'exposure' && (d?.exposure ? (
          <dl className="space-y-3">
            <div><dt className="text-sm text-muted">{t('drawer.people')}</dt><dd className="text-2xl font-bold tabular-nums">~{num(d.exposure.population, lang)}</dd></div>
            <div><dt className="text-sm text-muted">{t('drawer.exposure_score')}</dt><dd className="font-mono">{d.exposure.exposure_score.toFixed(2)}</dd></div>
            {([['roads', d.exposure.roads], ['bridges', d.exposure.bridges], ['facilities', d.exposure.facilities.map((f) => f.name)], ['infra', d.exposure.critical_infra]] as const).map(([k, arr]) => (
              <div key={k}>
                <dt className="text-sm text-muted">{t(`drawer.${k}`)}</dt>
                <dd>{arr.length ? <ul className="list-disc pl-5">{arr.map((x) => <li key={x}>{x}</li>)}</ul> : t('drawer.none_listed')}</dd>
              </div>
            ))}
            <div><dt className="text-sm text-muted">{t('drawer.tourist_zone')}</dt><dd>{d.exposure.tourist_zone ? t('common.yes') : t('common.no')}</dd></div>
            <p className="text-xs"><SourceTag k="population" /></p>
          </dl>
        ) : <div className="h-40 rounded bg-surface-2 animate-pulse" />)}

        {tab === 'response' && (
          <>
            {openInc ? <IncidentDetail id={openInc} onClose={() => setOpenInc(null)} /> : (
              <>
                <section>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-bold">{t('drawer.open_incidents')}</h3>
                    {can('incidents.manage') && <button type="button" className="btn-secondary !min-h-[36px] py-1 text-sm" onClick={createIncident}><ClipboardPlus size={15} aria-hidden />{t('drawer.create_incident')}</button>}
                  </div>
                  <ul className="mt-2 space-y-2">
                    {(d?.incidents || []).length === 0 && <li className="text-sm text-muted">{t('drawer.no_incidents')}</li>}
                    {d?.incidents?.map((i) => (
                      <li key={i.id}>
                        <button type="button" onClick={() => setOpenInc(i.id)} className="w-full text-left card p-3 hover:bg-surface-2">
                          <span className="font-semibold block">{i.title}</span>
                          <span className="text-sm text-muted">{t(`stage.${i.stage}`)} · {dateTimeIST(i.detected_at, lang)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
                {levelSops.length > 0 && (
                  <section>
                    <h3 className="font-bold">{t('drawer.sop_for', { level: t(`levels.${r!.level}`) })}</h3>
                    <ul className="mt-1 list-disc pl-5 text-sm space-y-1">{levelSops.map((s) => <li key={s.key}>{lang === 'hi' ? s.text_hi : s.text_en}</li>)}</ul>
                  </section>
                )}
                <section>
                  <h3 className="font-bold">{t('drawer.resources_nearby')}</h3>
                  <ul className="mt-1 text-sm space-y-1">
                    {(d?.resources || []).map((x) => (
                      <li key={x.id} className="flex justify-between gap-2"><span>{x.name}</span><span className="text-muted">{t(`resources.st_${x.status}`)}</span></li>
                    ))}
                  </ul>
                </section>
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
