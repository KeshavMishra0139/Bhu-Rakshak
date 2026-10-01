// North East map layers for the citizen and officer maps: cumulative rainfall over 3 / 7 / 15 days (real, model
// data), jhum burn scars, road-cutting zones and ground movement from satellite radar (InSAR). The last three are
// SAMPLE DATA until real files are dropped in (see /data/layers/README.md) and are labelled as such everywhere.
// Pieces: useNerLayers (state + data), NerMapLayers (inside the map), NerLayerControls (inside the Layers panel),
// NerMapLegend (small legend over the map).
import { useEffect, useState } from 'react';
import { CircleMarker, GeoJSON, Rectangle, Tooltip } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import { CloudRain, Flame, Construction, Satellite, ChevronDown, ChevronUp } from 'lucide-react';
import {
  fetchLayerFile, fetchManifest, fetchRainGrid, insarColor, rainColor, INSAR_CLASSES, JHUM_COLOR, RAIN_BINS, RAIN_COLORS, ROADCUT_COLOR,
  type FeatureCollection, type FileLayerId, type LayerMeta, type RainGrid, type RainPeriod,
} from '../lib/nerLayers';
import { dateTimeIST } from '../lib/format';

export type NerState = { rain: boolean; period: RainPeriod; jhum: boolean; roadcut: boolean; insar: boolean };
const OFF: NerState = { rain: false, period: 7, jhum: false, roadcut: false, insar: false };

/** Layer state (remembered per map in this browser) and the data for the layers that are on. */
export function useNerLayers(key: string) {
  const storeKey = `br.ner.${key}`;
  const [state, setState] = useState<NerState>(() => {
    try { return { ...OFF, ...JSON.parse(localStorage.getItem(storeKey) || '{}') }; } catch { return OFF; }
  });
  const [rain, setRain] = useState<RainGrid | null>(null);
  const [rainErr, setRainErr] = useState(false);
  const [meta, setMeta] = useState<LayerMeta[]>([]);
  const [files, setFiles] = useState<Partial<Record<FileLayerId, FeatureCollection>>>({});

  useEffect(() => { try { localStorage.setItem(storeKey, JSON.stringify(state)); } catch { /* private mode */ } }, [state, storeKey]);
  useEffect(() => { fetchManifest().then(setMeta).catch(() => {}); }, []);
  useEffect(() => {
    if (!state.rain) return;
    const load = () => fetchRainGrid().then((g) => { setRain(g); setRainErr(false); }).catch(() => setRainErr(true));
    load();
    const id = setInterval(load, 30 * 60000);
    return () => clearInterval(id);
  }, [state.rain]);
  useEffect(() => {
    for (const m of meta) {
      if (state[m.id] && !files[m.id]) fetchLayerFile(m.file).then((fc) => setFiles((x) => ({ ...x, [m.id]: fc }))).catch(() => {});
    }
  }, [meta, state, files]);

  const set = (patch: Partial<NerState>) => setState((s) => ({ ...s, ...patch }));
  const metaOf = (id: FileLayerId) => meta.find((m) => m.id === id);
  const sampleOn = (['jhum', 'roadcut', 'insar'] as FileLayerId[]).some((id) => state[id] && (metaOf(id)?.sample ?? true));
  const count = (['rain', 'jhum', 'roadcut', 'insar'] as const).filter((k) => state[k]).length;
  return { state, set, rain, rainErr, files, metaOf, sampleOn, count };
}
export type NerLayers = ReturnType<typeof useNerLayers>;

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));

