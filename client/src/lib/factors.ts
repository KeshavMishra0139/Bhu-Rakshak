import factors from '@shared/config/factors.json';

type DriverText = { en: string; hi: string; plainEn: string; plainHi: string };
const drivers = factors.drivers as Record<string, DriverText>;

/** Technical label (authority views). */
export const driverLabel = (key: string, lang: string) => (drivers[key] ? (lang === 'hi' ? drivers[key].hi : drivers[key].en) : key);
/** Plain-language phrase (citizen views). */
export const driverPlain = (key: string, lang: string) => (drivers[key] ? (lang === 'hi' ? drivers[key].plainHi : drivers[key].plainEn) : key);

export { factors };

type FactorMeta = { key: string; unit: string; en: string; hi: string; source: string };
const all: FactorMeta[] = [...factors.triggering, ...factors.susceptibility, ...factors.exposure] as FactorMeta[];
const byKey = new Map(all.map((f) => [f.key, f]));
/** Label, unit and data source for any factor key (see shared/config/factors.json). */
export const factorMeta = (key: string) => byKey.get(key);
export const factorLabel = (key: string, lang: string) => { const f = byKey.get(key); return f ? (lang === 'hi' ? f.hi : f.en) : key; };
export const notConnectedFactors = () => all.filter((f) => f.source === 'not_connected');
