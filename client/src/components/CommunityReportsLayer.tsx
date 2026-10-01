// Map layer of community warning signs (citizen reports): an icon per sign and a corner badge — green tick when an
// officer has verified it, orange "?" (and a dashed ring) while it is unverified. Data is anonymised by the server.
import { useCallback, useEffect, useState } from 'react';
import L from 'leaflet';
import { Marker, Tooltip } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useStreamEvent } from '../live/RiskStreamProvider';
import { dateTimeIST, isDeva } from '../lib/format';

export type CommunityReport = {
  id: string; type: string; lat: number; lng: number; verified: boolean; created_at: string; verified_at: string | null;
  has_photo: boolean; place: { id: string; name_en: string; name_hi: string } | null;
};

// Simple line glyphs (24×24) per sign.
const GLYPH: Record<string, string> = {
  crack: '<path d="M13 2 9 9l5 3-4 10"/>',
  water_seepage: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  tilting: '<path d="M8 21 16 4"/><path d="M4 21h9"/>',
  rockfall: '<circle cx="8" cy="15" r="3"/><circle cx="16.5" cy="17" r="2.5"/><circle cx="14" cy="7.5" r="2"/>',
  debris: '<path d="M3 19h18"/><path d="m5 19 4-7 3 3 4-8 3 12"/>',
  road_damage: '<path d="M6 21 9 3"/><path d="M18 21 15 3"/><path d="M12 6v2M12 11v2M12 16v2"/>',
  other: '<path d="M12 7v6"/><path d="M12 17h.01"/>',
};
export const SIGN_COLOR: Record<string, string> = {
  crack: '#b9844f', water_seepage: '#2f8fa3', tilting: '#6f8a3a', rockfall: '#7a6a5a', debris: '#9c6b3a', road_damage: '#5f6670', other: '#5d7364',
};

const iconCache = new Map<string, L.DivIcon>();
export function signIcon(type: string, verified: boolean) {
  const key = `${type}|${verified}`;
  let icon = iconCache.get(key);
  if (!icon) {
    const color = SIGN_COLOR[type] || SIGN_COLOR.other;
    icon = L.divIcon({
      className: '',
      iconSize: [26, 26], iconAnchor: [13, 13], tooltipAnchor: [0, -14],
      html: `<span class="cr-pin ${verified ? 'is-verified' : 'is-unverified'}" style="--c:${color}"><svg viewBox="0 0 24 24" aria-hidden="true">${GLYPH[type] || GLYPH.other}</svg><i aria-hidden="true">${verified ? '✓' : '?'}</i></span>`,
    });
    iconCache.set(key, icon);
  }
  return icon;
}

/** Recent community reports, refreshed every 2 minutes and when a report changes. */
export function useCommunityReports(enabled: boolean) {
  const [reports, setReports] = useState<CommunityReport[]>([]);
  const load = useCallback(() => { api.get<{ reports: CommunityReport[] }>('/community-reports').then((d) => setReports(d.reports)).catch(() => {}); }, []);
  useEffect(() => {
    if (!enabled) return;
    load();
    const id = setInterval(load, 120000);
    return () => clearInterval(id);
  }, [enabled, load]);
  useStreamEvent('report_updated', () => { if (enabled) load(); });
  return reports;
}

export function CommunityReportsLayer({ reports }: { reports: CommunityReport[] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  return (
    <>
      {reports.map((r) => (
        <Marker key={r.id} position={[r.lat, r.lng]} icon={signIcon(r.type, r.verified)} keyboard={false} zIndexOffset={-100}
          alt={`${t(`reports.ty_${r.type}`)}: ${r.verified ? t('community.verified') : t('community.unverified')}`}>
          <Tooltip direction="top">
            <strong>{t(`reports.ty_${r.type}`)}</strong>
            <br />
            <span style={{ color: r.verified ? '#2F8F4E' : '#B8601A', fontWeight: 700 }}>{r.verified ? `✓ ${t('community.verified')}` : `? ${t('community.unverified')}`}</span>
            {' · '}{dateTimeIST(r.created_at, lang)}
            {r.place && <><br />{t('community.near', { place: isDeva(lang) ? r.place.name_hi : r.place.name_en })}</>}
          </Tooltip>
        </Marker>
      ))}
    </>
  );
}

/** Legend for the layer (inside a map popover): the four warning signs, the badges, and where the data comes from. */
export function CommunityLegend({ count }: { count: number }) {
  const { t } = useTranslation();
  const types = ['crack', 'water_seepage', 'tilting', 'rockfall'];
  return (
    <div className="text-[12px]">
      <ul className="space-y-1">
        {types.map((ty) => (
          <li key={ty} className="flex items-center gap-2 leading-tight">
            <span className="shrink-0 scale-[0.85]" dangerouslySetInnerHTML={{ __html: (signIcon(ty, true).options.html as string).replace('<i aria-hidden="true">✓</i>', '') }} />
            {t(`reports.ty_${ty}`)}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-[#e3ece4] pt-2 font-semibold">
        <span className="inline-flex items-center gap-1"><span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-[#2F8F4E] text-[9px] text-white" aria-hidden>✓</span>{t('community.verified')}</span>
        <span className="inline-flex items-center gap-1"><span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-[#D9731A] text-[9px] text-white" aria-hidden>?</span>{t('community.unverified')}</span>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-[#5d7364]">{t('community.legend_note', { count })}</p>
    </div>
  );
}
