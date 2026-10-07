import { lazy, Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Camera, Crosshair, CheckCircle2, ArrowLeft } from 'lucide-react';
import { api, errorKey } from '../api/client';
import type { Report } from '../api/types';
import { useRiskStream, useStreamEvent } from '../live/RiskStreamProvider';
import { useCitizen } from './CitizenContext';
import { dateTimeIST, placeName } from '../lib/format';

const MiniMap = lazy(() => import('../components/MiniMap'));
const TYPES = ['crack', 'debris', 'rockfall', 'water_seepage', 'road_damage', 'tilting', 'other'] as const;
const STATUS_COLOR: Record<Report['status'], string> = {
  submitted: 'rgb(var(--muted))', verified: 'rgb(var(--risk-low))', rejected: 'rgb(var(--risk-critical))', resolved: 'rgb(var(--brand))',
};

/** Shrink photos in the browser so uploads stay small on slow connections. Returns the JPEG and its size. */
async function compress(file: File): Promise<{ src: string; w: number; h: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return { src: c.toDataURL('image/jpeg', 0.8), w: c.width, h: c.height };
  } finally { URL.revokeObjectURL(url); }
}

export default function CitizenReport() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { list, locations } = useRiskStream();
  const { viewingId } = useCitizen();
  const [step, setStep] = useState(1);
  const [type, setType] = useState<string>('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoSize, setPhotoSize] = useState<{ w: number; h: number } | null>(null);
  const [desc, setDesc] = useState('');
  const [pin, setPin] = useState<[number, number] | null>(null);
  const [placeId, setPlaceId] = useState<string>(viewingId || '');
  const [gpsErr, setGpsErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [mine, setMine] = useState<Report[]>([]);

  const loadMine = () => api.get<{ reports: Report[] }>('/reports/mine').then((d) => setMine(d.reports)).catch(() => {});
  useEffect(() => { loadMine(); }, []);
  // A warning sign tapped on Home (or picked with Saathi) arrives already chosen: /citizen/report?type=crack
  const [params] = useSearchParams();
  const preset = params.get('type');
  useEffect(() => {
    if (preset && (TYPES as readonly string[]).includes(preset)) {
      setType(preset); setStep(1); setDone(false);
      // Bring the chosen sign (and Next below it) into view; on a phone it can be below the fold.
      window.setTimeout(() => document.querySelector('fieldset [aria-pressed="true"]')?.scrollIntoView({ block: 'center' }), 150);
    }
  }, [preset]);
  useStreamEvent('report_updated', () => { loadMine(); });

  // Warn before closing or reloading the page with a half-filled report (the browser shows its own message).
  // The sign type alone doesn't count: it is often pre-chosen from a tap on Home.
  const unsaved = !done && !!(photo || desc || pin);
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  const center: [number, number] = pin || (placeId && locations[placeId] ? [locations[placeId].lat, locations[placeId].lng] : [27.33, 88.5]);

  function gps() {
    setGpsErr(false);
    navigator.geolocation?.getCurrentPosition((p) => setPin([p.coords.latitude, p.coords.longitude]), () => setGpsErr(true), { timeout: 10000 });
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await api.post('/reports', { type, description: desc, photo, lat: pin?.[0], lng: pin?.[1], location_id: placeId || undefined });
      setDone(true);
      loadMine();
    } catch (e) { setErr(errorKey(e)); } finally { setBusy(false); }
  }

  function reset() { setStep(1); setType(''); setPhoto(null); setPhotoSize(null); setDesc(''); setPin(null); setDone(false); }

  const places = [...list].sort((a, b) => placeName(a, lang).localeCompare(placeName(b, lang)));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="card p-5 sm:p-6">
        <h1 className="text-[1.8rem] font-bold">{t('citizen.report_title')}</h1>
        <p className="text-muted">{t('citizen.report_intro')}</p>

        {done ? (
          <div className="mt-6 text-center py-6" role="status">
            <CheckCircle2 size={56} className="mx-auto text-risk-low" aria-hidden />
            <h2 className="mt-3 text-2xl font-bold">{t('citizen.report_sent')}</h2>
            <p className="mt-1 text-muted">{t('citizen.report_sent_body')}</p>
            <button type="button" className="btn-secondary mt-5" onClick={reset}>{t('citizen.report_another')}</button>
          </div>
        ) : (
          <>
            <p className="mt-5 label-mono">{t('citizen.step_of', { n: step })}</p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-pill bg-surface-2"><div className="h-full w-full origin-left rounded-pill bg-brand transition-transform duration-300" style={{ transform: `scaleX(${step / 3})` }} /></div>

            {step === 1 && (
              <fieldset className="mt-5">
                <legend className="text-xl font-bold">{t('citizen.step1')}</legend>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {TYPES.map((k) => (
                    <button key={k} type="button" aria-pressed={type === k} onClick={() => setType(k)}
                      className={`min-h-[56px] rounded-lg border px-4 text-left font-semibold ${type === k ? 'border-brand bg-brand/10' : 'border-line hover:bg-surface-2'}`}>
                      {t(`reports.ty_${k}`)}
                    </button>
                  ))}
                </div>
                <button type="button" className="btn-primary mt-5" disabled={!type} onClick={() => setStep(2)}>{t('common.next')}</button>
              </fieldset>
            )}

            {step === 2 && (
              <div className="mt-5 space-y-4">
                <h2 className="text-xl font-bold">{t('citizen.step2')}</h2>
                <div>
                  <label className="btn-secondary cursor-pointer">
                    <Camera size={18} aria-hidden />{photo ? t('citizen.change_photo') : t('citizen.add_photo')}
                    <input type="file" name="photo" accept="image/*" capture="environment" className="sr-only"
                      onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const p = await compress(f); setPhoto(p.src); setPhotoSize({ w: p.w, h: p.h }); } }} />
                  </label>
                  <p className="field-hint">{t('citizen.photo_hint')}</p>
                  {photo && <img src={photo} alt={t('citizen.photo_preview_alt')} width={photoSize?.w} height={photoSize?.h} className="mt-3 h-auto max-h-48 w-auto max-w-full rounded-lg border border-line" />}
                </div>
                <div>
                  <label htmlFor="desc" className="field-label">{t('citizen.describe')} <span className="font-normal text-muted">({t('common.optional')})</span></label>
                  <textarea id="desc" name="description" autoComplete="off" className="input min-h-[100px]" maxLength={600} value={desc} onChange={(e) => setDesc(e.target.value)} />
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn-ghost" onClick={() => setStep(1)}><ArrowLeft size={18} aria-hidden />{t('common.back')}</button>
                  <button type="button" className="btn-primary" onClick={() => setStep(3)}>{t('common.next')}</button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="mt-5 space-y-4">
                <h2 className="text-xl font-bold">{t('citizen.step3')}</h2>
                <button type="button" className="btn-secondary" onClick={gps}><Crosshair size={18} aria-hidden />{t('citizen.loc_gps')}</button>
                {gpsErr && <p className="field-error" role="alert">{t('citizen.gps_denied')}</p>}
                <p className="text-sm text-muted">{t('citizen.loc_pin')}</p>
                <Suspense fallback={<div className="h-[240px] rounded-card bg-surface-2 animate-pulse" />}>
                  <MiniMap center={center} zoom={pin ? 13 : 10} pin={pin} onPick={setPin} height={240} label={t('citizen.loc_pin')} />
                </Suspense>
                {pin && <p className="font-semibold text-risk-low" role="status">{t('citizen.pin_set')} <span className="label-mono">{pin[0].toFixed(4)}, {pin[1].toFixed(4)}</span></p>}
                <div>
                  <label htmlFor="rplace" className="field-label">{t('citizen.loc_pick')}</label>
                  <select id="rplace" name="place" className="input" value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
                    <option value="">—</option>
                    {places.map((l) => <option key={l.id} value={l.id}>{placeName(l, lang)}</option>)}
                  </select>
                </div>
                {err && <p className="field-error" role="alert">{t(err)}</p>}
                <div className="flex gap-2">
                  <button type="button" className="btn-ghost" onClick={() => setStep(2)}><ArrowLeft size={18} aria-hidden />{t('common.back')}</button>
                  <button type="button" className="btn-primary" disabled={busy || (!pin && !placeId)} onClick={submit}>
                    {busy ? t('common.loading') : t('citizen.send_report')}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <section className="card p-5" aria-labelledby="mine-title">
        <h2 id="mine-title" className="text-lg font-bold">{t('citizen.my_reports')}</h2>
        {mine.length === 0 && <p className="mt-2 text-muted">{t('citizen.no_reports')}</p>}
        <ul className="mt-3 divide-y divide-line">
          {mine.map((r) => (
            <li key={r.id} className="py-3 flex items-start gap-3">
              <span className="flex-1">
                <span className="block font-semibold">{t(`reports.ty_${r.type}`)}</span>
                <span className="block text-sm text-muted">{r.location_id && locations[r.location_id] ? placeName(locations[r.location_id], lang) : ''}</span>
                <span className="label-mono">{dateTimeIST(r.created_at, lang)}</span>
              </span>
              <span className="rounded-pill px-2.5 py-1 text-sm font-semibold text-white" style={{ background: STATUS_COLOR[r.status] }}>{t(`reports.st_${r.status}`)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
