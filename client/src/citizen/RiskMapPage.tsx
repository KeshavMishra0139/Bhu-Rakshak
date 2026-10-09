// Citizen risk map: every monitored place as a pin; picking one explains its risk in the "Why" card — beside the map
// on wide screens, in a bottom sheet on phones. Uses the same map and pins as the officer dashboard.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, ChevronRight, Phone, Layers, Megaphone } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { LocationSnap, Road } from '../api/types';
import { useRiskStream, useStreamEvent } from '../live/RiskStreamProvider';
import { useCitizen } from './CitizenContext';
import { WatchMap, PIN_LABEL, type LayerKey } from '../authority/map/WatchMap';
import { MapPopover, LayerSwitch } from '../authority/map/MapControls';
import { CommunityReportsLayer, CommunityLegend, useCommunityReports } from '../components/CommunityReportsLayer';
import { NerMapLayers, NerLayerControls, NerMapLegend, useNerLayers } from '../components/NerLayers';
import { withPane } from '../lib/viewAs';
import { MapTypePicker } from '../authority/map/MapTypePicker';
import { WhyCard } from '../components/WhyCard';
import { ImpactSection } from '../components/ImpactSection';
import { BottomSheet } from '../components/BottomSheet';
import { RiskBadge } from '../components/RiskBadge';
import { LEVELS, LEVEL_RANK } from '../lib/risk';
import { placeName } from '../lib/format';
import { isPreview, type Basemap } from '../lib/mapConfig';
import { useWide } from '../lib/useWide';

// Zones are an officer planning layer (relocation); the citizen map shows levels and roads.
const LAYERS: Record<LayerKey, boolean> = { zones: false, corridors: false, roads: true, reports: false, resources: false, seismic: false };

