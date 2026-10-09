// "Map type" picker: Hybrid, Satellite, Street, Topographic or Terrain, each with a live preview tile of Gangtok.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Globe, Layers3 } from 'lucide-react';
import { useTheme } from '../../theme/ThemeProvider';
import { BASEMAPS, basemapOverlays, basemapUrl, tileThumb, type Basemap } from '../../lib/mapConfig';

export function MapTypePicker({ value, onChange, iconOnly = false }: { value: Basemap['id']; onChange: (id: Basemap['id']) => void; iconOnly?: boolean }) {
  const { t } = useTranslation();
  const { resolved } = useTheme();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={box} className="pointer-events-auto relative">
      {iconOnly ? (
        <button ref={button} type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="true"
          aria-label={`${t('map.map_type')}: ${t(`map.${value}`)}`} title={`${t('map.map_type')}: ${t(`map.${value}`)}`}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/80 bg-white/95 text-[#1f4a55] shadow-sm backdrop-blur transition hover:bg-[#e4eff1] active:scale-95 ${open ? '!bg-[#1b5f6c] !text-[#dcedf0] !border-[#1b5f6c]' : ''}`}>
          <Globe size={16} aria-hidden />
        </button>
      ) : (
        <button ref={button} type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="true"
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-white/80 bg-white/95 px-3 text-[11px] font-bold text-[#1f4a55] shadow-sm backdrop-blur hover:bg-[#e4eff1]">
          <Layers3 size={14} aria-hidden />
          <span className="sr-only">{t('map.map_type')}: </span>{t(`map.${value}`)}
          <ChevronDown size={13} aria-hidden className={open ? 'rotate-180' : ''} />
        </button>
      )}
      {open && (
        <div className={`pop-enter absolute w-[292px] rounded-2xl border border-[#d5e2e5] bg-white p-3 shadow-xl ${iconOnly ? 'right-full top-0 mr-2 origin-top-right' : 'right-0 top-[calc(100%+6px)]'}`}>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#6f858b]">{t('map.map_type')}</p>
          <div role="radiogroup" aria-label={t('map.map_type')} className="grid grid-cols-3 gap-2">
            {BASEMAPS.map((b) => {
              const selected = b.id === value;
              return (
                <button key={b.id} type="button" role="radio" aria-checked={selected} onClick={() => { onChange(b.id); setOpen(false); button.current?.focus(); }}
                  className={`group rounded-xl p-1 text-center ${selected ? 'bg-[#e4eff1] ring-2 ring-[#0f5e6e]' : 'hover:bg-[#f1f6f7]'}`}>
                  <span className="relative block h-[62px] overflow-hidden rounded-lg bg-[#dbe7ea]">
                    <img src={tileThumb(basemapUrl(b, resolved))} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                    {basemapOverlays(b, resolved).map((o) => <img key={o.url} src={tileThumb(o.url)} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />)}
                    {selected && <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-[#0f5e6e] text-white"><Check size={12} aria-hidden /></span>}
                  </span>
                  <span className="mt-1 block text-[11px] font-bold text-[#0b2a33]">{t(`map.${b.id}`)}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] leading-4 text-[#5f747a]">{t(`map.${value}_hint`)}</p>
        </div>
      )}
    </div>
  );
}
