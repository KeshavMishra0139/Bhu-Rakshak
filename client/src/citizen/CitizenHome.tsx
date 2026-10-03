import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Crosshair, Volume2, Square, ChevronDown, Phone, Sparkles, MessageCircle, Clock, HelpCircle } from 'lucide-react';
import { api } from '../api/client';
import type { ImdSummary, Me, Road, Stakeholder } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { useRiskStream, useStreamEvent } from '../live/RiskStreamProvider';
import { useCitizen } from './CitizenContext';
import { useSaathi } from './Saathi';
import { RiskBadge } from '../components/RiskBadge';
import { UpdatedAgo } from '../components/UpdatedAgo';
import { ImdPanel } from '../components/ImdPanel';
import { placeName, timeIST, dayIST, isDeva } from '../lib/format';
import { isPreview } from '../lib/mapConfig';
import { driverPlain } from '../lib/factors';
import { useWide } from '../lib/useWide';
import { WhyCard } from '../components/WhyCard';
import { BottomSheet } from '../components/BottomSheet';
import { SafePlace } from '../components/SafePlace';
import { WarningSigns } from '../components/WarningSigns';
import { HelpButton } from '../components/HelpButton';
import { CitizenTour } from './CitizenTour';
import { LEVEL_ICON, TREND_ICON, levelVar, riskConfig } from '../lib/risk';
import { canSpeak, speak, stopSpeaking } from '../lib/audio';
import { useNow } from '../lib/useNow';
import { withPane } from '../lib/viewAs';
import { RoadBadge } from './RoadBadge';
import { WatchStrip } from '../components/RiskMix';

type Forecast = { hourly_rain: { time: string; hour_ist: number; rain_mm: number }[]; best_travel: { start: string; end: string; rain_mm: number } | null };

function nearest(list: { id: string; lat: number; lng: number }[], lat: number, lng: number) {
  let best: string | null = null;
  let bd = Infinity;
  for (const l of list) {
    const d = (l.lat - lat) ** 2 + ((l.lng - lng) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bd) { bd = d; best = l.id; }
  }
  return best;
}

