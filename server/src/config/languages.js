// Interface languages a user can save. Server-written content (alerts, place and road names) exists in English and
// Hindi; Nepali readers get the Hindi version and the others get English (see client/src/lib/format.ts → isDeva).
// en English · hi Hindi · ne Nepali · as Assamese · lus Mizo · nag Nagamese · kha Khasi (reserved: translation waits
// for a native speaker, so it can be added later without another database change).
export const LANGUAGES = ['en', 'hi', 'ne', 'as', 'kha', 'lus', 'nag'];
export const isLanguage = (l) => LANGUAGES.includes(l);
export const LANGUAGE_CHECK = `CHECK (language IN (${LANGUAGES.map((l) => `'${l}'`).join(',')}))`;
