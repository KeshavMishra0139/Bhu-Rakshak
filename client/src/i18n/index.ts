import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import hi from './locales/hi.json';
import ne from './locales/ne.json';
import as from './locales/as.json';
import lus from './locales/lus.json';
import nag from './locales/nag.json';

// en English · hi Hindi · ne Nepali · as Assamese · lus Mizo · nag Nagamese.
// Assamese, Mizo and Nagamese are drafts awaiting native-speaker review; they cover the citizen screens that matter
// most in an emergency (risk map and Why card, alerts, the report form) and fall back to English elsewhere.
export type Lang = 'en' | 'hi' | 'ne' | 'as' | 'lus' | 'nag';
export const LANGS: Lang[] = ['en', 'hi', 'ne', 'as', 'lus', 'nag'];
/** Each language named in itself, so people can find their own. */
export const LANG_NAMES: Record<Lang, string> = { en: 'English', hi: 'हिन्दी', ne: 'नेपाली', as: 'অসমীয়া', lus: 'Mizo ṭawng', nag: 'Nagamese' };
/** Translations not yet reviewed by native speakers (shown with a small "beta" tag). */
export const DRAFT_LANGS: Lang[] = ['as', 'lus', 'nag'];
export const isLang = (l: unknown): l is Lang => LANGS.includes(l as Lang);

const stored = (() => { try { return localStorage.getItem('br.lang'); } catch { return null; } })();
const initial: Lang = isLang(stored) ? stored : 'en';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en }, hi: { translation: hi }, ne: { translation: ne },
    as: { translation: as }, lus: { translation: lus }, nag: { translation: nag },
  },
  lng: initial,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** Switch language instantly, remember it, and update <html lang> so the right script font applies. */
export function setLanguage(lang: Lang) {
  i18n.changeLanguage(lang);
  document.documentElement.setAttribute('lang', lang);
  try { localStorage.setItem('br.lang', lang); } catch { /* private mode */ }
}
document.documentElement.setAttribute('lang', initial);

export default i18n;
