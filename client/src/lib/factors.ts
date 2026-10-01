import factors from '@shared/config/factors.json';

type DriverText = { en: string; hi: string; ne?: string; plainEn: string; plainHi: string; plainNe?: string; plainAs?: string; plainLus?: string; plainNag?: string };
const drivers = factors.drivers as Record<string, DriverText>;

/** Technical label (authority views). */
export const driverLabel = (key: string, lang: string) => { const d = drivers[key]; if (!d) return key; return lang === 'ne' ? d.ne || d.hi : lang === 'hi' ? d.hi : d.en; };
/** Plain-language phrase (citizen views). Nepali falls back to Hindi; Assamese, Mizo and Nagamese to English. */
const PLAIN_KEY: Record<string, keyof DriverText> = { as: 'plainAs', lus: 'plainLus', nag: 'plainNag' };
export const driverPlain = (key: string, lang: string) => {
  const d = drivers[key];
  if (!d) return key;
  if (lang === 'hi') return d.plainHi;
  if (lang === 'ne') return d.plainNe || d.plainHi;
  const k = PLAIN_KEY[lang];
  return (k && d[k]) || d.plainEn;
};

export { factors };

type FactorMeta = { key: string; unit: string; en: string; hi: string; ne?: string; source: string };
const all: FactorMeta[] = [...factors.triggering, ...factors.susceptibility, ...factors.exposure] as FactorMeta[];
const byKey = new Map(all.map((f) => [f.key, f]));
/** Label, unit and data source for any factor key (see shared/config/factors.json). */
export const factorMeta = (key: string) => byKey.get(key);
export const factorLabel = (key: string, lang: string) => { const f = byKey.get(key); if (!f) return key; return lang === 'ne' ? f.ne || f.hi : lang === 'hi' ? f.hi : f.en; };
export const notConnectedFactors = () => all.filter((f) => f.source === 'not_connected');
