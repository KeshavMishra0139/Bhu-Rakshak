// Search box for the authority map: monitored places first (instant), then any place in the region
// from OpenStreetMap (via /api/map/geocode, which caches and rate-limits the free Nominatim service).
import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, MapPin, Search, ShieldAlert, X } from 'lucide-react';
import { api } from '../../api/client';
import type { LocationSnap } from '../../api/types';
import { placeName } from '../../lib/format';
import type { SearchPin } from './WatchMap';

type Place = { name: string; detail: string; lat: number; lng: number };
type Option = { kind: 'station'; loc: LocationSnap } | { kind: 'place'; place: Place };

export function MapSearch({ locations, onPickStation, onPickPlace, autoFocus = false }: {
  autoFocus?: boolean;
  locations: LocationSnap[];
  onPickStation: (id: string) => void;
  onPickPlace: (pin: SearchPin) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const listId = useId();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [places, setPlaces] = useState<Place[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const box = useRef<HTMLDivElement>(null);

  const query = q.trim().toLowerCase();
  const stations = useMemo(() => (query ? locations.filter((l) =>
    [l.name_en, l.name_hi, l.district, l.road || ''].some((s) => s.toLowerCase().includes(query))).slice(0, 5) : []), [locations, query]);

  // Other places: wait until typing pauses, then ask the server (which spaces requests out).
  useEffect(() => {
    setPlaces([]);
    if (query.length < 3) { setState('idle'); return; }
    setState('loading');
    let cancelled = false;
    const timer = setTimeout(() => {
      api.get<{ results: Place[] }>(`/map/geocode?q=${encodeURIComponent(q.trim())}`)
        .then((d) => { if (!cancelled) { setPlaces(d.results); setState('idle'); } })
        .catch(() => { if (!cancelled) setState('error'); });
    }, 450);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const options: Option[] = [...stations.map((loc) => ({ kind: 'station' as const, loc })), ...places.map((place) => ({ kind: 'place' as const, place }))];
  useEffect(() => { setActive(0); }, [query, places.length]);

  // Close when clicking elsewhere.
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function choose(o: Option | undefined) {
    if (!o) return;
    if (o.kind === 'station') { onPickStation(o.loc.id); setQ(placeName(o.loc, lang)); }
    else { onPickPlace({ lat: o.place.lat, lng: o.place.lng, label: o.place.name }); setQ(o.place.name); }
    setOpen(false);
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(options[active]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  const showList = open && query.length > 0;
  const optId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div ref={box} className="pointer-events-auto relative z-20 w-[min(340px,100%)]">
      <div className="flex items-center gap-2 rounded-xl border border-white/80 bg-white/95 px-3 shadow-sm backdrop-blur focus-within:ring-2 focus-within:ring-[#2d765b]">
        <Search size={16} className="shrink-0 text-[#476350]" aria-hidden />
        <input type="search" role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={showList && options[active] ? optId(active) : undefined} aria-label={t('map.search_label')}
          autoFocus={autoFocus} placeholder={t('map.search_placeholder')} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
          className="min-h-[40px] w-full bg-transparent text-[13px] font-semibold text-[#1d2b24] placeholder:text-[#7a8d80] outline-none [&::-webkit-search-cancel-button]:hidden" />
        {state === 'loading' && <Loader2 size={15} className="shrink-0 animate-spin text-[#476350]" aria-hidden />}
        {q && (
          <button type="button" onClick={() => { setQ(''); setPlaces([]); setOpen(false); }} aria-label={t('map.search_clear')}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[#476350] hover:bg-[#e8f3ed]"><X size={15} aria-hidden /></button>
        )}
      </div>

      {showList && (
        <ul id={listId} role="listbox" aria-label={t('map.search_label')}
          className="pop-enter origin-top absolute left-0 right-0 top-[calc(100%+6px)] max-h-[320px] overflow-y-auto rounded-xl border border-[#d9e5da] bg-white py-1 text-[13px] text-[#1d2b24] shadow-xl">
          {stations.length > 0 && <li role="presentation" className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#7a8d80]">{t('map.search_stations')}</li>}
          {options.map((o, i) => (
            <Fragment key={o.kind === 'station' ? `s-${o.loc.id}` : `p-${o.place.lat},${o.place.lng}`}>
              {i === stations.length && <li role="presentation" className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#7a8d80]">{t('map.search_places')}</li>}
              <li id={optId(i)} role="option" aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)} onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-start gap-2 px-3 py-2 ${i === active ? 'bg-[#e8f3ed]' : ''}`}>
                {o.kind === 'station'
                  ? <><ShieldAlert size={15} className="mt-0.5 shrink-0 text-[#cf624f]" aria-hidden /><span><span className="font-bold">{placeName(o.loc, lang)}</span><span className="block text-[11px] text-[#6b7d71]">{t(`districts.${o.loc.district}`)}{o.loc.risk ? ` · ${t(`levels.${o.loc.risk.level}`)}` : ''}</span></span></>
                  : <><MapPin size={15} className="mt-0.5 shrink-0 text-[#1a73e8]" aria-hidden /><span><span className="font-bold">{o.place.name}</span>{o.place.detail && <span className="block text-[11px] text-[#6b7d71]">{o.place.detail}</span>}</span></>}
              </li>
            </Fragment>
          ))}
          {query.length >= 3 && state === 'idle' && places.length === 0 && stations.length === 0 && <li role="presentation" className="px-3 py-2 text-[#6b7d71]">{t('map.search_none')}</li>}
          {query.length < 3 && stations.length === 0 && <li role="presentation" className="px-3 py-2 text-[#6b7d71]">{t('map.search_more')}</li>}
          {state === 'error' && <li role="presentation" className="px-3 py-2 text-[#a8681f]">{t('map.search_unavailable')}</li>}
          {state === 'loading' && <li role="presentation" className="px-3 py-2 text-[#6b7d71]">{t('map.search_loading')}</li>}
          {places.length > 0 && <li role="presentation" className="px-3 pb-1 pt-2 text-[10px] text-[#8a9a8f]">{t('map.search_credit')}</li>}
        </ul>
      )}
    </div>
  );
}
