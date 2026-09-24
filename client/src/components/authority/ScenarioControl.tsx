import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudLightning } from 'lucide-react';
import { api, errorKey } from '../../api/client';
import { useRiskStream } from '../../live/RiskStreamProvider';

/** Storm scenario for District Officer / SDMA / Admin. State arrives back over the stream. */
export function ScenarioControl() {
  const { t, i18n } = useTranslation();
  const { corridors, controls } = useRiskStream();
  const active = !!controls?.scenario.active;
  const [picked, setPicked] = useState<string[]>(['north']);
  const [intensity, setIntensity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(start: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.post('/tools/scenario', start ? { active: true, corridors: picked, intensity } : { active: false });
    } catch (e) { setError(errorKey(e)); } finally { setBusy(false); }
  }

  return (
    <section className="card p-4" aria-labelledby="scenario-title">
      <h2 id="scenario-title" className="font-bold text-lg inline-flex items-center gap-2"><CloudLightning size={20} aria-hidden />{t('authority.scenario_title')}</h2>
      <p className="text-sm text-muted mt-1">{t('authority.scenario_hint')}</p>
      <fieldset className="mt-3" disabled={active || busy}>
        <legend className="field-label">{t('authority.scenario_corridors')}</legend>
        <div className="flex flex-col gap-1.5">
          {corridors.map((c) => (
            <label key={c.id} className="inline-flex items-start gap-2 text-[0.95rem]">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-[rgb(var(--brand))]" checked={picked.includes(c.id)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} />
              {i18n.language === 'hi' ? c.name_hi : c.name_en}
            </label>
          ))}
        </div>
        <label htmlFor="intensity" className="field-label mt-3">{t('authority.scenario_intensity')} <span className="font-mono font-normal text-muted">×{intensity.toFixed(1)}</span></label>
        <input id="intensity" type="range" min={0.5} max={1.5} step={0.1} value={intensity}
          onChange={(e) => setIntensity(Number(e.target.value))} className="w-full accent-[rgb(var(--brand))]" />
      </fieldset>
      {error && <p className="field-error" role="alert">{t(error)}</p>}
      {active
        ? <button type="button" className="btn-danger w-full mt-3" disabled={busy} onClick={() => send(false)}>{t('authority.scenario_stop')}</button>
        : <button type="button" className="btn-primary w-full mt-3" disabled={busy || picked.length === 0} onClick={() => send(true)}>{t('authority.scenario_start')}</button>}
    </section>
  );
}
