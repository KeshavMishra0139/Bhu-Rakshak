// Every map source in one place. None needs an API key or billing.
// - Maps: Esri World Imagery (satellite), Esri World Street Map / Dark Gray (street), OpenTopoMap (terrain), drawn with Leaflet.
//   (CARTO's basemaps now require an API key, so they are not used.)
// - In-person view: Google Street View through Google's standard "Embed a map" iframe (no key).
// Credits are on the About page and in Leaflet's attribution line, as the tile licences require.
type Theme = 'light' | 'dark';
export type Overlay = { url: string; subdomains?: string };
export type Basemap = {
  id: 'satellite' | 'street' | 'terrain';
  url: string | ((theme: Theme) => string);
  /** Overlays drawn on top (road network and place names), optionally per theme. */
  overlays?: Overlay[] | ((theme: Theme) => Overlay[]);
  attribution: string;
  maxZoom: number;
  subdomains?: string;
};

export const BASEMAPS: Basemap[] = [
  {
    id: 'satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    overlays: [
      { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}' },
      { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}' },
    ],
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics | Roads and places © Esri',
    maxZoom: 19,
  },
  {
    id: 'street',
    url: (theme) => (theme === 'dark'
      ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
      : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'),
    overlays: (theme) => (theme === 'dark'
      ? [{ url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}' }]
      : []),
    attribution: 'Map © Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community',
    maxZoom: 16,
  },
  {
    id: 'terrain',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors, SRTM | Style © OpenTopoMap (CC-BY-SA)',
    maxZoom: 17,
    subdomains: 'abc',
  },
];

export const basemapUrl = (b: Basemap, theme: Theme) => (typeof b.url === 'function' ? b.url(theme) : b.url);
export const basemapOverlays = (b: Basemap, theme: Theme): Overlay[] => (typeof b.overlays === 'function' ? b.overlays(theme) : b.overlays || []);

/** Sikkim and surroundings. */
export const MAP_BOUNDS: [[number, number], [number, number]] = [[26.45, 87.6], [28.3, 89.25]];
export const MAP_CENTER: [number, number] = [27.33, 88.5];
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
