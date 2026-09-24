// Authority map: the team's corridor watch console (Google map + live risk stations rail),
// with the location drawer and forecast horizon on top.
import { useTranslation } from 'react-i18next';
import { MapPinned, CloudRain, CloudLightning, AlertTriangle } from 'lucide-react';
import type { AlertItem, Level, LocationSnap } from '../../api/types';
import { useRiskStream } from '../../live/RiskStreamProvider';
import { useLive } from '../useLive';
import { useAuthority } from '../AuthorityContext';
import { WatchMap, levelAt } from './WatchMap';
import { DetailDrawer } from './DetailDrawer';
import { useGoogleConfig } from '../../lib/googleMaps';
import { LEVELS, riskConfig } from '../../lib/risk';
import { placeName } from '../../lib/format';

// Colours from the team's watch map, plus a deeper red for Critical (the portal has three levels).
const DOT: Record<Level, string> = { low: 'bg-[#3f8c70]', moderate: 'bg-[#d9983d]', high: 'bg-[#cf624f]', critical: 'bg-[#9e2a2b]' };
const VALUE: Record<Level, string> = { low: 'text-[#9dd2a6]', moderate: 'text-[#f4c993]', high: 'text-[#f1846d]', critical: 'text-[#ff7a7a]' };
const PILL: Record<Level, string> = {
  low: 'bg-[#2d6143] text-[#b4e1b9]', moderate: 'bg-[#6b512a] text-[#ffd993]', high: 'bg-[#71372f] text-[#ffb4a4]', critical: 'bg-[#5a1d1f] text-[#ff9c9c]',
};

export default function MapPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { list } = useRiskStream();
  const { selectedId, select, horizon, setHorizon } = useAuthority();
  const googleCfg = useGoogleConfig();
  const alerts = useLive<{ alerts: AlertItem[] }>('/alerts', ['alert_published', 'alert_cancelled']);
  const horizons = [0, ...riskConfig.forecastHorizonsHours];
  const online = list.filter((l) => l.risk).length;

  const alertedSince = (l: LocationSnap) => (alerts.data?.alerts || []).some((a) => !a.cancelled_at && a.kind === 'warning' && l.risk && a.created_at >= l.risk.level_since &&
    ((a.target_type === 'location' && a.target_id === l.id) || (a.target_type === 'corridor' && a.target_id === l.corridor_id) || (a.target_type === 'district' && a.target_id === l.district)));

  return (
    <div className="relative flex h-full min-h-0">
      <div className="flex-1 min-w-0 p-3 max-md:p-0 overflow-y-auto">
        <div className="map-console lg:h-full">
          {/* Map */}
          <div className="relative min-h-[440px] overflow-hidden bg-[#dcebdc]">
            <WatchMap locations={list} horizon={horizon} activeId={selectedId} onSelect={select} lang={lang} />
            <div className="absolute left-3 top-14 flex items-center gap-2 rounded-xl border border-white/80 bg-white/90 px-3 py-2 text-[10px] font-bold text-[#315542] shadow-sm backdrop-blur">
              <MapPinned size={13} aria-hidden /> {t('map.watch_title')}
            </div>
            <div className="absolute bottom-4 left-4 flex flex-wrap gap-2 max-w-[70%]">
              {LEVELS.map((lv) => (
                <span key={lv} className="map-legend"><span className={`h-2 w-2 rounded-full ${DOT[lv]}`} aria-hidden /> {t(`levels.${lv}`)}</span>
              ))}
              {googleCfg && !googleCfg.api_key && <span className="map-legend !text-[#a8681f]">{t('map.google_key_missing')}</span>}
            </div>
          </div>

          {/* Live risk stations */}
          <aside className="map-rail flex flex-col min-h-0" aria-labelledby="stations-title">
            <div className="flex items-start justify-between border-b border-white/10 pb-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#819488]">{t('map.region')}</p>
                <h2 id="stations-title" className="mt-1 text-xl font-semibold text-white">{t('map.stations')}</h2>
              </div>
              <span className="rounded-full bg-[#2a5d43] px-2 py-1 text-[9px] font-bold text-[#d7efd8]">{t('map.online', { count: online })}</span>
            </div>

            <div role="radiogroup" aria-label={t('map.time')} className="mt-3 flex items-center gap-1 rounded-xl bg-white/5 p-1">
              {horizons.map((h) => (
                <button key={h} type="button" role="radio" aria-checked={horizon === h} onClick={() => setHorizon(h)}
                  className={`flex-1 rounded-lg px-1.5 py-1 text-[11px] font-bold font-mono ${horizon === h ? 'bg-[#2a5d43] text-[#d7efd8]' : 'text-[#91a297] hover:text-white'}`}>
                  {h === 0 ? t('map.now') : t('map.plus_h', { h })}
                </button>
              ))}
            </div>
            {horizon > 0 && <p className="mt-1 text-[10px] text-[#91a297]" role="status">{t('map.forecast_note', { h: horizon })}</p>}

            <div className="mt-3 overflow-y-auto pr-1 max-lg:max-h-[420px] lg:flex-1 lg:min-h-0">
              {list.map((l) => {
                const lv = levelAt(l, horizon);
                if (!lv) return null;
                const rain = l.risk?.conditions?.rain_24h;
                const live = l.risk?.conditions?.data_source === 'open-meteo';
                const noAlert = horizon === 0 && lv === 'critical' && !alertedSince(l);
                return (
                  <button key={l.id} type="button" onClick={() => select(l.id)} aria-pressed={selectedId === l.id}
                    className={`map-table-row ${selectedId === l.id ? 'active' : ''}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-bold text-[#f4f7f3]">{placeName(l, lang)}</span>
                      <span className="mt-1 block text-[10px] text-[#85998b]">
                        {t(`districts.${l.district}`)} · {live ? t('map.rain_live') : t('map.refreshing')}
                      </span>
                      {noAlert && <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-[#ff9c9c]"><AlertTriangle size={11} aria-hidden />{t('map.critical_no_alert')}</span>}
                    </span>
                    <span className="text-right">
                      <span className={`block text-xs font-bold ${VALUE[lv]}`}>{typeof rain === 'number' ? rain.toFixed(1) : '–'}</span>
                      <span className="text-[9px] text-[#7f9284]">{t('map.mm24')}</span>
                    </span>
                    <span className={`ml-3 rounded-full px-2 py-1 text-[9px] font-bold ${PILL[lv]}`}>{t(`levels.${lv}`)}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 border-t border-white/10 pt-4 text-[10px] leading-5 text-[#91a297]">
              <div className="flex items-center gap-2"><CloudRain size={13} className="text-[#9dc6a5]" aria-hidden /> {t('map.src_rain')}</div>
              <div className="mt-1 flex items-center gap-2"><CloudLightning size={13} className="text-[#9dc6a5]" aria-hidden /> {t('map.src_imd')}</div>
            </div>
          </aside>
        </div>
      </div>

      {/* Right detail drawer */}
      {selectedId && (
        <div className="w-[400px] max-w-full shrink-0 bg-surface border-l border-line z-[650] max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:shadow-2xl" lang={lang}>
          <DetailDrawer id={selectedId} onClose={() => select(null)} />
        </div>
      )}
    </div>
  );
}
