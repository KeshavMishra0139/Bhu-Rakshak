import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import hi from './locales/hi.json';

export type Lang = 'en' | 'hi';
const stored = (() => { try { return localStorage.getItem('br.lang'); } catch { return null; } })();
const initial: Lang = stored === 'hi' ? 'hi' : 'en';

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, hi: { translation: hi } },
  lng: initial,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** Switch language instantly, remember it, and update <html lang> so the Devanagari font applies. */
export function setLanguage(lang: Lang) {
  i18n.changeLanguage(lang);
  document.documentElement.setAttribute('lang', lang);
  try { localStorage.setItem('br.lang', lang); } catch { /* private mode */ }
}
document.documentElement.setAttribute('lang', initial);

export default i18n;
