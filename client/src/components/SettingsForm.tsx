import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Volume2, Square } from 'lucide-react';
import { api, errorKey } from '../api/client';
import type { Me, User } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { useTheme, type ThemePref } from '../theme/ThemeProvider';
import { LANG_NAMES, LANGS, setLanguage, type Lang } from '../i18n';
import { useRiskStream } from '../live/RiskStreamProvider';
import { placeName } from '../lib/format';
import { audioUnlocked, onAudioState, playAlarm, stopAlarm, unlockAudio } from '../lib/audio';
import { withPane } from '../lib/viewAs';

type Prefs = { alerts_my_area: boolean; road_closures: boolean; alarm_sound: boolean; alarm_volume: number; vibration: boolean; browser_notifications: boolean; inbox_chime: boolean };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card p-5 space-y-4">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Toggle({ id, label, checked, onChange, hint }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="min-w-0 font-medium">
        {label}
        {hint && <span className="block text-sm font-normal text-muted">{hint}</span>}
      </label>
      <button id={id} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative h-8 w-14 shrink-0 rounded-pill transition-colors duration-200 ${checked ? 'bg-brand' : 'bg-line'}`}>
        {/* Knob anchored to the left edge (buttons centre their content otherwise), then slid across. */}
        <span aria-hidden className={`absolute left-0 top-1 h-6 w-6 rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-7' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}

