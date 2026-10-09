import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Hourglass, XCircle } from 'lucide-react';
import { useAuth, homePathFor } from '../auth/AuthProvider';
import { AppHeader } from '../components/AppHeader';

export default function Pending() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { me, loading, refresh, logout } = useAuth();
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!me) nav('/login', { replace: true });
    else if (me.user.status === 'active') nav(homePathFor(me), { replace: true });
  }, [me, loading, nav]);

  // Poll quietly so approval shows up without a manual refresh.
  useEffect(() => {
    const id = setInterval(() => { refresh(); }, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  if (!me) return null;
  const u = me.user;
  const rejected = u.status === 'rejected';
  const rows: [string, string | null][] = [
    [t('signup.name'), u.name],
    [t('signup.official_email'), u.email],
    [t('signup.sub_role'), u.sub_role ? t(`roles.${u.sub_role}`) : null],
    [t('signup.district'), u.district ? t(`districts.${u.district}`) : null],
    [t('signup.badge_id'), u.badge_id],
    [t('signup.department'), u.department],
  ];

  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto max-w-xl px-5 py-12">
        <div className="flex items-start gap-4">
          <span className={`mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${rejected ? 'bg-risk-critical/15 text-risk-critical' : 'bg-brand/12 text-brand'}`}>
            {rejected ? <XCircle size={22} aria-hidden /> : <Hourglass size={22} aria-hidden />}
          </span>
          <div>
            <h1 className="text-[1.7rem] font-semibold leading-tight">{t(rejected ? 'pending.rejected_title' : 'pending.title')}</h1>
            <p className="mt-2 text-muted">
              {rejected
                ? (u.rejection_reason ? t('pending.rejected_body', { reason: u.rejection_reason }) : t('pending.rejected_no_reason'))
                : t('pending.body')}
            </p>
          </div>
        </div>
        <section className="card mt-8 p-5" aria-labelledby="sent">
          <h2 id="sent" className="font-semibold">{t('pending.details_title')}</h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[0.95rem]">
            {rows.filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd className="font-medium break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
        <div className="mt-6 flex gap-3">
          {!rejected && (
            <button type="button" className="btn-primary" disabled={checking}
              onClick={async () => { setChecking(true); await refresh(); setChecking(false); }}>
              {t('pending.check_again')}
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={async () => { await logout(); nav('/login'); }}>{t('common.sign_out')}</button>
        </div>
      </main>
    </>
  );
}
