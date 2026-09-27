// The experimental model's track record: its logged predictions (ml_predictions) against the confirmed-landslide
// record (landslide_record). Only predictions made BEFORE a landslide count as a warning "a day ahead".
import { q } from '../db/index.js';

const NEAR_KM = 15;   // a landslide within this distance of a monitored place counts for that place
const QUIET_DAYS = 2; // a place-day is "quiet" if no landslide within NEAR_KM and ±QUIET_DAYS
const DAY = 86400000;
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

export function distanceKm(a, b) {
  const toRad = (x) => (x * Math.PI) / 180;
  const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * @param {{ predictions?: object[], events?: object[], places?: object[] }} [data] injectable for tests
 */
export function scorecard(data = {}) {
  const predictions = data.predictions || q.all('SELECT location_id, for_date, issued_on, score, elevated FROM ml_predictions');
  const events = (data.events || q.all('SELECT id, date, lat, lng, location_id, source FROM landslide_record WHERE retracted_at IS NULL'));
  const places = data.places || q.all('SELECT id, lat, lng FROM locations');
  if (!predictions.length) return { coverage: null, events_recorded: events.length, events_scored: 0, note: 'No predictions logged yet.' };

  // (place, day) → predictions, keyed by issue day.
  const byKey = new Map();
  for (const p of predictions) {
    const k = `${p.location_id}|${p.for_date}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(p);
  }
  const days = [...new Set(predictions.map((p) => p.for_date))].sort();
  const from = days[0]; const to = days[days.length - 1];
  const placesNear = (e) => places.filter((pl) => distanceKm(pl, e) <= NEAR_KM);
  const ahead = (placeId, day) => (byKey.get(`${placeId}|${day}`) || []).filter((p) => p.issued_on < day); // issued before the day
  const sameDay = (placeId, day) => (byKey.get(`${placeId}|${day}`) || []).filter((p) => p.issued_on <= day);

  const scored = [];
  let outside = 0; let outOfPeriod = 0;
  for (const e of events) {
    if (e.date < from || e.date > to) { outOfPeriod++; continue; }
    const near = placesNear(e);
    if (!near.length) { outside++; continue; }
    const aheadPreds = near.flatMap((pl) => ahead(pl.id, e.date));
    const onDayPreds = near.flatMap((pl) => [...sameDay(pl.id, e.date), ...sameDay(pl.id, addDays(e.date, -1))]);
    scored.push({
      id: e.id, date: e.date, places: near.map((pl) => pl.id), source: e.source,
      had_ahead_prediction: aheadPreds.length > 0,
      warned_ahead: aheadPreds.some((p) => p.elevated),
      warned_on_day_or_before: onDayPreds.some((p) => p.elevated),
      best_score: Math.max(0, ...onDayPreds.map((p) => p.score)),
    });
  }

  // Quiet place-days: latest prediction for that day, no recorded landslide nearby within ±2 days.
  let quiet = 0; let quietElevated = 0;
  for (const [k, preds] of byKey) {
    const [placeId, day] = k.split('|');
    const place = places.find((pl) => pl.id === placeId);
    if (!place) continue;
    const busy = events.some((e) => Math.abs(Date.parse(e.date) - Date.parse(day)) <= QUIET_DAYS * DAY && distanceKm(place, e) <= NEAR_KM);
    if (busy) continue;
    const latest = preds.filter((p) => p.issued_on <= day).sort((a, b) => b.issued_on.localeCompare(a.issued_on))[0];
    if (!latest) continue;
    quiet++;
    if (latest.elevated) quietElevated++;
  }
  const withAhead = scored.filter((s) => s.had_ahead_prediction);
  return {
    coverage: { from, to, days: days.length, place_days: byKey.size },
    events_recorded: events.length, events_scored: scored.length, events_outside_area: outside, events_outside_period: outOfPeriod,
    warned_ahead: withAhead.filter((s) => s.warned_ahead).length, events_with_ahead_prediction: withAhead.length,
    warned_on_day_or_before: scored.filter((s) => s.warned_on_day_or_before).length,
    quiet_place_days: quiet, quiet_elevated: quietElevated, false_alarm_rate: quiet ? quietElevated / quiet : null,
    events: scored,
    rules: `A landslide counts for every monitored place within ${NEAR_KM} km. "Ahead" = an Elevated prediction issued before the landslide day. Quiet = no recorded landslide within ${NEAR_KM} km and ±${QUIET_DAYS} days.`,
  };
}
