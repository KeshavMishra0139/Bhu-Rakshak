// Every map source in one place, so providers can be swapped without touching components.
// Credits for these sources are shown on the About page only (and in Leaflet's small attribution line,
// which tile licences require).
export type Basemap = {
  id: 'satellite' | 'terrain' | 'street' | 'mappls';
  url: string | ((theme: 'light' | 'dark') => string);
  labelsUrl?: string;
  attribution: string;
  maxZoom: number;
  subdomains?: string;
};

export const BASEMAPS: Basemap[] = [
  {
    id: 'satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    // Labels-only layer (light text for dark imagery); boundaries come from our own official overlay.
    labelsUrl: 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png',
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics | Labels © CARTO, © OpenStreetMap contributors',
    maxZoom: 18,
    subdomains: 'abcd',
  },
  {
    id: 'terrain',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors, SRTM | Style © OpenTopoMap (CC-BY-SA)',
    maxZoom: 16,
    subdomains: 'abc',
  },
  {
    id: 'street',
    url: (theme) => (theme === 'dark'
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'),
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 18,
    subdomains: 'abcd',
  },
];

/** Sikkim and surroundings. */
export const MAP_BOUNDS: [[number, number], [number, number]] = [[26.45, 87.6], [28.3, 89.25]];
export const MAP_CENTER: [number, number] = [27.33, 88.5];
export const MAP_MIN_ZOOM = 8;
export const OFFICIAL_BOUNDARY_URL = '/geo/india_boundary.geojson';
/** Tile errors within this window before falling back to the next basemap. */
export const TILE_ERROR_LIMIT = 12;
