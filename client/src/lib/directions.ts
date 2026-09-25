// Google Maps directions links (official "Maps URLs": no key, open the Google Maps app on phones).
// https://developers.google.com/maps/documentation/urls/get-started#directions-action

type Point = { lat: number; lng: number };
type Stop = Point | string;

const stop = (s: Stop) => (typeof s === 'string' ? s : `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`);

/** Driving directions from origin (or the person's current location if omitted) to destination, via waypoints. */
export function googleDirectionsUrl({ origin, destination, waypoints = [] }: { origin?: Stop; destination: Stop; waypoints?: Stop[] }) {
  const p = new URLSearchParams({ api: '1', destination: stop(destination), travelmode: 'driving' });
  if (origin) p.set('origin', stop(origin));
  if (waypoints.length) p.set('waypoints', waypoints.map(stop).join('|'));
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
