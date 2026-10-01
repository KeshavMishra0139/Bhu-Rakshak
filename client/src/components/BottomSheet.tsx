// Mobile bottom sheet that sits above the bottom navigation. It opens at a short "peek" height and expands to most
// of the screen when the handle is tapped or dragged up; dragging down collapses it, and again closes it. It is not
// modal, so the map behind stays usable. It covers the floating buttons, so pages pass their emergency call link as
// `extra` to keep it one tap away. Rendered into <body> so the
// page's entrance animation (a transform) cannot pin it to the page instead of the screen.
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

type Props = { label: string; onClose: () => void; children: ReactNode; extra?: ReactNode; className?: string; peekHeight?: number };

export function BottomSheet({ label, onClose, children, extra, className = '', peekHeight = 210 }: Props) {
  const { t } = useTranslation();
  const [full, setFull] = useState(false);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const moved = useRef(false);

  const onDown = (e: React.PointerEvent) => { start.current = e.clientY; moved.current = false; (e.target as Element).setPointerCapture?.(e.pointerId); };
  const onMove = (e: React.PointerEvent) => {
    if (start.current == null) return;
    const dy = e.clientY - start.current;
    if (Math.abs(dy) > 6) moved.current = true;
    setDrag(dy);
  };
  const onUp = () => {
    if (start.current == null) return;
    const dy = drag;
    start.current = null;
    setDrag(0);
    if (!moved.current) { setFull((v) => !v); return; }
    if (dy < -40) setFull(true);
    else if (dy > 40) { if (full) setFull(false); else onClose(); }
  };

  const height = full ? 'min(78dvh, 680px)' : `${peekHeight}px`;
  return createPortal(
    <section role="region" aria-label={label}
      className={`sheet-enter fixed inset-x-0 z-[45] flex flex-col rounded-t-3xl border-t border-line bg-surface shadow-[0_-8px_30px_rgb(0_0_0/0.18)] bottom-[calc(60px+env(safe-area-inset-bottom,0px))] md:bottom-0 ${className}`}
      style={{ height, transform: drag ? `translateY(${Math.max(-120, drag)}px)` : undefined, transition: drag ? 'none' : 'height 260ms cubic-bezier(0.23,1,0.32,1), transform 200ms ease-out' }}>
      <div className="relative shrink-0 touch-none select-none pt-2 pb-1" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <button type="button" className="mx-auto block h-6 w-24 rounded-full" aria-expanded={full} aria-label={full ? t('sheet.collapse') : t('sheet.expand')}
          onClick={(e) => { if (e.detail === 0) setFull((v) => !v); }}>
          <span className="mx-auto block h-1.5 w-12 rounded-full bg-line" aria-hidden />
        </button>
        {extra && <div className="absolute left-3 top-1.5" onPointerDown={(e) => e.stopPropagation()}>{extra}</div>}
        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={onClose} className="absolute right-3 top-1.5 p-2 text-muted hover:text-ink" aria-label={t('common.close')}>
          <X size={18} aria-hidden />
        </button>
      </div>
      <div className={`min-h-0 flex-1 px-3 pb-4 ${full ? 'overflow-y-auto overscroll-contain' : 'overflow-hidden'}`} onClick={() => { if (!full) setFull(true); }}>{children}</div>
    </section>,
    document.body,
  );
}
