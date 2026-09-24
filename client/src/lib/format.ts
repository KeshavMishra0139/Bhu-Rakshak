import type { LocationSnap } from '../api/types';

const locale = (lang: string) => (lang === 'hi' ? 'hi-IN' : 'en-IN');

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
  if ('name_en' in l) return lang === 'hi' ? l.name_hi : l.name_en;
  return lang === 'hi' ? l.location_hi : l.location_en;
};

/** Seconds since an ISO time (never negative). */
export const secondsSince = (iso: string | null | undefined, now: number) => (iso ? Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000)) : null);
