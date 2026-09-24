import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
type Ctx = { pref: ThemePref; resolved: 'light' | 'dark'; setPref: (p: ThemePref) => void; textSize: 'normal' | 'large'; setTextSize: (s: 'normal' | 'large') => void };

const ThemeContext = createContext<Ctx | null>(null);
const media = () => window.matchMedia('(prefers-color-scheme: dark)');
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(() => (['light', 'dark', 'system'].includes(read('br.theme') || '') ? (read('br.theme') as ThemePref) : 'system'));
  const [systemDark, setSystemDark] = useState(() => media().matches);
  const [textSize, setTextSizeState] = useState<'normal' | 'large'>(() => (read('br.textSize') === 'large' ? 'large' : 'normal'));

  useEffect(() => {
    const m = media();
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);

  const resolved: 'light' | 'dark' = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#071419' : '#0B2A33');
  }, [resolved]);

  useEffect(() => { document.documentElement.setAttribute('data-text-size', textSize); }, [textSize]);

  const setPref = useCallback((p: ThemePref) => { setPrefState(p); write('br.theme', p); }, []);
  const setTextSize = useCallback((s: 'normal' | 'large') => { setTextSizeState(s); write('br.textSize', s); }, []);

  const value = useMemo(() => ({ pref, resolved, setPref, textSize, setTextSize }), [pref, resolved, setPref, textSize, setTextSize]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const c = useContext(ThemeContext);
  if (!c) throw new Error('useTheme outside ThemeProvider');
  return c;
}
