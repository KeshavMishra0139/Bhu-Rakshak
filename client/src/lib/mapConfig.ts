// Every map source in one place. None needs an API key or billing.
// - Maps (Leaflet): Esri World Imagery (hybrid and satellite), Esri World Street Map / Dark Gray (street),
//   Esri World Topographic Map (topo), OpenTopoMap (terrain). CARTO's basemaps now require an API key, so they are
//   not used. Mappls (MapmyIndia) also needs an account key, so it is not wired in.
// - In-person view: Google Street View through Google's standard "Embed a map" iframe (no key).
// Credits are on the About page and in Leaflet's attribution line, as the tile licences require.
type Theme = 'light' | 'dark';
/**
 * nativeZoom: the deepest zoom where the source has real tiles over Sikkim (checked tile by tile; beyond it Esri
 * serves "Map data not yet available"). Leaflet enlarges those tiles for closer zooms instead of asking for more.
 */
export type Overlay = { url: string; subdomains?: string; nativeZoom?: number };
export type Basemap = {
  id: 'hybrid' | 'satellite' | 'street' | 'topo' | 'terrain';
  url: string | ((theme: Theme) => string);
  /** Overlays drawn on top (road network and place names), optionally per theme. */
  overlays?: Overlay[] | ((theme: Theme) => Overlay[]);
  attribution: string;
  maxZoom: number;
  nativeZoom: number | ((theme: Theme) => number);
  subdomains?: string;
};

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const IMAGERY = `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`;
const IMAGERY_CREDIT = 'Imagery © Esri, Maxar, Earthstar Geographics';

export const BASEMAPS: Basemap[] = [
  {
    // Satellite imagery with the road network and place names on top.
    id: 'hybrid',
    url: IMAGERY,
    overlays: [
      { url: `${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, nativeZoom: 19 },
      { url: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, nativeZoom: 17 },
    ],
    attribution: `${IMAGERY_CREDIT} | Roads and places © Esri`,
    maxZoom: 19,
    nativeZoom: 18,
  },
  {
    // Imagery only: best for spotting fresh scars, debris and river changes.
    id: 'satellite',
    url: IMAGERY,
    attribution: IMAGERY_CREDIT,
    maxZoom: 19,
    nativeZoom: 18,
  },
  {
    id: 'street',
    url: (theme) => (theme === 'dark'
      ? `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`
      : `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`),
    overlays: (theme) => (theme === 'dark' ? [{ url: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, nativeZoom: 16 }] : []),
    attribution: 'Map © Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community',
    maxZoom: 19,
    nativeZoom: (theme) => (theme === 'dark' ? 16 : 17),
  },
  {
    // Contours, hill shading and trails.
    id: 'topo',
    url: `${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`,
    attribution: 'Map © Esri, HERE, Garmin, FAO, NOAA, USGS, © OpenStreetMap contributors, and the GIS user community',
    maxZoom: 19,
    nativeZoom: 17,
  },
  {
    // Relief shading with contour lines, from OpenStreetMap and SRTM elevation.
    id: 'terrain',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors, SRTM | Style © OpenTopoMap (CC-BY-SA)',
    maxZoom: 19,
    nativeZoom: 17,
    subdomains: 'abc',
  },
];

export const basemapUrl = (b: Basemap, theme: Theme) => (typeof b.url === 'function' ? b.url(theme) : b.url);
export const basemapNativeZoom = (b: Basemap, theme: Theme) => (typeof b.nativeZoom === 'function' ? b.nativeZoom(theme) : b.nativeZoom);
export const basemapOverlays = (b: Basemap, theme: Theme): Overlay[] => (typeof b.overlays === 'function' ? b.overlays(theme) : b.overlays || []);

/** One tile over Gangtok (zoom 10) for the map-type picker's preview thumbnails. */
const THUMB = { z: 10, x: 764, y: 431 };
export const tileThumb = (url: string) => url.replace('{z}', String(THUMB.z)).replace('{x}', String(THUMB.x)).replace('{y}', String(THUMB.y))
  .replace('{s}', 'a').replace('{r}', '');

/** Sikkim and surroundings. */
export const MAP_BOUNDS: [[number, number], [number, number]] = [[26.45, 87.6], [28.3, 89.25]];
export const MAP_CENTER: [number, number] = [27.33, 88.5];
/**
 * Pan limits for the full-size authority map. Leaflet re-centres any view that is wider than its max bounds,
 * so the tight region box above would block all panning on wide screens at the default zoom. This box is loose
 * enough for normal screens at zoom 9 while still keeping officers near Sikkim.
 */
export const WATCH_BOUNDS: [[number, number], [number, number]] = [[24.5, 85.0], [30.0, 92.0]];
export const MAP_MIN_ZOOM = 8;
export const OFFICIAL_BOUNDARY_URL = '/geo/india_boundary.geojson';

/**
 * Google Street View for a point, as Google's own "Embed a map" iframe (free, no key).
 * Shows the panorama at that spot, or Google's "No Street View available" message.
 */
export const streetViewEmbedUrl = (lat: number, lng: number, heading = 0) =>
  `https://www.google.com/maps/embed?pb=!6m6!1m5!2m2!1d${lat.toFixed(6)}!2d${lng.toFixed(6)}!3f${Math.round(heading)}!5f0.8`;

/** Official Google Maps URL that opens Street View at (or near) a point in a new tab. */
export const streetViewLink = (lat: number, lng: number) =>
  `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lng.toFixed(6)}`;
