import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, ShieldHalf, UserRound, Building2, Wrench } from 'lucide-react';
import { api, errorKey } from '../api/client';
import { useAuth, homePathFor } from '../auth/AuthProvider';
import { BrandPanel } from './BrandPanel';
import { LanguageToggle } from '../components/LanguageToggle';
import { ThemeToggle } from '../components/ThemeToggle';

type DemoInfo = { enabled: boolean; accounts: string[]; dev_mode: boolean };
const MORE_ROLES = ['dm_north', 'police', 'bro', 'rescue'] as const;

export default function Login() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { me, login, demoLogin, devLogin } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoInfo | null>(null);
  const [more, setMore] = useState('');
  const devRef = useRef<HTMLDialogElement>(null);

  useEffect(() => { api.get<DemoInfo>('/auth/demo-accounts').then(setDemo).catch(() => setDemo(null)); }, []);
  useEffect(() => { if (me) nav(homePathFor(me), { replace: true }); }, [me, nav]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try { await fn(); } catch (e) { setError(errorKey(e)); } finally { setBusy(null); }
  }

  const onSubmit = (e: FormEvent) => { e.preventDefault(); run('form', () => login(identifier, password)); };

  return (
    <div className="min-h-screen grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <BrandPanel />
      <main id="main" className="flex flex-col">
        <div className="flex justify-end items-center gap-2 p-4">
          <LanguageToggle />
          <ThemeToggle />
        </div>
        <div className="flex-1 flex items-start lg:items-center justify-center px-5 pb-12">
          <div className="w-full max-w-[420px]">
            <h1 className="text-[1.9rem] font-bold leading-tight">{t('auth.login_title')}</h1>
            <p className="text-muted mt-1.5">{t('auth.login_subtitle')}</p>

            <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
              <div>
                <label htmlFor="identifier" className="field-label">{t('auth.identifier')}</label>
                <input name="identifier" spellCheck={false} id="identifier" className="input" autoComplete="username" inputMode="email" value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)} required />
              </div>
              <div>
                <label htmlFor="password" className="field-label">{t('auth.password')}</label>
                <div className="relative">
                  <input name="password" id="password" className="input pr-12" type={showPw ? 'text' : 'password'} autoComplete="current-password"
                    value={password} onChange={(e) => setPassword(e.target.value)} required />
                  <button type="button" className="absolute right-1 top-1/2 -translate-y-1/2 h-10 w-10 inline-flex items-center justify-center text-muted hover:text-ink"
                    onClick={() => setShowPw((s) => !s)} aria-label={showPw ? t('auth.hide_password') : t('auth.show_password')}>
                    {showPw ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
                  </button>
                </div>
              </div>
              {error && <p className="field-error" role="alert">{t(error)}</p>}
              <button type="submit" className="btn-primary w-full" disabled={!!busy || !identifier || !password}>
                {busy === 'form' ? t('auth.signing_in') : t('auth.sign_in_button')}
              </button>
            </form>

            {/* New accounts: pick the kind first (officer accounts are checked by an administrator). */}
            <div className="mt-5 text-[0.95rem]">
              <p>{t('auth.new_here')}</p>
              <div className="mt-2 grid gap-2">
                <Link to="/signup" className="btn-secondary">{t('auth.signup_citizen')}</Link>
                <Link to="/signup?as=officer" className="btn-secondary">{t('auth.signup_officer')}</Link>
              </div>
            </div>

            {demo?.enabled && (
              <section className="mt-9 pt-7 border-t border-line" aria-labelledby="demo-title">
                <h2 id="demo-title" className="font-bold text-lg">{t('auth.demo_title')}</h2>
                <p className="text-sm text-muted mt-0.5">{t('auth.demo_hint')}</p>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {([['citizen', UserRound], ['officer', ShieldHalf], ['admin', Building2]] as const).map(([acct, Icon]) => (
                    <button key={acct} type="button" className="btn-secondary flex-col gap-1 py-3 h-auto" disabled={!!busy}
                      onClick={() => run(acct, () => demoLogin(acct))}>
                      <Icon size={20} aria-hidden />
                      <span className="text-sm">{t(`auth.demo_${acct}`)}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <label htmlFor="demo-more" className="sr-only">{t('auth.demo_more')}</label>
                  <select id="demo-more" className="input flex-1" value={more} onChange={(e) => setMore(e.target.value)}>
                    <option value="">{t('auth.demo_more')}</option>
                    {MORE_ROLES.map((r) => <option key={r} value={r}>{t(`auth.demo_${r}`)}</option>)}
                  </select>
                  <button type="button" className="btn-secondary" disabled={!more || !!busy} onClick={() => run(more, () => demoLogin(more))}>
                    {t('common.sign_in')}
                  </button>
                </div>
              </section>
            )}

            {demo?.dev_mode && (
              <button type="button" className="mt-8 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink underline underline-offset-2"
                onClick={() => devRef.current?.showModal()}>
                <Wrench size={14} aria-hidden /> {t('auth.dev_link')}
              </button>
            )}
          </div>
        </div>
      </main>
      <DevDialog dialogRef={devRef} onSubmit={(email, pw, code) => devLogin(email, pw, code)} />
    </div>
  );
}

function DevDialog({ dialogRef, onSubmit }: { dialogRef: RefObject<HTMLDialogElement>; onSubmit: (e: string, p: string, c: string) => Promise<unknown> }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('dev@demo.in');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await onSubmit(email, pw, code); dialogRef.current?.close(); } catch (err) { setError(errorKey(err)); } finally { setBusy(false); }
  };
  return (
    <dialog ref={dialogRef} className="card p-0 w-[min(92vw,420px)] text-ink backdrop:bg-black/50">
      <form onSubmit={submit} className="p-6 space-y-4">
        <div>
          <h2 className="text-xl font-bold">{t('auth.dev_title')}</h2>
          <p className="text-sm text-muted mt-1">{t('auth.dev_body')}</p>
        </div>
        <div>
          <label className="field-label" htmlFor="dev-email">{t('auth.dev_email')}</label>
          <input name="email" spellCheck={false} id="dev-email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        </div>
        <div>
          <label className="field-label" htmlFor="dev-pw">{t('auth.password')}</label>
          <input name="dev_password" id="dev-pw" className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
        </div>
        <div>
          <label className="field-label" htmlFor="dev-code">{t('auth.dev_code')} <span className="font-normal text-muted">({t('common.optional')})</span></label>
          <input name="access_code" spellCheck={false} id="dev-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" />
        </div>
        {error && <p className="field-error" role="alert">{t(error)}</p>}
        <div className="flex gap-2 justify-end pt-1">
          <button type="button" className="btn-ghost" onClick={() => dialogRef.current?.close()}>{t('common.cancel')}</button>
          <button type="submit" className="btn-primary" disabled={busy || !pw}>{t('auth.dev_submit')}</button>
        </div>
      </form>
    </dialog>
  );
}
