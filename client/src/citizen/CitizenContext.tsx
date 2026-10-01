// Citizen state shared by every citizen page: which place is being viewed, and the High/Critical alarm.
// The alarm is driven by the same risk_escalation events that fill the authority inbox.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { OctagonAlert, AlertTriangle, Phone, BellRing, Volume2 } from 'lucide-react';
import { api } from '../api/client';
import type { Level } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { useRiskStream, useStreamEvent } from '../live/RiskStreamProvider';
import { riskConfig, levelVar, levelInk } from '../lib/risk';
import { placeName, timeIST } from '../lib/format';
import { audioUnlocked, onAudioState, playAlarm, stopAlarm, unlockAudio, vibrate, speak } from '../lib/audio';

type Active = { locationId: string; level: 'high' | 'critical'; acknowledged: boolean; nextRepeatAt: number; snoozedUntil: number | null };
type Ctx = {
  viewingId: string | null;
  setViewingId: (id: string) => void;
  homeId: string | null;
  active: Active | null;
  soundOn: boolean;
};
const CitizenContext = createContext<Ctx | null>(null);
const ACK_KEY = 'br.alarmAck';
const readAcks = (): Record<string, number> => { try { return JSON.parse(sessionStorage.getItem(ACK_KEY) || '{}'); } catch { return {}; } };
const writeAck = (k: string) => { const a = readAcks(); a[k] = Date.now(); try { sessionStorage.setItem(ACK_KEY, JSON.stringify(a)); } catch { /* ignore */ } };
const cfg = riskConfig.citizenAlarm;

