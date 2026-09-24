import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, homePathFor } from './AuthProvider';
import type { Role } from '../api/types';

/** Client-side routing guard only. The server checks every request independently. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { me, loading } = useAuth();
  const { t } = useTranslation();
  const loc = useLocation();
  if (loading) return <div className="p-8 text-muted" role="status">{t('common.loading')}</div>;
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (me.user.status !== 'active') return <Navigate to="/pending" replace />;
  const effective = me.actor.role;
  const allowed = roles.includes(effective) || (me.user.role === 'developer' && !me.actor.viewing_as);
  if (!allowed) return <Navigate to={homePathFor(me)} replace />;
  return <>{children}</>;
}
