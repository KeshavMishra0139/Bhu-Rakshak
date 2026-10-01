import type { LocationSnap } from '../api/types';

/** Hindi and Nepali are both written in Devanagari; server-side content (alerts, place and road names, checklists)
 * exists in English and Hindi, so Nepali readers get the Hindi version. */
export const isDeva = (lang: string) => lang === 'hi' || lang === 'ne';
// Nepali with Latin digits (as commonly written in Sikkim), Nepali month names.
// Assamese also with Latin digits; Mizo and Nagamese have no locale data in browsers, so they use Indian English.
const locale = (lang: string) => (lang === 'hi' ? 'hi-IN' : lang === 'ne' ? 'ne-IN-u-nu-latn' : lang === 'as' ? 'as-IN-u-nu-latn' : 'en-IN');

/** Clock time in IST, e.g. "4:05 pm". */
export const timeIST = (iso: string | null | undefined, lang: string) =>
  iso ? new Intl.DateTimeFormat(locale(lang), { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso)) : '';

/** Date + time in IST, e.g. "24 Sept, 4:05 pm". */
export const dateTimeIST = (iso: string | null | undefined, lang: string) =>
  iso ? new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso)) : '';

export const num = (n: number, lang: string) => new Intl.NumberFormat(locale(lang)).format(n);
export const pct = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 100)}%`);

export const placeName = (l: Pick<LocationSnap, 'name_en' | 'name_hi'> | { location_en: string; location_hi: string } | undefined, lang: string) => {
  if (!l) return '';
  if ('name_en' in l) return isDeva(lang) ? l.name_hi : l.name_en;
  return isDeva(lang) ? l.location_hi : l.location_en;
};

/** Seconds since an ISO time (never negative). */
export const secondsSince = (iso: string | null | undefined, now: number) => (iso ? Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000)) : null);
