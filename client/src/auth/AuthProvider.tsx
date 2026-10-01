import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import type { Me } from '../api/types';
import { isLang, setLanguage, type Lang } from '../i18n';
import { useTheme, type ThemePref } from '../theme/ThemeProvider';

type Ctx = {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<Me | null>;
  login: (identifier: string, password: string) => Promise<Me>;
  demoLogin: (account: string) => Promise<Me>;
  devLogin: (email: string, password: string, accessCode: string) => Promise<Me>;
  signupCitizen: (body: Record<string, unknown>) => Promise<Me>;
  signupAuthority: (body: Record<string, unknown>) => Promise<Me>;
  logout: () => Promise<void>;
  setMe: (me: Me) => void;
  can: (cap: string) => boolean;
  /** Persist a language/theme/text-size choice to the profile when signed in. */
  savePrefs: (patch: { language?: Lang; theme?: ThemePref; text_size?: 'normal' | 'large' }) => void;
};

const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const theme = useTheme();

  const apply = useCallback((m: Me) => {
    setMeState(m);
    // A user's saved preferences win over the device defaults once they sign in.
    const lang = (m.actor.language || m.user.language) as Lang;
    if (isLang(lang)) setLanguage(lang);
    if (m.user.theme) theme.setPref(m.user.theme);
    if (m.user.text_size) theme.setTextSize(m.user.text_size);
    return m;
  }, [theme]);

  const refresh = useCallback(async () => {
    try {
      return apply(await api.get<Me>('/auth/me'));
    } catch (e) {
      if (!(e instanceof ApiError) || e.status === 401 || e.status === 403) setMeState(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [apply]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  const value = useMemo<Ctx>(() => ({
    me,
    loading,
    refresh,
    login: async (identifier, password) => apply(await api.post<Me>('/auth/login', { identifier, password })),
    demoLogin: async (account) => apply(await api.post<Me>('/auth/demo', { account })),
    devLogin: async (email, password, access_code) => apply(await api.post<Me>('/dev/login', { email, password, access_code })),
    signupCitizen: async (body) => apply(await api.post<Me>('/auth/signup/citizen', body)),
    signupAuthority: async (body) => apply(await api.post<Me>('/auth/signup/authority', body)),
    logout: async () => { try { await api.post('/auth/logout'); } finally { setMeState(null); } },
    setMe: (m) => { apply(m); },
    can: (cap) => !!me?.capabilities.includes(cap),
    savePrefs: (patch) => { if (me) api.put('/settings', patch).catch(() => { /* preference sync is best effort */ }); },
  }), [me, loading, refresh, apply]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const c = useContext(AuthContext);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}

/** Where each role lands after sign-in. */
export function homePathFor(me: Me | null): string {
  if (!me) return '/login';
  if (me.user.status !== 'active') return '/pending';
  switch (me.actor.role) {
    case 'citizen': return '/citizen';
    case 'authority': return '/authority';
    case 'admin': return '/admin';
    case 'developer': return '/authority';
    default: return '/';
  }
}
