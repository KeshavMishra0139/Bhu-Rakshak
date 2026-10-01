// Compact map controls: round icon buttons with tooltips, and small pop-out panels (layers, legend), so the map
// itself stays clear. Every button has an accessible name; panels close on outside click or Escape.
import { useEffect, useRef, useState, type ReactNode } from 'react';

const BTN = 'pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/80 bg-white/95 text-[#315542] shadow-sm backdrop-blur transition hover:bg-[#e8f3ed] active:scale-95';
const BTN_ON = '!bg-[#2a5d43] !text-[#d7efd8] !border-[#2a5d43]';

export function MapIconButton({ label, onClick, active = false, children, expanded }: {
  label: string; onClick: () => void; active?: boolean; children: ReactNode; expanded?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} aria-expanded={expanded} className={`${BTN} ${active ? BTN_ON : ''}`}>
      {children}
    </button>
  );
}

/** Icon button that opens a small panel beside it (to the left, since controls sit on the right edge). */
export function MapPopover({ label, icon, children, badge, panelClass = '' }: { label: string; icon: ReactNode; children: ReactNode; badge?: number; panelClass?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div ref={box} className="pointer-events-auto relative">
      <MapIconButton label={label} onClick={() => setOpen((v) => !v)} active={open} expanded={open}>
        {icon}
        {!!badge && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#2a5d43] px-1 text-[9px] font-bold text-white">{badge}</span>}
      </MapIconButton>
      {open && (
        <div role="dialog" aria-label={label} className={`pop-enter origin-top-right absolute right-full top-0 mr-2 w-60 rounded-2xl border border-[#d9e5da] bg-white p-3 text-[#17392b] shadow-xl ${panelClass}`}>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#7a8d80]">{label}</p>
          {children}
        </div>
      )}
    </div>
  );
}

/** A switch row inside a panel. */
export function LayerSwitch({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onToggle}
      className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] font-semibold hover:bg-[#f3f7f1]">
      <span>{label}</span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-[#2d765b]' : 'bg-[#cfdccf]'}`} aria-hidden>
        <span className={`absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </span>
    </button>
  );
}
