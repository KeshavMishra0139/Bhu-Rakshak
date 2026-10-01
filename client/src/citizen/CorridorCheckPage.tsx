// Road corridor checker: pick a start and end, see the route cut into ~2 km segments coloured by live risk,
// a summary ("2 of 18 segments high-risk") and, when the route crosses high-risk places, a lower-risk alternative
// if one exists. Desktop: segment list beside the map. Phone: full-width form, map, then the list.
// Works in both the citizen and officer shells (it only needs the live risk stream).
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowDownUp, ArrowLeft, Crosshair, Loader2, LocateFixed, Navigation, Route as RouteIcon, X, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { errorKey } from '../api/client';
import { useRiskStream } from '../live/RiskStreamProvider';
import { MapSearch } from '../authority/map/MapSearch';
import { RiskBadge } from '../components/RiskBadge';
import { fetchAlternative, fetchRoute, isHigh, summarise, viaPoints, SEG_COLOR_NONE, type CorridorRoute, type CorridorSource, type LatLng, type SegLevel } from '../lib/corridor';
import { googleDirectionsUrl } from '../lib/directions';
import { levelVar, LEVELS } from '../lib/risk';
import { placeName } from '../lib/format';
import { withPane } from '../lib/viewAs';
import { useWide } from '../lib/useWide';

const CorridorMap = lazy(() => import('../components/CorridorMap'));
/** `gps`: the start is where the person is right now (Google Maps can then start navigating straight away). */
type Pt = { lat: number; lng: number; label: string; gps?: boolean };
type Which = 'start' | 'end';
const EXAMPLES: [string, string][] = [['gangtok', 'sevoke'], ['gangtok', 'mangan'], ['guwahati', 'shillong']];

