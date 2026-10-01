// North East map layers: real cumulative rainfall (server grid from Open-Meteo) and file-based layers listed in
// /data/layers/layers.json (jhum burn scars, road-cutting zones, InSAR ground movement). Layers marked `sample` are
// placeholder shapes and are always labelled as SAMPLE DATA.
import { api } from '../api/client';

export type RainPeriod = 3 | 7 | 15;
export type RainGrid = { fetched_at: string; through: string; step: number; cells: [number, number, number, number, number][]; source: string };
export type FileLayerId = 'jhum' | 'roadcut' | 'insar';
export type LayerMeta = { id: FileLayerId; file: string; sample: boolean; source: string };
// Minimal GeoJSON shape the app reads.
export type Feature = { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } };
export type FeatureCollection = { type: 'FeatureCollection'; sample?: boolean; features: Feature[] };

export const fetchRainGrid = () => api.get<RainGrid>('/layers/rain');

let manifest: Promise<LayerMeta[]> | null = null;
export function fetchManifest() {
  manifest ??= fetch('/data/layers/layers.json').then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then((d) => d.layers as LayerMeta[]);
  manifest.catch(() => { manifest = null; });
  return manifest;
}
const files = new Map<string, Promise<FeatureCollection>>();
export function fetchLayerFile(file: string) {
  let p = files.get(file);
  if (!p) {
    p = fetch(`/data/layers/${file}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
    p.catch(() => files.delete(file));
    files.set(file, p);
  }
  return p;
}

/** Rain classes per window: thresholds in mm and one colour per class (light → dark). */
export const RAIN_BINS: Record<RainPeriod, number[]> = { 3: [10, 25, 50, 100, 200], 7: [25, 50, 100, 200, 400], 15: [50, 100, 200, 400, 800] };
export const RAIN_COLORS = ['#e3f1fb', '#9ecae1', '#4b9fd5', '#2171b5', '#6a51a3', '#3f007d'];
export const rainColor = (mm: number, period: RainPeriod) => {
  const bins = RAIN_BINS[period];
  let k = 0;
  while (k < bins.length && mm >= bins[k]) k++;
  return RAIN_COLORS[k];
};

/** InSAR velocity classes (mm/yr, line of sight): strongly moving away → stable → moving towards. */
export const INSAR_CLASSES: { max: number; color: string; key: string }[] = [
  { max: -20, color: '#b2182b', key: 'insar_fast' },
  { max: -10, color: '#ef8a62', key: 'insar_moving' },
  { max: -3, color: '#fddbc7', key: 'insar_slow' },
  { max: 3, color: '#e6e6e6', key: 'insar_stable' },
  { max: Infinity, color: '#67a9cf', key: 'insar_up' },
];
export const insarColor = (v: number) => INSAR_CLASSES.find((c) => v <= c.max)!.color;
export const JHUM_COLOR = '#e4572e';
export const ROADCUT_COLOR = '#ff9f1c';
