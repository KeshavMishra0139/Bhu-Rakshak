// Google Maps loading, shared by every map in the app.
// The browser key comes from the server (/api/map/google, set by GOOGLE_MAPS_API_KEY) so it can change
// without a rebuild. `region=IN` makes Google draw India's boundaries as required under Indian law.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { APIProvider, AdvancedMarker, AdvancedMarkerAnchorPoint, ColorScheme } from '@vis.gl/react-google-maps';
import { useTheme } from '../theme/ThemeProvider';
import type { Level } from '../api/types';

export type GoogleConfig = { api_key: string | null; map_id: string };

let cached: GoogleConfig | null = null;
let pending: Promise<GoogleConfig> | null = null;
// The Maps API can only be loaded once per page, so the first language wins for this page load.
let loadLanguage: string | null = null;

export function loadGoogleConfig(): Promise<GoogleConfig> {
  pending ??= fetch('/api/map/google', { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .catch(() => ({ api_key: null, map_id: 'DEMO_MAP_ID' }))
    .then((c: GoogleConfig) => (cached = c));
  return pending;
}

export function useGoogleConfig() {
  const [cfg, setCfg] = useState<GoogleConfig | null>(cached);
  useEffect(() => { if (!cfg) loadGoogleConfig().then(setCfg); }, [cfg]);
  return cfg;
}

/** Loads the Maps JavaScript API around one map. Shows a quiet placeholder until the key is known. */
export function GoogleMapsFrame({ children, className = 'h-full w-full' }: { children: (cfg: GoogleConfig) => ReactNode; className?: string }) {
  const cfg = useGoogleConfig();
  const { i18n } = useTranslation();
  if (!cfg) return <div className={`${className} bg-surface-2 animate-pulse`} />;
  loadLanguage ??= i18n.language === 'hi' ? 'hi' : 'en';
  return (
    <APIProvider apiKey={cfg.api_key || ''} region="IN" language={loadLanguage}>
      {children(cfg)}
    </APIProvider>
  );
}

export function useMapColorScheme() {
  const { resolved } = useTheme();
  return resolved === 'dark' ? ColorScheme.DARK : ColorScheme.LIGHT;
}

/**
 * Risk colours as plain rgb() strings for Google's canvas-drawn shapes (polylines can't read CSS variables).
 * HTML markers can keep using levelVar().
 */
export function useLevelColor() {
  const { resolved } = useTheme();
  return useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    return (l: Level) => `rgb(${css.getPropertyValue(`--risk-${l}`).trim().split(/\s+/).join(',')})`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);
}

type DotProps = {
  position: google.maps.LatLngLiteral;
  /** Radius in pixels. */
  radius: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  dashed?: boolean;
  className?: string;
  label?: ReactNode;
  title?: string;
  zIndex?: number;
  onClick?: () => void;
};

/** A circle of fixed pixel size (like a map pin dot), with an optional hover label. */
export function MapDot({ position, radius, fill, stroke = 'transparent', strokeWidth = 0, opacity = 1, dashed, className = '', label, title, zIndex, onClick }: DotProps) {
  const size = radius * 2;
  return (
    <AdvancedMarker position={position} anchorPoint={AdvancedMarkerAnchorPoint.CENTER} zIndex={zIndex} title={title}
      clickable={!!onClick} onClick={onClick}>
      <div className={`gm-dot ${onClick || label ? '' : 'pointer-events-none'}`}>
        <span className={`block rounded-full ${className}`} aria-hidden
          style={{ width: size, height: size, background: fill, opacity, border: strokeWidth ? `${strokeWidth}px ${dashed ? 'dashed' : 'solid'} ${stroke}` : undefined, boxSizing: 'border-box' }} />
        {label && <span className="gm-tip">{label}</span>}
      </div>
    </AdvancedMarker>
  );
}
