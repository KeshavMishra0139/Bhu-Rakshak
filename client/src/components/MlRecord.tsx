// The model's live track record, and the confirmed-landslide record for one place: officers record real landslides
// here (they are what the model is judged against and retrained on). Mistakes are retracted with a reason, never deleted.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mountain, Undo2 } from 'lucide-react';
import { api, errorKey } from '../api/client';
import type { LandslideRecord, MlScorecard } from '../api/types';
import { useAuth } from '../auth/AuthProvider';

// Records changed → the scorecard line refreshes.
const CHANGED = 'ml-record-changed';
const notifyChanged = () => window.dispatchEvent(new Event(CHANGED));

const todayIST = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

export function MlScorecardLine() {
  const { t } = useTranslation();
  const [s, setS] = useState<MlScorecard | null>(null);
  useEffect(() => {
    const load = () => api.get<MlScorecard>('/ml/scorecard').then(setS).catch(() => {});
    load();
    window.addEventListener(CHANGED, load);
    return () => window.removeEventListener(CHANGED, load);
  }, []);
  if (!s?.coverage) return <p className="text-xs text-muted">{t('ml.track_none')}</p>;
  return (
    <p className="text-xs">
      <span className="font-semibold">{t('ml.track_title', { from: s.coverage.from })}</span>{' '}
      {s.events_scored
        ? t('ml.track_events', { ahead: s.warned_ahead, withAhead: s.events_with_ahead_prediction, day: s.warned_on_day_or_before, n: s.events_scored })
        : t('ml.track_no_events')}{' '}
      {s.false_alarm_rate != null && t('ml.track_false', { pct: Math.round(s.false_alarm_rate * 100), n: s.quiet_place_days })}
    </p>
  );
}

export function LandslideRecordBox({ locationId }: { locationId: string }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [list, setList] = useState<LandslideRecord[] | null>(null);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayIST());
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get<{ landslides: LandslideRecord[] }>(`/ml/landslides?location_id=${encodeURIComponent(locationId)}`).then((d) => setList(d.landslides)).catch(() => {}), [locationId]);
  useEffect(() => { load(); }, [load]);

  async function save(force = false) {
    setBusy(true); setErr(null);
    try {
      await api.post('/ml/landslides', { location_id: locationId, date, notes: notes.trim() || undefined, force });
      setOpen(false); setNotes(''); load(); notifyChanged();
    } catch (e) {
      const key = errorKey(e);
      if (key === 'errors.possible_duplicate' && window.confirm(t('ml.dup_confirm'))) { setBusy(false); return save(true); }
      setErr(key);
    } finally { setBusy(false); }
  }
  async function retract(id: string) {
    const reason = window.prompt(t('ml.retract_reason'));
    if (!reason?.trim()) return;
    try { await api.post(`/ml/landslides/${id}/retract`, { reason }); load(); notifyChanged(); } catch (e) { setErr(errorKey(e)); }
  }

  return (
    <div className="space-y-2 border-t border-line pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold inline-flex items-center gap-1.5"><Mountain size={15} aria-hidden />{t('ml.record_title')}</p>
        {can('landslides.record') && !open && (
          <button type="button" className="btn-secondary !min-h-[34px] py-1 text-sm" onClick={() => setOpen(true)}>{t('ml.record_add')}</button>
        )}
      </div>
      {open && (
        <form className="space-y-2 rounded-md bg-surface-2 p-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <label className="block text-sm">{t('ml.record_date')}
            <input name="landslide_date" autoComplete="off" type="date" className="input mt-1" value={date} max={todayIST()} required onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="block text-sm">{t('ml.record_notes')}
            <input name="landslide_notes" autoComplete="off" type="text" className="input mt-1" value={notes} maxLength={500} placeholder={t('ml.record_notes_hint')} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <p className="text-xs text-muted">{t('ml.record_help')}</p>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary !min-h-[34px] py-1 text-sm" disabled={busy}>{t('ml.record_save')}</button>
            <button type="button" className="btn-secondary !min-h-[34px] py-1 text-sm" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
          </div>
        </form>
      )}
      {err && <p className="field-error" role="alert">{t(err)}</p>}
      {list && list.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {list.map((x) => (
            <li key={x.id} className={`flex items-start justify-between gap-2 ${x.retracted_at ? 'text-muted line-through' : ''}`}>
              <span><span className="font-mono">{x.date}</span> · {t(`ml.src_${x.source}`)}{x.notes ? ` — ${x.notes}` : ''}
                {x.retracted_at && <span className="block no-underline text-xs">{t('ml.retracted', { why: x.retract_reason })}</span>}</span>
              {can('landslides.record') && !x.retracted_at && (
                <button type="button" className="shrink-0 text-xs underline inline-flex items-center gap-1" onClick={() => retract(x.id)}><Undo2 size={12} aria-hidden />{t('ml.retract')}</button>
              )}
            </li>
          ))}
        </ul>
      ) : list && <p className="text-xs text-muted">{t('ml.record_none')}</p>}
    </div>
  );
}
