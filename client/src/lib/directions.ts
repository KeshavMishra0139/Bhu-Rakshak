// Google Maps directions links (official "Maps URLs": no key, open the Google Maps app on phones).
// https://developers.google.com/maps/documentation/urls/get-started#directions-action

type Point = { lat: number; lng: number };
type Stop = Point | string;

/** At most `max` items, always keeping the first and last. */
export function thin<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return Array.from({ length: max }, (_, i) => items[Math.round((i * (items.length - 1)) / (max - 1))]);
}

const stop = (s: Stop) => (typeof s === 'string' ? s : `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`);

/**
 * Driving directions from origin (or the person's current location if omitted) to destination, via waypoints.
 * `navigate` starts turn-by-turn navigation straight away; Google only does that from the current location,
 * so it is used without an origin (with an origin it shows a route preview instead).
 */
export function googleDirectionsUrl({ origin, destination, waypoints = [], navigate = false }: { origin?: Stop; destination: Stop; waypoints?: Stop[]; navigate?: boolean }) {
  const p = new URLSearchParams({ api: '1', destination: stop(destination), travelmode: 'driving' });
  if (origin) p.set('origin', stop(origin));
  // Phone browsers accept at most 3 waypoints: keep the first and last, and spread the rest evenly.
  const via = navigate ? thin(waypoints, 3) : waypoints;
  if (via.length) p.set('waypoints', via.map(stop).join('|'));
  if (navigate) p.set('dir_action', 'navigate');
  return `https://www.google.com/maps/dir/?${p.toString()}`;
}

/**
 * Places named in an officer's diversion note, e.g. "Via Kalimpong – Lava – Gorubathan (NH-717A)"
 * → ["Kalimpong", "Lava", "Gorubathan"]. Anything that doesn't start with "Via" (such as "No alternative road")
 * gives no places, so no alternate route is offered.
 */
export function diversionPlaces(text: string | null | undefined): string[] {
  const m = /^\s*via\s+(.+?)\s*(\(.*\))?\s*\.?\s*$/i.exec(text || '');
  if (!m) return [];
  return m[1].split(/\s*(?:–|—|-|,|→|>)\s*/).map((s) => s.trim()).filter((s) => s.length > 1);
}