export default function RiskMapPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { list, locations } = useRiskStream();
  const { viewingId, setViewingId } = useCitizen();
  const [selected, setSelected] = useState<string | null>(viewingId);
  const [roads, setRoads] = useState<Road[]>([]);
  const [basemap, setBasemap] = useState<Basemap['id']>('street');
  const [tick, setTick] = useState(0);
  const wide = useWide();
  const [show, setShow] = useState({ community: true });
  const community = useCommunityReports(show.community);
  const ner = useNerLayers('citizen');

  useEffect(() => { api.get<{ roads: Road[] }>('/roads').then((d) => setRoads(d.roads)).catch(() => {}); }, []);
  useStreamEvent('road_updated', (rd) => setRoads((prev) => prev.map((x) => (x.id === rd.id ? rd : x))));

  const ranked = useMemo(() => [...list].filter((l) => l.risk)
    .sort((a, b) => LEVEL_RANK[b.risk!.level] - LEVEL_RANK[a.risk!.level] || b.risk!.score - a.risk!.score), [list]);
  const loc = selected ? locations[selected] : undefined;

  const pick = (id: string, pan = false) => { setSelected(id); setViewingId(id); if (pan) setTick((n) => n + 1); };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[1.6rem] font-semibold leading-tight">{t('riskmap.title')}</h1>
          <p className="text-muted text-sm">{t('riskmap.sub')}</p>
        </div>
        <Link to={withPane('/citizen/report')} className="btn-secondary !min-h-[40px] text-sm"><Megaphone size={16} aria-hidden />{t('community.report_cta')}</Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="relative isolate h-[56dvh] min-h-[340px] overflow-hidden rounded-card border border-line lg:h-[calc(100dvh-11rem)] lg:min-h-[520px]">
          <WatchMap basemap={basemap} locations={list} horizon={0} activeId={selected} onSelect={(id) => pick(id)}
            layers={LAYERS} roads={roads} reports={[]} resources={[]} corridorColors={{}} focusTick={tick}>
            <NerMapLayers ner={ner} />
            {show.community && <CommunityReportsLayer reports={community} />}
          </WatchMap>
          <NerMapLegend ner={ner} className="absolute bottom-3 left-3" />
          <div className="pointer-events-none absolute right-3 top-3 z-[1100] flex flex-col items-end gap-2">
            <div className="pointer-events-auto"><MapTypePicker iconOnly value={basemap} onChange={setBasemap} /></div>
            <MapPopover label={t('map.layers')} icon={<Layers size={16} aria-hidden />} badge={Object.values(show).filter(Boolean).length + ner.count}
              panelClass="max-h-[calc(56dvh-4rem)] overflow-y-auto overscroll-contain lg:max-h-[calc(100dvh-15rem)]">
              <LayerSwitch label={t('community.layer')} on={show.community} onToggle={() => setShow((x) => ({ ...x, community: !x.community }))} />
              {show.community && <div className="mt-2 px-2"><CommunityLegend count={community.length} /></div>}
              <NerLayerControls ner={ner} />
            </MapPopover>
            <MapPopover label={t('map.legend')} icon={<Info size={16} aria-hidden />}>
              <ul className="space-y-1.5 text-[13px]">
                {LEVELS.map((lv) => (
                  <li key={lv} className="flex items-center gap-2">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-[#EA4335] text-[10px] font-bold text-white" aria-hidden>{PIN_LABEL[lv]}</span>
                    {t(`levels.${lv}`)}
                  </li>
                ))}
              </ul>
              <p className="mt-2 border-t border-[#e1eaec] pt-2 text-[12px] text-[#566d74]">{t('riskmap.legend_note')}</p>
            </MapPopover>
          </div>
          {!loc && (
            <p className="pointer-events-none absolute left-3 top-3 z-[1100] max-w-[calc(100%-4.5rem)] rounded-pill bg-[#0b2a33]/85 px-3 py-1.5 text-xs font-semibold text-[#dcedf0] shadow">
              {t('riskmap.tap_pin')}
            </p>
          )}
        </div>

        {/* Desktop: the Why card beside the map, then the other places, highest risk first. */}
        <aside className="hidden lg:block lg:h-[calc(100dvh-11rem)] lg:min-h-[520px] overflow-y-auto pr-1 space-y-4" aria-label={t('why.title')}>
          {wide && loc && <div key={loc.id} className="drawer-enter"><WhyCard loc={loc} onClose={() => setSelected(null)}><ImpactSection loc={loc} /></WhyCard></div>}
          <PlaceList ranked={ranked} selected={selected} onPick={(id) => pick(id, true)} lang={lang} />
        </aside>
      </div>

      {/* Phone: places list under the map; the Why card in a bottom sheet. */}
      <div className="lg:hidden"><PlaceList ranked={ranked} selected={selected} onPick={(id) => pick(id, true)} lang={lang} /></div>
      {!wide && loc && (
        <BottomSheet key={loc.id} label={t('why.title')} onClose={() => setSelected(null)}
          extra={<a href="tel:112" className="inline-flex min-h-[32px] items-center gap-1 rounded-pill bg-risk-critical px-3 text-xs font-bold text-white" aria-label={t('citizen.call_112')}><Phone size={13} aria-hidden />{t('citizen.sos')}</a>}>
          <WhyCard loc={loc} variant="bare"><ImpactSection loc={loc} /></WhyCard>
        </BottomSheet>
      )}
    </div>
  );
}

function PlaceList({ ranked, selected, onPick, lang }: { ranked: LocationSnap[]; selected: string | null; onPick: (id: string) => void; lang: string }) {
  const { t } = useTranslation();
  return (
    <section className="card p-3" aria-labelledby="rm-places">
      <h2 id="rm-places" className="px-1 pb-2 font-semibold">{t('riskmap.places')}</h2>
      <ul className="divide-y divide-line">
        {ranked.map((l) => (
          <li key={l.id}>
            <button type="button" onClick={() => onPick(l.id)} aria-current={selected === l.id ? 'true' : undefined}
              className={`flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-surface-2 ${selected === l.id ? 'bg-brand/10' : ''}`}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{placeName(l, lang)}</span>
                <span className="block truncate text-xs text-muted">{t(`districts.${l.district}`)}{isPreview(l) ? ` · ${t('preview.badge_plain')}` : ''}</span>
              </span>
              {l.risk && <RiskBadge level={l.risk.level} size="sm" />}
              <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
