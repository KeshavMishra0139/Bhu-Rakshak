import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { errorKey } from '../api/client';
import { useAuth, homePathFor } from '../auth/AuthProvider';
import { useRiskStream } from '../live/RiskStreamProvider';
import { BrandPanel } from './BrandPanel';
import { LanguageToggle } from '../components/LanguageToggle';
import { ThemeToggle } from '../components/ThemeToggle';
import { placeName } from '../lib/format';

const SUB_ROLES = ['district_officer', 'police', 'bro', 'rescue', 'sdma'] as const;
const DISTRICTS = ['East Sikkim', 'West Sikkim', 'North Sikkim', 'South Sikkim', 'Kalimpong', 'Darjeeling', 'All'] as const;
type Tab = 'citizen' | 'authority';

function Field({ id, label, hint, optional, children }: { id: string; label: string; hint?: string; optional?: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label} {optional && <span className="font-normal text-muted">({t('common.optional')})</span>}
      </label>
      {children}
      {hint && <p id={`${id}-hint`} className="field-hint">{hint}</p>}
    </div>
  );
}

const readAsDataUrl = (file: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = () => rej(new Error('read_failed'));
  r.readAsDataURL(file);
});

export default function Signup() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const { me, signupCitizen, signupAuthority } = useAuth();
  const { list } = useRiskStream();
  const [tab, setTab] = useState<Tab>('citizen');
  const [f, setF] = useState<Record<string, string>>({ language: ['hi', 'ne'].includes(i18n.language) ? i18n.language : 'en' });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => { if (me) nav(homePathFor(me), { replace: true }); }, [me, nav]);

  const places = [...list].sort((a, b) => placeName(a, i18n.language).localeCompare(placeName(b, i18n.language)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (file && file.size > 2 * 1024 * 1024) { setError('errors.id_document_too_large'); return; }
    setBusy(true);
    try {
      if (tab === 'citizen') {
        await signupCitizen({ name: f.name, phone: f.phone || undefined, email: f.email || undefined, password: f.password,
          home_location_id: f.home_location_id || undefined, home_village: f.home_village, language: f.language });
      } else {
        await signupAuthority({ name: f.name, email: f.email, password: f.password, sub_role: f.sub_role, badge_id: f.badge_id,
          department: f.department, district: f.district, language: f.language, id_document: file ? await readAsDataUrl(file) : undefined });
      }
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <BrandPanel />
      <main id="main" className="flex flex-col">
        <div className="flex justify-end items-center gap-2 p-4">
          <LanguageToggle />
          <ThemeToggle />
        </div>
        <div className="flex-1 flex justify-center px-5 pb-12">
          <div className="w-full max-w-[460px]">
            <h1 className="text-[1.9rem] font-bold leading-tight">{t('signup.title')}</h1>

            <div role="tablist" aria-label={t('signup.title')} className="mt-6 grid grid-cols-2 rounded-lg border border-line bg-surface p-1">
              {(['citizen', 'authority'] as Tab[]).map((k) => (
                <button key={k} role="tab" type="button" aria-selected={tab === k} aria-controls="signup-form"
                  onClick={() => { setTab(k); setError(null); }}
                  className={`rounded-md py-2.5 font-semibold transition-colors ${tab === k ? 'bg-brand text-white' : 'text-muted hover:text-ink'}`}>
                  {t(`signup.tab_${k}`)}
                </button>
              ))}
            </div>
            <p className="mt-3 text-muted">{t(tab === 'citizen' ? 'signup.citizen_intro' : 'signup.authority_intro')}</p>

            <form id="signup-form" role="tabpanel" onSubmit={submit} className="mt-6 space-y-4" noValidate>
              <Field id="name" label={t('signup.name')}>
                <input id="name" className="input" autoComplete="name" value={f.name || ''} onChange={set('name')} required />
              </Field>

              {tab === 'citizen' ? (
                <>
                  <Field id="phone" label={t('signup.phone')} hint={t('signup.email_or_phone_hint')}>
                    <input id="phone" className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210"
                      value={f.phone || ''} onChange={set('phone')} aria-describedby="phone-hint" />
                  </Field>
                  <Field id="email" label={t('signup.email')} optional>
                    <input id="email" className="input" type="email" autoComplete="email" value={f.email || ''} onChange={set('email')} />
                  </Field>
                </>
              ) : (
                <Field id="email" label={t('signup.official_email')} hint={t('signup.official_email_hint')}>
                  <input id="email" className="input" type="email" autoComplete="email" value={f.email || ''} onChange={set('email')} required aria-describedby="email-hint" />
                </Field>
              )}

              <Field id="password" label={t('auth.password')} hint={t('signup.password_hint')}>
                <input id="password" className="input" type="password" autoComplete="new-password" value={f.password || ''} onChange={set('password')} required aria-describedby="password-hint" />
              </Field>

              {tab === 'citizen' ? (
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field id="home" label={t('signup.home_location')}>
                    <select id="home" className="input" value={f.home_location_id || ''} onChange={set('home_location_id')}>
                      <option value="">{t('signup.home_location_none')}</option>
                      {places.map((l) => <option key={l.id} value={l.id}>{placeName(l, i18n.language)}</option>)}
                    </select>
                  </Field>
                  <Field id="village" label={t('signup.home_village')} optional>
                    <input id="village" className="input" value={f.home_village || ''} onChange={set('home_village')} />
                  </Field>
                </div>
              ) : (
                <>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field id="sub_role" label={t('signup.sub_role')}>
                      <select id="sub_role" className="input" value={f.sub_role || ''} onChange={set('sub_role')} required>
                        <option value="" disabled>—</option>
                        {SUB_ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
                      </select>
                    </Field>
                    <Field id="district" label={t('signup.district')}>
                      <select id="district" className="input" value={f.district || ''} onChange={set('district')} required>
                        <option value="" disabled>—</option>
                        {DISTRICTS.map((d) => <option key={d} value={d}>{t(`districts.${d}`)}</option>)}
                      </select>
                    </Field>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field id="badge" label={t('signup.badge_id')}>
                      <input id="badge" className="input" value={f.badge_id || ''} onChange={set('badge_id')} required />
                    </Field>
                    <Field id="dept" label={t('signup.department')}>
                      <input id="dept" className="input" value={f.department || ''} onChange={set('department')} required />
                    </Field>
                  </div>
                  <Field id="idfile" label={t('signup.id_upload')} hint={file ? t('signup.id_selected', { name: file.name }) : t('signup.id_upload_hint')} optional>
                    <input id="idfile" type="file" accept="image/png,image/jpeg,image/webp,application/pdf"
                      className="block w-full text-sm file:btn-secondary file:mr-3 file:min-h-0 file:py-2"
                      onChange={(e) => setFile(e.target.files?.[0] || null)} aria-describedby="idfile-hint" />
                  </Field>
                </>
              )}

              <Field id="lang" label={t('signup.language')}>
                <select id="lang" className="input" value={f.language} onChange={set('language')}>
                  <option value="en">English</option>
                  <option value="hi" lang="hi">हिन्दी</option>
                  <option value="ne" lang="ne">नेपाली</option>
                </select>
              </Field>

              {error && <p className="field-error" role="alert">{t(error)}</p>}
              <button type="submit" className="btn-primary w-full" disabled={busy}>
                {busy ? t('common.loading') : t(tab === 'citizen' ? 'signup.submit_citizen' : 'signup.submit_authority')}
              </button>
            </form>

            <p className="mt-5 text-[0.95rem]">
              {t('signup.have_account')}{' '}
              <Link to="/login" className="font-semibold text-brand underline underline-offset-2">{t('common.sign_in')}</Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
