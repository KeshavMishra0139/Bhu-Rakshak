// The animated Bhu-Rakshak shield. Markup comes from client/src/brand/shield.ts (one source for the app, the loader,
// the favicon and the app icons); motion from client/src/brand/shield.css.
import { useId, useMemo } from 'react';
import { shieldInner, SHIELD_VIEWBOX, type ShieldVariant } from '../brand/shield';

export type ShieldMotion = 'none' | 'intro' | 'loading' | 'alert' | 'hover';
const MOTION_CLASS: Record<ShieldMotion, string> = { none: '', intro: 'bm-intro', loading: 'bm-intro bm-loop', alert: 'bm-alert', hover: 'bm-hover' };

export function BrandShield({ variant = 'mark', motion = 'none', size, className = '', title }: {
  variant?: ShieldVariant; motion?: ShieldMotion; size?: number; className?: string; title?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const inner = useMemo(() => shieldInner(variant, `bm${uid}`), [variant, uid]);
  return (
    <svg viewBox={SHIELD_VIEWBOX[variant]} width={size} className={`bm ${MOTION_CLASS[motion]} ${className}`}
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}
      dangerouslySetInnerHTML={{ __html: inner }} />
  );
}