export function CitizenProvider({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { me } = useAuth();
  const { locations } = useRiskStream();
  const homeId = me?.actor.home_location_id || null;
  const [viewingId, setViewingState] = useState<string | null>(() => sessionStorage.getItem('br.viewing') || homeId);
  const [active, setActive] = useState<Active | null>(null);
  const [soundOn, setSoundOn] = useState(audioUnlocked());
  const prefs = (me?.user.prefs || {}) as { alarm_sound?: boolean; alarm_volume?: number; vibration?: boolean; browser_notifications?: boolean };
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => onAudioState(setSoundOn), []);
  useEffect(() => { if (!viewingId && homeId) setViewingState(homeId); }, [homeId, viewingId]);
  const setViewingId = useCallback((id: string) => { setViewingState(id); try { sessionStorage.setItem('br.viewing', id); } catch { /* ignore */ } }, []);

  const watched = useMemo(() => new Set([homeId, viewingId].filter(Boolean) as string[]), [homeId, viewingId]);

  const sound = useCallback((level: 'high' | 'critical') => {
    if (prefs.alarm_sound !== false) playAlarm(level, prefs.alarm_volume ?? cfg.defaultVolume, level === 'critical' ? 10 : 6);
    if (prefs.vibration !== false) vibrate(level === 'critical' ? [300, 100, 300, 100, 300, 100, 600] : [400, 200, 400]);
  }, [prefs.alarm_sound, prefs.alarm_volume, prefs.vibration]);

  const trigger = useCallback((locationId: string, level: 'high' | 'critical') => {
    const key = `${locationId}:${level}`;
    // Critical stays acknowledged for the rest of the session once the person taps "I understand".
    if (level === 'critical' && readAcks()[key]) return;
    const repeatMin = level === 'critical' ? cfg.criticalRepeatMinutes : cfg.highRepeatMinutes;
    setActive({ locationId, level, acknowledged: false, nextRepeatAt: Date.now() + repeatMin * 60000, snoozedUntil: null });
    sound(level);
    const loc = locations[locationId];
    if (prefs.browser_notifications && typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden && loc) {
      try {
        new Notification(t(`alarm.b_${level}`, { place: placeName(loc, i18n.language) }), { body: t(`alarm.i_${level}`), tag: key, requireInteraction: level === 'critical' });
      } catch { /* ignore */ }
    }
  }, [sound, locations, prefs.browser_notifications, t, i18n.language]);

  // Live escalations for the places this person cares about.
  useStreamEvent('risk_escalation', (e) => {
    if (!watched.has(e.location_id) || (e.to !== 'high' && e.to !== 'critical')) return;
    trigger(e.location_id, e.to);
  });
  useStreamEvent('risk_deescalation', (e) => {
    const a = activeRef.current;
    if (!a || a.locationId !== e.location_id) return;
    if (e.to === 'high' && a.level === 'critical') setActive({ ...a, level: 'high', acknowledged: true, nextRepeatAt: Date.now() + cfg.highRepeatMinutes * 60000 });
    else if (e.to !== 'high' && e.to !== 'critical') { stopAlarm(); setActive(null); }
  });

  // On load (or when the watched place changes), show the banner if a watched place is already High/Critical.
  useEffect(() => {
    if (activeRef.current) return;
    for (const id of watched) {
      const lv = locations[id]?.risk?.level;
      if ((lv === 'high' || lv === 'critical') && !readAcks()[`${id}:${lv}`]) { trigger(id, lv); break; }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watched, Object.keys(locations).length > 0]);

  // Repeat schedule: High re-alerts every 15 min while High; Critical every 5 min until acknowledged.
  useEffect(() => {
    const id = setInterval(() => {
      const a = activeRef.current;
      if (!a) return;
      const now = Date.now();
      if (a.snoozedUntil && now < a.snoozedUntil) return;
      if (a.level === 'critical' && a.acknowledged) return;
      if (now >= a.nextRepeatAt || (a.snoozedUntil && now >= a.snoozedUntil)) {
        const repeatMin = a.level === 'critical' ? cfg.criticalRepeatMinutes : cfg.highRepeatMinutes;
        setActive({ ...a, acknowledged: false, snoozedUntil: null, nextRepeatAt: now + repeatMin * 60000 });
        sound(a.level);
      }
    }, 10000);
    return () => clearInterval(id);
  }, [sound]);

  // Flash the tab title while unacknowledged.
  useEffect(() => {
    if (!active || active.acknowledged || (active.snoozedUntil && Date.now() < active.snoozedUntil)) return;
    const base = document.title;
    const loc = locations[active.locationId];
    const alt = t('alarm.title_flash', { level: t(`levels.${active.level}`), place: loc ? placeName(loc, i18n.language) : '' });
    let on = false;
    const id = setInterval(() => { on = !on; document.title = on ? alt : base; }, 1000);
    return () => { clearInterval(id); document.title = base; };
  }, [active, locations, t, i18n.language]);

  const value = useMemo(() => ({ viewingId, setViewingId, homeId, active, soundOn }), [viewingId, setViewingId, homeId, active, soundOn]);

  const actions = {
    understand: () => {
      if (!active) return;
      stopAlarm();
      writeAck(`${active.locationId}:${active.level}`);
      api.post('/risk-ack', { location_id: active.locationId, level: active.level }).catch(() => {});
      const repeatMin = active.level === 'critical' ? cfg.criticalRepeatMinutes : cfg.highRepeatMinutes;
      setActive({ ...active, acknowledged: true, nextRepeatAt: Date.now() + repeatMin * 60000 });
    },
    snooze: () => {
      if (!active) return;
      stopAlarm();
      setActive({ ...active, snoozedUntil: Date.now() + cfg.snoozeMinutes * 60000 });
    },
    enableSound: async () => {
      if (await unlockAudio()) { if (active && !active.acknowledged) sound(active.level); }
    },
  };

  return (
    <CitizenContext.Provider value={value}>
      {active && <AlarmBanner active={active} actions={actions} soundOn={soundOn} />}
      {children}
    </CitizenContext.Provider>
  );
}

function AlarmBanner({ active, actions, soundOn }: { active: Active; actions: { understand: () => void; snooze: () => void; enableSound: () => void }; soundOn: boolean }) {
  const { t, i18n } = useTranslation();
  const { locations } = useRiskStream();
  const loc = locations[active.locationId];
  const place = loc ? placeName(loc, i18n.language) : '';
  const lv: Level = active.level;
  const Icon = lv === 'critical' ? OctagonAlert : AlertTriangle;
  const snoozed = !!active.snoozedUntil && Date.now() < active.snoozedUntil;
  const quiet = active.acknowledged || snoozed;
  return (
    <div role="alert" aria-live="assertive" className="sticky z-40" style={{ top: 'var(--devbar-h, 0px)', background: levelVar(lv), color: levelInk(lv) }}>
      <div className={`mx-auto max-w-[1100px] px-4 ${quiet ? 'py-2' : 'py-4'} flex flex-wrap items-center gap-3`}>
        <Icon size={quiet ? 22 : 34} aria-hidden className="shrink-0" />
        <div className="flex-1 min-w-[200px]">
          <p className={`${quiet ? 'text-base' : 'text-xl'} font-bold leading-tight`}>{t(`alarm.b_${lv}`, { place })}</p>
          {!quiet && <p className="text-[1.05rem] mt-0.5">{t(`alarm.i_${lv}`)}</p>}
          {snoozed && <p className="text-sm">{t('alarm.snoozed', { time: timeIST(new Date(active.snoozedUntil!).toISOString(), i18n.language) })}</p>}
        </div>
        {!quiet && (
          <div className="flex flex-wrap gap-2">
            {!soundOn && (
              <button type="button" onClick={actions.enableSound} className="btn bg-black/25 hover:bg-black/35 text-inherit border border-white/30">
                <Volume2 size={18} aria-hidden />{t('alarm.tap_enable')}
              </button>
            )}
            <button type="button" onClick={actions.understand} className="btn bg-white text-[#17392b] hover:bg-white/90">{t('alarm.understand')}</button>
            <button type="button" onClick={actions.snooze} className="btn bg-black/15 hover:bg-black/25 text-inherit">{t('alarm.snooze')}</button>
            <a href="tel:112" className="btn bg-black/30 hover:bg-black/40 text-inherit"><Phone size={18} aria-hidden />{t('alarm.call')}</a>
            <button type="button" className="btn bg-transparent hover:bg-black/15 text-inherit" aria-label={t('citizen.listen')}
              onClick={() => speak(`${t(`alarm.b_${lv}`, { place })}. ${t(`alarm.i_${lv}`)}`, i18n.language)}>
              <BellRing size={18} aria-hidden />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function useCitizen() {
  const c = useContext(CitizenContext);
  if (!c) throw new Error('useCitizen outside CitizenProvider');
  return c;
}