export default function CitizenHome() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { setMe } = useAuth();
  const { locations, list, status } = useRiskStream();
  const { viewingId, setViewingId, homeId } = useCitizen();
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [roads, setRoads] = useState<Road[]>([]);
  const [contacts, setContacts] = useState<Stakeholder[]>([]);
  const [gps, setGps] = useState<'idle' | 'busy' | 'denied'>('idle');
  const [speaking, setSpeaking] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [noVoice, setNoVoice] = useState(false);
  useEffect(() => setNoVoice(false), [lang]);
  const wide = useWide();

  const loc = viewingId ? locations[viewingId] : undefined;
  const r = loc?.risk;
  const places = useMemo(() => [...list].sort((a, b) => placeName(a, lang).localeCompare(placeName(b, lang))), [list, lang]);

  useEffect(() => {
    if (!viewingId) return;
    api.get<Forecast>(`/risk/forecast?location_id=${viewingId}`).then(setForecast).catch(() => {});
  }, [viewingId, r?.level]);
  useEffect(() => {
    api.get<{ roads: Road[] }>('/roads').then((d) => setRoads(d.roads)).catch(() => {});
    api.get<{ stakeholders: Stakeholder[] }>('/stakeholders').then((d) => setContacts(d.stakeholders)).catch(() => {});
  }, []);
  useStreamEvent('road_updated', (rd) => setRoads((prev) => prev.map((x) => (x.id === rd.id ? rd : x))));

  function locate() {
    if (!navigator.geolocation) { setGps('denied'); return; }
    setGps('busy');
    navigator.geolocation.getCurrentPosition(
      (p) => { const id = nearest(list, p.coords.latitude, p.coords.longitude); if (id) setViewingId(id); setGps('idle'); },
      () => setGps('denied'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  async function makeHome() {
    if (!viewingId) return;
    await api.put('/settings', { home_location_id: viewingId }).catch(() => {});
    setMe(await api.get<Me>('/auth/me'));
  }

  const road = loc?.road?.split(' / ')[0] || (lang === 'hi' ? 'मुख्य सड़क' : lang === 'ne' ? 'मुख्य सडक' : 'the main road');
  // "Avoid travel after {time}": the rainiest hour in the next 12 h, if meaningful rain is expected.
  const peak = useMemo(() => {
    const next = forecast?.hourly_rain.slice(0, 12) || [];
    const top = next.reduce<(typeof next)[number] | null>((m, x) => (!m || x.rain_mm > m.rain_mm ? x : m), null);
    return top && top.rain_mm >= 1 ? top.time : null;
  }, [forecast]);
  const sentence = !r ? '' : r.level === 'moderate'
    // The rainiest hour can fall after midnight: then it is "tomorrow", not "today".
    ? (peak ? t(dayIST(Date.parse(peak)) === dayIST(Date.now()) ? 'citizen.s_moderate' : 'citizen.s_moderate_tomorrow', { road, time: timeIST(peak, lang) })
      : t('citizen.s_moderate_notime', { road }))
    : t(`citizen.s_${r.level}`, { road });
  const why = (r?.drivers || []).slice(0, 2).map((d) => driverPlain(d.key, lang));
  const whyLine = why.length ? `${t('citizen.why')}: ${why.join(t('citizen.and_sep'))}.` : '';
  const Icon = r ? LEVEL_ICON[r.level] : null;
  const Trend = r ? TREND_ICON[r.trend] : null;
  const nearRoads = roads.filter((x) => viewingId && x.path.includes(viewingId));
  const localContacts = contacts.filter((c) => c.district === loc?.district || c.district === 'All');
  const maxRain = Math.max(1, ...(forecast?.hourly_rain.map((x) => x.rain_mm) || [1]));
  // "Updated" is when the score was recalculated; the rain behind it can be older, or not live at all.
  const now = useNow(60000);
  const rainAt = typeof r?.conditions.data_fetched_at === 'string' ? r.conditions.data_fetched_at : null;
  const rainSource = typeof r?.conditions.data_source === 'string' ? r.conditions.data_source : null;
  const rainHours = rainAt ? Math.floor((now - new Date(rainAt).getTime()) / 3600000) : null;
  const staleNote = rainSource && rainSource !== 'open-meteo' ? t('citizen.no_live_rain')
    : rainHours != null && rainHours >= riskConfig.live.staleDataHours ? t('citizen.stale_rain', { hours: rainHours }) : '';
  const imd = r?.conditions.imd as ImdSummary | null | undefined;
  const imdUrgent = !!imd && [imd.nowcast?.color, imd.days[0]?.color].some((c) => c === 'orange' || c === 'red');

  function listen() {
    if (speaking) { stopSpeaking(); setSpeaking(false); return; }
    if (!loc || !r) return;
    const text = `${placeName(loc, lang)}. ${t(`citizen.lt_${r.level}`)}. ${sentence} ${staleNote} ${whyLine}`;
    if (speak(text, lang)) { setSpeaking(true); setTimeout(() => setSpeaking(false), Math.min(20000, text.length * 90)); }
    else setNoVoice(true); // e.g. Assamese on a phone with no Assamese or Bengali voice
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-end gap-3" aria-label={t('citizen.pick_place')}>
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="place" className="field-label">{t('citizen.showing')}</label>
          <select id="place" className="input text-lg font-semibold" value={viewingId || ''} onChange={(e) => setViewingId(e.target.value)}>
            <option value="" disabled>{t('citizen.pick_place')}</option>
            {places.map((l) => <option key={l.id} value={l.id}>{placeName(l, lang)}, {t(`districts.${l.district}`)}{isPreview(l) ? ` · ${t('preview.badge_plain')}` : ''}</option>)}
          </select>
        </div>
        <button type="button" className="btn-secondary" onClick={locate} disabled={gps === 'busy'}>
          <Crosshair size={18} aria-hidden />{gps === 'busy' ? t('citizen.locating') : t('citizen.use_gps')}
        </button>
        {viewingId && viewingId !== homeId && <button type="button" className="btn-ghost" onClick={makeHome}>{t('citizen.set_home')}</button>}
        {gps === 'denied' && <p className="w-full field-error" role="alert">{t('citizen.gps_denied')}</p>}
      </section>

      {!loc || !r ? (
        !viewingId ? (
          <section className="card p-6">
            <h1 className="text-2xl font-bold">{t('citizen.no_home_title')}</h1>
            <p className="text-muted mt-1">{t('citizen.no_home_body')}</p>
          </section>
        ) : status === 'connecting' && !list.length ? (
          <div className="h-48 rounded-card bg-surface-2 animate-pulse" aria-hidden />
        ) : (
          // A place is chosen but there is no risk for it (offline with nothing saved, or no record): say so, never guess.
          <section className="card p-6" role="status">
            <h1 className="text-2xl font-bold">{t('citizen.no_data_title')}</h1>
            <p className="mt-1 text-[1.05rem]">{t('citizen.no_data_body')}</p>
            <a href="tel:112" className="btn-danger mt-4 text-lg"><Phone size={20} aria-hidden />{t('citizen.call_112')}</a>
          </section>
        )
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="card overflow-hidden lg:col-span-2" aria-labelledby="status-title" data-tour="status">
            <div className="p-6 sm:p-7 flex flex-col sm:flex-row gap-5" style={{ borderTop: `8px solid ${levelVar(r.level)}` }}>
              {Icon && (
                <span className="h-20 w-20 shrink-0 rounded-2xl inline-flex items-center justify-center" style={{ background: levelVar(r.level), color: '#fff' }}>
                  <Icon size={46} aria-hidden strokeWidth={2.2} />
                </span>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-muted font-semibold">
                  {placeName(loc, lang)}, {t(`districts.${loc.district}`)}
                  {viewingId === homeId && <span className="ml-2 rounded-pill bg-surface-2 px-2 py-0.5 text-xs">{t('citizen.your_area')}</span>}
                </p>
                <div className="flex items-start gap-1">
                  <h1 id="status-title" className="text-[2rem] sm:text-[2.3rem] font-bold leading-tight">{t(`citizen.lt_${r.level}`)}</h1>
                  <span className="mt-2 sm:mt-3"><HelpButton topic="status" /></span>
                </div>
                <p className="text-[1.2rem] mt-1 font-semibold">{sentence}</p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {Trend && <span className="rounded-pill border border-line px-3 py-1 text-sm font-semibold inline-flex items-center gap-1"><Trend size={15} aria-hidden />{t(`trend.${r.trend}`)}</span>}
                  <UpdatedAgo at={r.updated_at} />
                </div>
                {staleNote && (
                  <p className="mt-3 flex items-start gap-2 rounded-lg border border-risk-moderate/60 bg-risk-moderate/10 p-3 font-semibold" role="status">
                    <Clock size={18} className="mt-0.5 shrink-0" aria-hidden />{staleNote}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {canSpeak() && !noVoice && (
                    <button type="button" className="btn-secondary" onClick={listen} aria-pressed={speaking}>
                      {speaking ? <Square size={18} aria-hidden /> : <Volume2 size={18} aria-hidden />}{speaking ? t('citizen.stop_listen') : t('citizen.listen')}
                    </button>
                  )}
                  {/* The reasons, how sure we are and what we watch: one tap away, in the same Why card as the map. */}
                  <button type="button" className="btn-secondary" aria-expanded={showWhy} onClick={() => setShowWhy((v) => !v)} data-tour="why">
                    <HelpCircle size={18} aria-hidden />{t('citizen.why_btn')}
                  </button>
                  <button type="button" className="btn-ghost" aria-expanded={showDetails} onClick={() => setShowDetails((v) => !v)}>
                    {showDetails ? t('citizen.hide_details') : t('citizen.details_toggle')}
                    <ChevronDown size={18} aria-hidden className={showDetails ? 'rotate-180' : ''} />
                  </button>
                </div>
                {noVoice && <p className="mt-2 text-sm text-muted" role="status">{t('citizen.no_voice_lang')}</p>}
                {showDetails && (
                  <dl className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {([['d_rain_now', r.conditions.rain_intensity, 'mm/h'], ['d_rain_24h', r.conditions.rain_24h, 'mm'], ['d_rain_fc', r.conditions.rain_fc_24h, 'mm']] as const).map(([k, v, u]) => (
                      <div key={k} className="rounded-lg bg-surface-2 p-3">
                        <dt className="text-sm text-muted">{t(`citizen.${k}`)}</dt>
                        <dd className="text-xl font-bold tabular-nums">{v == null ? '–' : Number(v).toFixed(1)} <span className="text-sm font-normal text-muted">{u}</span></dd>
                      </div>
                    ))}
                  </dl>
                )}
                {/* The weather department's warning sits in the details, unless it is orange or red (then it stays in view). */}
                {(showDetails || imdUrgent) && <ImdPanel imd={imd} className="mt-4" plain />}
              </div>
              <div className="sm:self-start"><RiskBadge level={r.level} /></div>
            </div>
          </section>

          {showWhy && wide && (
            <div className="lg:col-span-2 drawer-enter">
              <WhyCard loc={loc} onClose={() => setShowWhy(false)}><div className="mt-4"><WatchStrip compact /></div></WhyCard>
            </div>
          )}
          {showWhy && !wide && (
            <BottomSheet label={t('why.title')} onClose={() => setShowWhy(false)}
              extra={<a href="tel:112" className="inline-flex min-h-[32px] items-center gap-1 rounded-pill bg-risk-critical px-3 text-xs font-bold text-white" aria-label={t('citizen.call_112')}><Phone size={13} aria-hidden />{t('citizen.sos')}</a>}>
              <WhyCard loc={loc} variant="bare"><div className="mt-4"><WatchStrip compact /></div></WhyCard>
            </BottomSheet>
          )}

          <CitizenTour ready />

          <section className="card p-5" aria-labelledby="rain-title">
            <div className="flex items-center gap-1">
              <h2 id="rain-title" className="text-lg font-bold">{t('citizen.rain_48h')}</h2>
              <HelpButton topic="rain" />
            </div>
            {forecast ? (
              <>
                <div className="mt-4 flex items-end gap-[2px] h-32" role="img"
                  aria-label={`${t('citizen.rain_48h')}: ${t('citizen.mm', { value: forecast.hourly_rain.reduce((a, x) => a + x.rain_mm, 0).toFixed(0) })}`}>
                  {forecast.hourly_rain.map((x) => (
                    <div key={x.time} className="flex-1 rounded-t bg-brand/70" title={`${timeIST(x.time, lang)}: ${x.rain_mm} mm`}
                      style={{ height: `${Math.max(2, (x.rain_mm / maxRain) * 100)}%` }} />
                  ))}
                </div>
                <div className="mt-1 flex justify-between text-xs text-muted font-mono">
                  <span>{timeIST(forecast.hourly_rain[0]?.time, lang)}</span><span>+24h</span><span>+48h</span>
                </div>
                <p className="mt-4 font-semibold">
                  {forecast.best_travel
                    ? t('citizen.best_travel', { start: timeIST(forecast.best_travel.start, lang), end: timeIST(forecast.best_travel.end, lang) })
                    : t('citizen.best_travel_none')}
                </p>
              </>
            ) : <div className="mt-4 h-32 rounded bg-surface-2 animate-pulse" />}
          </section>

          <SaathiCard place={placeName(loc, lang)} />

          <section className="card p-5" aria-labelledby="roads-title">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <h2 id="roads-title" className="text-lg font-bold">{t('citizen.roads_here')}</h2>
                <HelpButton topic="roads" />
              </div>
              <Link to={withPane('/citizen/roads')} className="text-brand font-semibold text-sm hover:underline">{t('citizen.all_roads')}</Link>
            </div>
            <ul className="mt-3 divide-y divide-line">
              {nearRoads.length === 0 && <li className="py-2 text-muted">{t('roads.none_near')}</li>}
              {nearRoads.map((x) => (
                <li key={x.id} className="py-3 flex items-center gap-3">
                  <span className="flex-1 font-semibold">{isDeva(lang) ? x.name_hi : x.name_en}</span>
                  <RoadBadge status={x.status} />
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-5" aria-labelledby="contacts-title">
            <div className="flex items-center gap-1">
              <h2 id="contacts-title" className="text-lg font-bold">{t('citizen.contacts')}</h2>
              <HelpButton topic="contacts" />
            </div>
            <a href="tel:112" className="btn-danger w-full mt-3 text-lg"><Phone size={20} aria-hidden />{t('citizen.call_112')}</a>
            <div className="mt-3"><SafePlace from={loc} /></div>
            <ul className="mt-3 divide-y divide-line">
              {/* Only contacts officials have entered a number for ("To be configured" means nothing to a citizen). */}
              {localContacts.filter((c) => c.phone && c.phone !== '112').map((c) => (
                <li key={c.id} className="py-2.5 flex items-center gap-3">
                  <span className="flex-1">
                    <span className="block font-semibold">{c.role}</span>
                    <span className="block text-sm text-muted">{t(`districts.${c.district}`, { defaultValue: c.district })}</span>
                  </span>
                  <a className="btn-secondary" href={`tel:${c.phone}`}><Phone size={16} aria-hidden />{c.phone}</a>
                </li>
              ))}
            </ul>
          </section>

          <WarningSigns />
        </div>
      )}
    </div>
  );
}

/** Quick start for Saathi, the assistant that lives in the floating chat panel on every citizen page. */
function SaathiCard({ place }: { place: string }) {
  const { t } = useTranslation();
  const { open } = useSaathi();
  return (
    <section className="card p-5" aria-labelledby="ask-title">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#f4c993] text-[#49311f]" aria-hidden><Sparkles size={20} /></span>
        <div className="min-w-0">
          <h2 id="ask-title" className="text-lg font-bold">{t('citizen.saathi_card_title')}</h2>
          <p className="text-muted">{t('citizen.saathi_card_body')}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {(['travel', 'signs', 'prepare'] as const).map((k) => (
          <button key={k} type="button" className="rounded-pill border border-line px-3.5 py-2 text-[0.95rem] font-semibold hover:bg-surface-2 min-h-[44px] text-left"
            onClick={() => open({ intent: k, label: t(`citizen.q_${k}`) })}>
            {t(`citizen.q_${k}`)}
          </button>
        ))}
      </div>
      <button type="button" className="btn-primary mt-4 w-full sm:w-auto" onClick={() => open()}>
        <MessageCircle size={18} aria-hidden />{t('citizen.saathi_open')}
      </button>
      <p className="mt-2 text-sm text-muted">{t('citizen.saathi_note', { place })}</p>
    </section>
  );
}