/** Leaflet layers; render inside the MapContainer. */
export function NerMapLayers({ ner }: { ner: NerLayers }) {
  const { t } = useTranslation();
  const { state, rain, files, metaOf } = ner;
  const sampleTag = (id: FileLayerId) => ((metaOf(id)?.sample ?? true) ? ` · ${t('ner.sample_short')}` : '');
  const half = (rain?.step ?? 0.5) / 2;
  return (
    <>
      {state.rain && rain?.cells.map(([lat, lng, r3, r7, r15]) => {
        const mm = state.period === 3 ? r3 : state.period === 7 ? r7 : r15;
        return (
          <Rectangle key={`${lat},${lng}`} bounds={[[lat - half, lng - half], [lat + half, lng + half]]}
            pathOptions={{ stroke: false, fillColor: rainColor(mm, state.period), fillOpacity: mm < RAIN_BINS[state.period][0] ? 0.08 : 0.5 }}>
            <Tooltip sticky>{t('ner.rain_tip', { mm: Math.round(mm), n: state.period })}</Tooltip>
          </Rectangle>
        );
      })}
      {state.jhum && files.jhum && (
        <GeoJSON key={`jhum-${files.jhum.features.length}`} data={files.jhum as never}
          style={() => ({ color: JHUM_COLOR, weight: 2, dashArray: metaOf('jhum')?.sample ?? true ? '5 4' : undefined, fillColor: JHUM_COLOR, fillOpacity: 0.35 })}
          onEachFeature={(f, layer) => layer.bindTooltip(`${t('ner.jhum')}${sampleTag('jhum')}${f.properties?.area_ha ? ` · ${f.properties.area_ha} ha` : ''}${f.properties?.burn_month ? ` · ${f.properties.burn_month}` : ''}`, { sticky: true })} />
      )}
      {state.roadcut && files.roadcut && (
        <GeoJSON key={`cut-${files.roadcut.features.length}`} data={files.roadcut as never}
          style={() => ({ color: ROADCUT_COLOR, weight: 6, opacity: 0.95, dashArray: metaOf('roadcut')?.sample ?? true ? '8 5' : undefined })}
          onEachFeature={(f, layer) => layer.bindTooltip(`${t('ner.roadcut')}${sampleTag('roadcut')}${f.properties?.slope_deg ? ` · ${t('ner.slope', { deg: f.properties.slope_deg })}` : ''}`, { sticky: true })} />
      )}
      {state.insar && files.insar?.features.filter((f) => f.geometry.type === 'Point').map((f, i) => {
        const [lng, lat] = f.geometry.coordinates as [number, number];
        const v = num(f.properties.velocity_mm_yr);
        return (
          <CircleMarker key={`in-${i}`} center={[lat, lng]} radius={5} pathOptions={{ color: '#333', weight: 1, fillColor: insarColor(v), fillOpacity: 0.95 }}>
            <Tooltip>{t('ner.insar_tip', { v: v.toFixed(1) })}{sampleTag('insar')}</Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}

function Row({ icon, label, sub, on, onToggle, sample }: { icon: React.ReactNode; label: string; sub?: string; on: boolean; onToggle: () => void; sample?: boolean }) {
  const { t } = useTranslation();
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onToggle}
      className="flex w-full items-start justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] font-semibold hover:bg-[#f3f7f1]">
      <span className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 shrink-0 text-[#476350]" aria-hidden>{icon}</span>
        <span className="min-w-0">
          <span className="block leading-snug">{label}</span>
          {sub && <span className="block text-[11px] font-medium text-[#5d7364]">{sub}</span>}
          {sample && <span className="mt-0.5 inline-block rounded bg-[#fde7c7] px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-[#8a4b00]">{t('ner.sample_short')}</span>}
        </span>
      </span>
      <span className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-[#2d765b]' : 'bg-[#cfdccf]'}`} aria-hidden>
        <span className={`absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </span>
    </button>
  );
}

/** Toggles for the Layers panel. */
export function NerLayerControls({ ner }: { ner: NerLayers }) {
  const { t, i18n } = useTranslation();
  const { state, set, rain, rainErr, metaOf } = ner;
  const isSample = (id: FileLayerId) => metaOf(id)?.sample ?? true;
  return (
    <div className="mt-2 border-t border-[#e3ece4] pt-2">
      <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#7a8d80]">{t('ner.heading')}</p>
      <Row icon={<CloudRain size={15} />} label={t('ner.rain')} sub={t('ner.rain_sub')} on={state.rain} onToggle={() => set({ rain: !state.rain })} />
      {state.rain && (
        <div className="px-2 pb-1">
          <div role="radiogroup" aria-label={t('ner.period')} className="mt-1 grid grid-cols-3 rounded-lg bg-[#eef3ee] p-0.5">
            {([3, 7, 15] as RainPeriod[]).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={state.period === p} onClick={() => set({ period: p })}
                className={`rounded-md px-2 py-1 text-[12px] font-bold ${state.period === p ? 'bg-white text-[#17392b] shadow-sm' : 'text-[#5d7364]'}`}>
                {t('ner.days', { n: p })}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-[#5d7364]">
            {rainErr ? t('ner.rain_error') : rain ? t('ner.rain_source', { time: dateTimeIST(rain.fetched_at, i18n.language) }) : t('ner.loading')}
          </p>
        </div>
      )}
      <Row icon={<Flame size={15} />} label={t('ner.jhum')} sub={t('ner.jhum_sub')} on={state.jhum} onToggle={() => set({ jhum: !state.jhum })} sample={isSample('jhum')} />
      <Row icon={<Construction size={15} />} label={t('ner.roadcut')} sub={t('ner.roadcut_sub')} on={state.roadcut} onToggle={() => set({ roadcut: !state.roadcut })} sample={isSample('roadcut')} />
      <Row icon={<Satellite size={15} />} label={t('ner.insar')} sub={t('ner.insar_sub')} on={state.insar} onToggle={() => set({ insar: !state.insar })} sample={isSample('insar')} />
      {ner.sampleOn && <p className="mx-2 mt-1 rounded-md bg-[#fde7c7] px-2 py-1 text-[11px] font-semibold text-[#8a4b00]">{t('ner.sample_note')}</p>}
    </div>
  );
}

/** Compact legend over the map for the layers that are on. Folds to a small chip; starts folded on phones. */
export function NerMapLegend({ ner, className = '' }: { ner: NerLayers; className?: string }) {
  const { t } = useTranslation();
  const { state } = ner;
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 640px)').matches);
  if (!state.rain && !state.insar && !state.jhum && !state.roadcut) return null;
  const bins = RAIN_BINS[state.period];
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-expanded={false}
        className={`z-[1100] inline-flex items-center gap-1 rounded-pill bg-white/95 px-2.5 py-1 text-[11px] font-bold text-[#17392b] shadow ${className}`}>
        {ner.sampleOn && <span className="rounded bg-[#fde7c7] px-1 text-[9px] uppercase text-[#8a4b00]">{t('ner.sample_short')}</span>}
        {t('map.legend')}<ChevronUp size={13} aria-hidden />
      </button>
    );
  }
  return (
    <div className={`z-[1100] max-w-[calc(100%-4.5rem)] space-y-1.5 rounded-xl bg-white/95 px-2.5 py-2 text-[10px] font-semibold text-[#17392b] shadow ${className}`} aria-label={t('map.legend')}>
      <button type="button" onClick={() => setOpen(false)} aria-expanded className="float-right -mr-1 -mt-1 rounded p-0.5 text-[#5d7364] hover:bg-[#eef3ee]" aria-label={t('ner.legend_hide')}><ChevronDown size={14} aria-hidden /></button>
      {ner.sampleOn && <p className="rounded bg-[#fde7c7] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8a4b00]">{t('ner.sample_banner')}</p>}
      {state.rain && (
        <div>
          <p>{t('ner.rain_legend', { n: state.period })}</p>
          <div className="mt-0.5 flex">
            {RAIN_COLORS.map((c, k) => (
              <span key={c} className="flex flex-col items-start">
                <span className="h-2 w-7" style={{ background: c }} />
                <span className="text-[9px] font-medium text-[#5d7364]">{k === 0 ? '0' : bins[k - 1]}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {state.insar && (
        <div>
          <p>{t('ner.insar_legend')}</p>
          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
            {INSAR_CLASSES.map((c) => (
              <span key={c.key} className="inline-flex items-center gap-1 font-medium"><span className="h-2 w-2 rounded-full border border-[#333]" style={{ background: c.color }} />{t(`ner.${c.key}`)}</span>
            ))}
          </div>
        </div>
      )}
      {(state.jhum || state.roadcut) && (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          {state.jhum && <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: JHUM_COLOR, opacity: 0.6 }} />{t('ner.jhum')}</span>}
          {state.roadcut && <span className="inline-flex items-center gap-1"><span className="h-1 w-4 rounded-full" style={{ background: ROADCUT_COLOR }} />{t('ner.roadcut')}</span>}
        </div>
      )}
    </div>
  );
}
