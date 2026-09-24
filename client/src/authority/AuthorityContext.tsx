import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { withPane } from '../lib/viewAs';

type Ctx = {
  selectedId: string | null;
  select: (id: string | null) => void;
  horizon: number; // 0 = now, else hours ahead
  setHorizon: (h: number) => void;
  openOnMap: (id: string) => void;
  draftAlert: (p: { locationId: string; severity?: string; inboxId?: string; incidentId?: string }) => void;
};
const AuthorityContext = createContext<Ctx | null>(null);

export function AuthorityProvider({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const [selectedId, select] = useState<string | null>(() => new URLSearchParams(location.search).get('loc'));
  const [horizon, setHorizon] = useState(0);
  const openOnMap = useCallback((id: string) => { select(id); nav(withPane('/authority')); }, [nav]);
  const draftAlert = useCallback(({ locationId, severity, inboxId, incidentId }: { locationId: string; severity?: string; inboxId?: string; incidentId?: string }) => {
    const q = new URLSearchParams({ target_type: 'location', target_id: locationId });
    if (severity) q.set('severity', severity);
    if (inboxId) q.set('inbox', inboxId);
    if (incidentId) q.set('incident', incidentId);
    nav(withPane(`/authority/alerts?${q}`));
  }, [nav]);
  const value = useMemo(() => ({ selectedId, select, horizon, setHorizon, openOnMap, draftAlert }), [selectedId, horizon, openOnMap, draftAlert]);
  return <AuthorityContext.Provider value={value}>{children}</AuthorityContext.Provider>;
}

export function useAuthority() {
  const c = useContext(AuthorityContext);
  if (!c) throw new Error('useAuthority outside AuthorityProvider');
  return c;
}
