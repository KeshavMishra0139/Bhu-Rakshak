// Map settings in one place. All maps use Google Maps (see lib/googleMaps.tsx); credits are on the About page,
// and Google's own attribution stays on every map as its terms require.
export type Basemap = {
  id: 'satellite' | 'terrain' | 'street';
  /** Google map type. "hybrid" is satellite imagery with Google's labels and roads. */
  mapTypeId: 'hybrid' | 'terrain' | 'roadmap';
};

export const BASEMAPS: Basemap[] = [
  { id: 'satellite', mapTypeId: 'hybrid' },
  { id: 'terrain', mapTypeId: 'terrain' },
  { id: 'street', mapTypeId: 'roadmap' },
];

/** Sikkim and surroundings. */
export const MAP_BOUNDS = { south: 26.45, west: 87.6, north: 28.3, east: 89.25 };
export const MAP_CENTER = { lat: 27.33, lng: 88.5 };
export const MAP_MIN_ZOOM = 8;
export const OFFICIAL_BOUNDARY_URL = '/geo/india_boundary.geojson';

export const toLatLng = ([lat, lng]: [number, number]) => ({ lat, lng });