export function SettingsForm({ variant }: { variant: 'citizen' | 'authority' }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const nav = useNavigate();
  const { me, setMe, logout } = useAuth();
  const theme = useTheme();
  const { list } = useRiskStream();
  const [profile, setProfile] = useState<Partial<User>>({});
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [delPw, setDelPw] = useState('');
  const [testing, setTesting] = useState(false);
  const [soundOn, setSoundOn] = useState(audioUnlocked());
  const notifSupported = typeof Notification !== 'undefined';

  useEffect(() => onAudioState(setSoundOn), []);
  useEffect(() => {
    api.get<{ profile: User; prefs: Prefs }>('/settings').then((d) => { setProfile(d.profile); setPrefs(d.prefs); }).catch((e) => setErr(errorKey(e)));
  }, []);

  const flash = (m: string) => { setMsg(m); setErr(null); setTimeout(() => setMsg(null), 2500); };
  async function refreshMe() { setMe(await api.get<Me>('/auth/me')); }

  async function savePrefs(patch: Partial<Prefs>) {
    const next = { ...(prefs as Prefs), ...patch };
    setPrefs(next);
    try { await api.put('/settings', { prefs: patch }); await refreshMe(); } catch (e) { setErr(errorKey(e)); }
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    try {
      await api.put('/settings', { name: profile.name, phone: profile.phone || '', home_location_id: profile.home_location_id || null, home_village: profile.home_village || '' });
      await refreshMe();
      flash(t('common.saved'));
    } catch (e2) { setErr(errorKey(e2)); }
  }

  async function changePw(e: FormEvent) {
    e.preventDefault();
    try { await api.post('/settings/password', pw); setPw({ current: '', next: '' }); flash(t('settings.pw_changed')); } catch (e2) { setErr(errorKey(e2)); }
  }

  async function deleteAccount() {
    try { await api.del('/settings/account', { password: delPw }); await logout(); nav('/'); } catch (e) { setErr(errorKey(e)); }
  }

  async function testAlarm(level: 'high' | 'critical') {
    if (!audioUnlocked()) await unlockAudio();
    setTesting(true);
    playAlarm(level, prefs?.alarm_volume ?? 0.5, 5);
    if (prefs?.vibration) navigator.vibrate?.(level === 'critical' ? [300, 100, 300, 100, 300] : [400, 200, 400]);
    setTimeout(() => setTesting(false), 5000);
  }

  async function toggleBrowserNotif(v: boolean) {
    if (v && notifSupported && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission().catch(() => 'denied' as NotificationPermission);
      if (p !== 'granted') { setErr('settings.browser_notif_denied'); return savePrefs({ browser_notifications: false }); }
    }
    savePrefs({ browser_notifications: v });
  }

  const places = [...list].sort((a, b) => placeName(a, lang).localeCompare(placeName(b, lang)));
  if (!me) return null;

  return (
    <div className="space-y-5">
      <div aria-live="polite" className="min-h-[1.5rem]">
        {msg && <p className="text-risk-low font-semibold">{msg}</p>}
        {err && <p className="field-error" role="alert">{t(err)}</p>}
      </div>

      <Section title={t('settings.profile')}>
        <form onSubmit={saveProfile} className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="s-name" className="field-label">{t('signup.name')}</label>
            <input name="name" autoComplete="name" id="s-name" className="input" value={profile.name || ''} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
          </div>
          <div>
            <label htmlFor="s-phone" className="field-label">{t('signup.phone')}</label>
            <input name="phone" autoComplete="tel" id="s-phone" className="input" type="tel" value={profile.phone || ''} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
          </div>
          <div>
            <label htmlFor="s-email" className="field-label">{t('signup.email')}</label>
            <input name="email" autoComplete="email" id="s-email" className="input opacity-70" value={profile.email || ''} readOnly />
          </div>
          {variant === 'citizen' && (
            <>
              <div>
                <label htmlFor="s-home" className="field-label">{t('settings.home')}</label>
                <select id="s-home" className="input" value={profile.home_location_id || ''} onChange={(e) => setProfile({ ...profile, home_location_id: e.target.value || null })}>
                  <option value="">{t('signup.home_location_none')}</option>
                  {places.map((l) => <option key={l.id} value={l.id}>{placeName(l, lang)}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="s-village" className="field-label">{t('signup.home_village')}</label>
                <input name="home_village" autoComplete="off" id="s-village" className="input" value={profile.home_village || ''} onChange={(e) => setProfile({ ...profile, home_village: e.target.value })} />
              </div>
            </>
          )}
          <div className="sm:col-span-2"><button type="submit" className="btn-primary">{t('settings.save_profile')}</button></div>
        </form>
      </Section>

      <Section title={t('settings.appearance')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset className="sm:col-span-2">
            <legend className="field-label">{t('lang.label')}</legend>
            <div className="flex flex-wrap gap-2">
              {LANGS.map((l) => (
                <button key={l} type="button" lang={l} aria-pressed={lang === l}
                  className={`${lang === l ? 'btn-primary' : 'btn-secondary'} min-w-[7rem] flex-1`}
                  onClick={() => { setLanguage(l); api.put('/settings', { language: l }).catch(() => {}); }}>
                  {LANG_NAMES[l]}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="field-label">{t('theme.label')}</legend>
            <select className="input" aria-label={t('theme.label')} value={theme.pref}
              onChange={(e) => { theme.setPref(e.target.value as ThemePref); api.put('/settings', { theme: e.target.value }).catch(() => {}); }}>
              {(['system', 'light', 'dark'] as ThemePref[]).map((v) => <option key={v} value={v}>{t(`theme.${v}`)}</option>)}
            </select>
          </fieldset>
          <fieldset>
            <legend className="field-label">{t('settings.text_size')}</legend>
            <select className="input" aria-label={t('settings.text_size')} value={theme.textSize}
              onChange={(e) => { const v = e.target.value as 'normal' | 'large'; theme.setTextSize(v); api.put('/settings', { text_size: v }).catch(() => {}); }}>
              <option value="normal">{t('settings.text_normal')}</option>
              <option value="large">{t('settings.text_large')}</option>
            </select>
          </fieldset>
        </div>
      </Section>

      {prefs && (
        <Section title={t('settings.notifications')}>
          {variant === 'citizen' && (
            <>
              <Toggle id="p-area" label={t('settings.alerts_my_area')} checked={prefs.alerts_my_area} onChange={(v) => savePrefs({ alerts_my_area: v })} />
              <Toggle id="p-roads" label={t('settings.road_closures')} checked={prefs.road_closures} onChange={(v) => savePrefs({ road_closures: v })} />
              <hr className="border-line" />
              <h3 className="font-semibold">{t('settings.alarm')}</h3>
              <p className="text-sm text-muted">{soundOn ? t('settings.sound_state_on') : t('settings.sound_state_off')}</p>
              <Toggle id="p-alarm" label={t('settings.alarm_sound')} checked={prefs.alarm_sound} onChange={(v) => savePrefs({ alarm_sound: v })} />
              <div>
                <label htmlFor="p-vol" className="field-label">{t('settings.alarm_volume')} <span className="font-mono font-normal text-muted">{Math.round(prefs.alarm_volume * 100)}%</span></label>
                <input id="p-vol" type="range" min={0.1} max={1} step={0.05} value={prefs.alarm_volume} className="w-full accent-[rgb(var(--brand))]"
                  onChange={(e) => setPrefs({ ...prefs, alarm_volume: Number(e.target.value) })} onPointerUp={() => savePrefs({ alarm_volume: prefs.alarm_volume })}
                  onKeyUp={() => savePrefs({ alarm_volume: prefs.alarm_volume })} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary min-w-[10rem] flex-1" onClick={() => testAlarm('high')}><Volume2 size={18} aria-hidden />{t('settings.test_high')}</button>
                <button type="button" className="btn-secondary min-w-[10rem] flex-1" onClick={() => testAlarm('critical')}><Volume2 size={18} aria-hidden />{t('settings.test_critical')}</button>
                {testing && <button type="button" className="btn-ghost" onClick={() => { stopAlarm(); setTesting(false); }}><Square size={16} aria-hidden />{t('settings.stop_test')}</button>}
              </div>
              <Toggle id="p-vib" label={t('settings.vibration')} checked={prefs.vibration} onChange={(v) => savePrefs({ vibration: v })} />
            </>
          )}
          {variant === 'authority' && (
            <Toggle id="p-chime" label={t('settings.inbox_chime')} checked={prefs.inbox_chime} onChange={(v) => { if (v) unlockAudio(); savePrefs({ inbox_chime: v }); }} />
          )}
          {notifSupported && (
            <Toggle id="p-notif" label={t('settings.browser_notif')} checked={prefs.browser_notifications} onChange={toggleBrowserNotif} />
          )}
        </Section>
      )}

      <Section title={t('settings.password')}>
        <form onSubmit={changePw} className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="pw-cur" className="field-label">{t('settings.current_pw')}</label>
            <input name="current_password" id="pw-cur" type="password" autoComplete="current-password" className="input" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </div>
          <div>
            <label htmlFor="pw-new" className="field-label">{t('settings.new_pw')}</label>
            <input name="new_password" id="pw-new" type="password" autoComplete="new-password" className="input" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            <p className="field-hint">{t('signup.password_hint')}</p>
          </div>
          <div className="sm:col-span-2"><button type="submit" className="btn-secondary" disabled={!pw.current || !pw.next}>{t('settings.password')}</button></div>
        </form>
      </Section>

      <section className="card p-5 flex flex-wrap items-center gap-3">
        <Link to={withPane('/about')} className="btn-secondary">{t('common.about')}</Link>
        <button type="button" className="btn-secondary" onClick={async () => { await logout(); nav('/login'); }}>{t('common.sign_out')}</button>
      </section>

      {me.user.role === 'citizen' || me.user.role === 'authority' ? (
        <section className="card p-5 space-y-3 border-risk-critical/40">
          <h2 className="text-lg font-bold">{t('settings.delete')}</h2>
          <p className="text-muted">{t('settings.delete_body')}</p>
          <div className="flex flex-wrap gap-2">
            <label htmlFor="del-pw" className="sr-only">{t('settings.current_pw')}</label>
            <input name="delete_password" autoComplete="current-password" id="del-pw" type="password" className="input max-w-xs" placeholder={t('settings.current_pw')} value={delPw} onChange={(e) => setDelPw(e.target.value)} />
            <button type="button" className="btn-danger" disabled={!delPw} onClick={deleteAccount}>{t('settings.delete_confirm')}</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