export default function CorridorCheckPage({ backTo = '/citizen/roads' }: { backTo?: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { list, locations } = useRiskStream();
  const [pts, setPts] = useState<Record<Which, Pt | null>>({ start: null, end: null });
  const [picking, setPicking] = useState<Which | null>(null);
  const [main, setMain] = useState<CorridorRoute | null>(null);
  const [source, setSource] = useState<CorridorSource>({ routing: 'OSRM', segment_km: 2, monitor_km: 8 });
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [alt, setAlt] = useState<CorridorRoute | null>(null);
  const [altState, setAltState] = useState<'idle' | 'loading' | 'found' | 'none' | 'error'>('idle');
  const [showAlt, setShowAlt] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [gps, setGps] = useState<'idle' | 'busy' | 'denied'>('idle');
  const listRef = useRef<HTMLOListElement>(null);
  const wide = useWide();

  const sum = main ? summarise(main, locations) : null;
  const altSum = alt ? summarise(alt, locations) : null;
  const ll = (p: Pt): LatLng => [p.lat, p.lng];

  const set = (w: Which, p: Pt | null) => { setPts((x) => ({ ...x, [w]: p })); setMain(null); setAlt(null); setAltState('idle'); setShowAlt(false); setSelected(null); };
  const station = (id: string): Pt | null => { const l = locations[id]; return l ? { lat: l.lat, lng: l.lng, label: placeName(l, lang) } : null; };

  async function findAlt(from: Pt, to: Pt) {
    setAltState('loading');
    try {
      const a = await fetchAlternative(ll(from), ll(to));
      setAlt(a.alternative); setAltState(a.alternative ? 'found' : 'none');
    } catch { setAltState('error'); }
  }
  async function check(from = pts.start, to = pts.end) {
    if (!from || !to) return;
    setState('loading'); setErr(null); setMain(null); setAlt(null); setAltState('idle'); setShowAlt(false); setSelected(null); setShowAll(false);
    try {
      const r = await fetchRoute(ll(from), ll(to));
      setMain(r.routes[0]); setSource(r.source); setState('idle');
      // Only look for a way round when the route actually crosses high-risk places (each look costs several routing calls).
      if (summarise(r.routes[0], locations).high > 0) findAlt(from, to);
    } catch (e) { setErr(errorKey(e)); setState('error'); }
  }

  function myLocation() {
    if (!navigator.geolocation) { setGps('denied'); return; }
    setGps('busy');
    navigator.geolocation.getCurrentPosition(
      (p) => { set('start', { lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5), label: t('corridor.my_location'), gps: true }); setGps('idle'); },
      () => setGps('denied'), { timeout: 10000, maximumAge: 300000 },
    );
  }

  // A route handed over by Saathi ("Is my road to Shillong safe?"): ?from=gangtok&to=shillong, checked straight away.
  const [params] = useSearchParams();
  const qFrom = params.get('from');
  const qTo = params.get('to');
  const asked = useRef<string | null>(null);
  const reveal = useRef(false);
  const mapBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = `${qFrom}>${qTo}`;
    if (!qFrom || !qTo || asked.current === key) return;
    const a = station(qFrom);
    const b = station(qTo);
    if (!a || !b) return; // places not loaded yet
    asked.current = key;
    reveal.current = true;
    setPts({ start: a, end: b });
    check(a, b);
  }, [qFrom, qTo, locations]); // eslint-disable-line react-hooks/exhaustive-deps
  // Once that route is checked, scroll to the result (the map with the summary just below it), so nobody has to
  // look for it under the form on a phone.
  useEffect(() => {
    if (!main || !reveal.current) return;
    reveal.current = false;
    mapBox.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [main]);

  useEffect(() => {
    if (selected == null) return;
    listRef.current?.querySelector<HTMLElement>(`[data-seg="${selected}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  const km = (m: number) => (m / 1000).toFixed(m < 10000 ? 1 : 0);
  const dur = (s: number) => { const m = Math.round(s / 60); return m < 60 ? t('corridor.dur_min', { m }) : t('corridor.dur_h', { h: Math.floor(m / 60), m: m % 60 }); };
  // "Get directions": Google Maps on the same roads checked here (a few points along the route keep it there). From the
  // person's own location it starts turn-by-turn navigation straight away; from a chosen place it opens the route first.
  const gmaps = (r: CorridorRoute) => {
    if (!pts.start || !pts.end) return '#';
    const waypoints = viaPoints(r).map(([lat, lng]) => ({ lat, lng }));
    return pts.start.gps
      ? googleDirectionsUrl({ destination: pts.end, waypoints, navigate: true })
      : googleDirectionsUrl({ origin: pts.start, destination: pts.end, waypoints });
  };
  const levelLabel = (l: SegLevel) => (l === 'none' ? t('corridor.not_monitored') : t(`levels.${l}`));
  const rows = sum?.rows || [];
  const visibleRows = showAll ? rows : rows.slice(0, 8);

  const field = (w: Which) => {
    const p = pts[w];
    return (
      <div className="min-w-0">
        <span className="field-label inline-flex items-center gap-1.5">
          <span className="grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: w === 'start' ? '#2d765b' : '#15241c' }} aria-hidden>{w === 'start' ? 'A' : 'B'}</span>
          {t(`corridor.${w}`)}
        </span>
        {p ? (
          <div className="flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-surface-2 px-3">
            <span className="min-w-0 flex-1 truncate font-semibold">{p.label}</span>
            <button type="button" className="-mr-1 p-1.5 text-muted hover:text-ink" onClick={() => set(w, null)} aria-label={t('corridor.clear', { which: t(`corridor.${w}`) })}><X size={16} aria-hidden /></button>
          </div>
        ) : (
          <MapSearch locations={list} onPickStation={(id) => set(w, station(id))} onPickPlace={(pin) => set(w, { lat: pin.lat, lng: pin.lng, label: pin.label })} />
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {w === 'start' && (
            <button type="button" className="btn-ghost !min-h-[36px] px-2.5 py-1 text-sm" onClick={myLocation} disabled={gps === 'busy'}>
              <LocateFixed size={15} aria-hidden />{gps === 'busy' ? t('citizen.locating') : t('corridor.my_location')}
            </button>
          )}
          <button type="button" aria-pressed={picking === w} onClick={() => setPicking((x) => (x === w ? null : w))}
            className={`${picking === w ? 'btn-primary' : 'btn-ghost'} !min-h-[36px] px-2.5 py-1 text-sm`}>
            <Crosshair size={15} aria-hidden />{picking === w ? t('corridor.picking') : t('corridor.pick_map')}
          </button>
        </div>
        {w === 'start' && gps === 'denied' && <p className="field-error mt-1" role="alert">{t('citizen.gps_denied')}</p>}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <Link to={withPane(backTo)} className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline"><ArrowLeft size={15} aria-hidden />{t('corridor.back')}</Link>
        <h1 className="mt-1 text-[1.7rem] font-bold leading-tight">{t('corridor.title')}</h1>
        <p className="text-muted">{t('corridor.intro')}</p>
      </div>

      <section className="card p-4" aria-label={t('corridor.form')}>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-start">
          {field('start')}
          <button type="button" className="btn-ghost justify-self-center md:mt-7 !min-h-[40px] px-2.5" aria-label={t('corridor.swap')} title={t('corridor.swap')}
            onClick={() => { setPts((x) => ({ start: x.end, end: x.start })); setMain(null); setAlt(null); setAltState('idle'); }}>
            <ArrowDownUp size={18} className="md:rotate-90" aria-hidden />
          </button>
          {field('end')}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary w-full sm:w-auto" disabled={!pts.start || !pts.end || state === 'loading'} onClick={() => check()}>
            {state === 'loading' ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <RouteIcon size={18} aria-hidden />}
            {state === 'loading' ? t('corridor.checking') : t('corridor.check')}
          </button>
          <span className="text-sm text-muted">{t('corridor.examples')}</span>
          {EXAMPLES.filter(([a, b]) => locations[a] && locations[b]).map(([a, b]) => (
            <button key={`${a}-${b}`} type="button" className="rounded-pill border border-line px-3 py-1 text-sm font-semibold hover:bg-surface-2"
              onClick={() => { const s = station(a); const e = station(b); setPts({ start: s, end: e }); check(s, e); }}>
              {placeName(locations[a], lang)} → {placeName(locations[b], lang)}
            </button>
          ))}
        </div>
        {err && <p className="field-error mt-2" role="alert">{t(err)}</p>}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div ref={mapBox} className="relative isolate h-[46dvh] min-h-[300px] scroll-mt-3 overflow-hidden rounded-card border border-line lg:sticky lg:top-4 lg:h-[calc(100dvh-8rem)] lg:min-h-[480px]">
          <Suspense fallback={<div className="skeleton h-full w-full" />}>
            <CorridorMap route={main} alternative={alt} showAlt={showAlt} start={pts.start && ll(pts.start)} end={pts.end && ll(pts.end)}
              locations={locations} list={list} picking={!!picking} selected={selected} onSelect={setSelected}
              onPick={(p) => { if (!picking) return; set(picking, { lat: p[0], lng: p[1], label: `${p[0].toFixed(4)}, ${p[1].toFixed(4)}` }); setPicking(null); }} />
          </Suspense>
          {picking && (
            <p className="pointer-events-none absolute left-3 top-3 z-[1100] max-w-[calc(100%-1.5rem)] rounded-pill bg-[#15241c]/90 px-3 py-1.5 text-xs font-semibold text-[#d7efd8] shadow">
              {t('corridor.tap_map', { which: t(`corridor.${picking}`) })}
            </p>
          )}
          {main && (
            <ul className="pointer-events-none absolute bottom-3 left-3 z-[1100] flex max-w-[calc(100%-4.5rem)] flex-wrap gap-x-3 gap-y-1 rounded-xl bg-surface/90 px-3 py-2 text-[11px] font-semibold shadow" aria-label={t('map.legend')}>
              {LEVELS.map((lv) => <li key={lv} className="inline-flex items-center gap-1"><span className="h-1.5 w-4 rounded-full" style={{ background: levelVar(lv) }} aria-hidden />{t(`levels.${lv}`)}</li>)}
              <li className="inline-flex items-center gap-1"><span className="h-1.5 w-4 rounded-full" style={{ background: SEG_COLOR_NONE }} aria-hidden />{t('corridor.not_monitored')}</li>
            </ul>
          )}
        </div>

        <aside className="space-y-3" aria-label={t('corridor.results')}>
          {!main && state !== 'loading' && (
            <section className="card p-4 text-muted">{t('corridor.empty')}</section>
          )}
          {state === 'loading' && <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="skeleton h-28 rounded-card" />)}</div>}

          {main && sum && (
            <section className="card overflow-hidden fade-enter" aria-labelledby="cc-summary">
              <div className="p-4" style={{ borderTop: `6px solid ${sum.worst === 'none' ? SEG_COLOR_NONE : levelVar(sum.worst)}` }}>
                <h2 id="cc-summary" className="text-xl font-bold leading-tight">
                  {sum.high > 0 ? t('corridor.summary', { high: sum.high, total: sum.total }) : t('corridor.summary_none', { total: sum.total })}
                </h2>
                <p className="mt-1 text-sm text-muted">{t('corridor.distance', { km: km(main.distance_m), dur: dur(main.duration_s) })}</p>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {(['critical', 'high', 'moderate', 'low', 'none'] as SegLevel[]).filter((l) => sum.by[l] > 0).map((l) => (
                    <li key={l} className="inline-flex items-center gap-1.5 rounded-pill border border-line px-2.5 py-0.5 text-xs font-semibold">
                      <span className="h-2 w-2 rounded-full" style={{ background: l === 'none' ? SEG_COLOR_NONE : levelVar(l) }} aria-hidden />
                      {levelLabel(l)} <span className="tabular-nums">{sum.by[l]}</span>
                    </li>
                  ))}
                </ul>
                {/* Directions straight from Google Maps. On a route through high-risk places, say so first and make it the
                    secondary choice (the lower-risk route below gets the main button). */}
                {sum.high > 0 && (
                  <p className="mt-3 flex items-start gap-2 rounded-lg border border-risk-high/60 bg-risk-high/10 p-2.5 text-sm font-semibold">
                    <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden />
                    {altState === 'none' || (altState === 'found' && altSum && altSum.high >= sum.high) ? t('corridor.dir_risky_noalt') : t('corridor.dir_risky')}
                  </p>
                )}
                <a href={gmaps(main)} target="_blank" rel="noopener noreferrer" className={`${sum.high > 0 ? 'btn-secondary' : 'btn-primary'} mt-3 w-full`}>
                  <Navigation size={18} aria-hidden />{sum.high > 0 ? t('corridor.dir_anyway') : t('corridor.dir_get')}
                  <span className="sr-only"> ({t('roads.gmaps_opens')})</span>
                </a>
                <p className="mt-1.5 text-xs text-muted">{pts.start?.gps ? t('corridor.dir_note_gps') : t('corridor.dir_note')}</p>
              </div>
            </section>
          )}

          {main && sum && sum.high > 0 && (
            <section className="card p-4 fade-enter" aria-labelledby="cc-alt" aria-live="polite">
              <h2 id="cc-alt" className="flex items-center gap-2 font-bold"><ShieldCheck size={18} className="text-brand" aria-hidden />{t('corridor.alt_title')}</h2>
              {altState === 'idle' && (
                <button type="button" className="btn-secondary mt-2 !min-h-[40px] text-sm" onClick={() => pts.start && pts.end && findAlt(pts.start, pts.end)}>{t('corridor.alt_find')}</button>
              )}
              {altState === 'loading' && <p className="mt-2 inline-flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" aria-hidden />{t('corridor.alt_loading')}</p>}
              {altState === 'error' && <p className="mt-2 text-sm text-muted">{t('corridor.alt_error')}</p>}
              {altState === 'none' && <p className="mt-2 text-sm">{t('corridor.alt_none')}</p>}
              {altState === 'found' && alt && altSum && (
                <>
                  <p className="mt-2 font-semibold">
                    {altSum.high > 0 ? t('corridor.summary', { high: altSum.high, total: altSum.total }) : t('corridor.summary_none', { total: altSum.total })}
                  </p>
                  <p className="text-sm text-muted">
                    {t('corridor.distance', { km: km(alt.distance_m), dur: dur(alt.duration_s) })}
                    {' · '}{t('corridor.extra_km', { km: Math.max(0, Math.round((alt.distance_m - main.distance_m) / 1000)) })}
                  </p>
                  {alt.via && <p className="mt-1 text-sm">{t('corridor.alt_via', { via: alt.via })}</p>}
                  {alt.kind === 'detour' && <p className="mt-1 text-xs text-muted">{t('corridor.alt_detour_note')}</p>}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" className="btn-secondary !min-h-[40px] text-sm" aria-pressed={showAlt} onClick={() => setShowAlt((v) => !v)}>
                      {showAlt ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}{showAlt ? t('corridor.alt_hide') : t('corridor.alt_show')}
                    </button>
                    <a href={gmaps(alt)} target="_blank" rel="noopener noreferrer" className={`${altSum.high < sum.high ? 'btn-primary' : 'btn-secondary'} !min-h-[40px] text-sm`}>
                      <Navigation size={16} aria-hidden />{t('corridor.dir_alt')}<span className="sr-only"> ({t('roads.gmaps_opens')})</span>
                    </a>
                  </div>
                </>
              )}
            </section>
          )}

          {main && sum && (
            <section className="card p-3" aria-labelledby="cc-segs">
              <h2 id="cc-segs" className="px-1 pb-2 font-bold">{t('corridor.segments', { n: sum.total })}</h2>
              <ol ref={listRef} className="space-y-1.5 lg:max-h-[calc(100dvh-26rem)] lg:overflow-y-auto lg:pr-1">
                {(wide ? rows : visibleRows).map((row) => {
                  const near = row.seg.place_id ? locations[row.seg.place_id] : null;
                  return (
                    <li key={row.i} data-seg={row.i}>
                      <button type="button" onClick={() => setSelected(row.i)} aria-current={selected === row.i ? 'true' : undefined}
                        className={`flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left ${selected === row.i ? 'border-brand bg-brand/10' : 'border-line hover:bg-surface-2'}`}>
                        <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ background: row.level === 'none' ? SEG_COLOR_NONE : levelVar(row.level) }} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold">{t('corridor.seg_n', { n: row.i + 1 })} · <span className="font-mono text-xs tabular-nums">{t('corridor.km_range', { a: row.fromKm.toFixed(0), b: row.toKm.toFixed(0) })}</span></span>
                          <span className="block truncate text-xs text-muted">{near ? t('corridor.near', { place: placeName(near, lang), km: row.seg.place_km }) : t('corridor.no_station', { km: source.monitor_km })}</span>
                        </span>
                        {row.level === 'none'
                          ? <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">{t('corridor.not_monitored')}</span>
                          : <RiskBadge level={row.level} size="sm" className={isHigh(row.level) ? '' : 'opacity-90'} />}
                      </button>
                    </li>
                  );
                })}
              </ol>
              {rows.length > 8 && (
                <button type="button" className="btn-ghost mt-2 w-full !min-h-[40px] text-sm lg:hidden" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? t('corridor.show_fewer') : t('corridor.show_all', { n: rows.length })}
                </button>
              )}
            </section>
          )}
          <p className="px-1 text-xs text-muted">{t('corridor.method', { seg: source.segment_km, km: source.monitor_km })}</p>
        </aside>
      </div>
    </div>
  );
}
