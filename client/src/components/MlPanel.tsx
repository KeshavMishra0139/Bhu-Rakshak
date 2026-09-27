// EXPERIMENTAL model — second opinion for officers (server/src/prediction/mlModel.js). Clearly labelled, shows its
// measured accuracy, and never drives alerts. Predictions are logged daily so they can be judged later.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlaskConical, Download } from 'lucide-react';
import { api } from '../api/client';
import type { MlLatest, MlDay } from '../api/types';
import { dateTimeIST } from '../lib/format';

// One shared fetch for all drawers; refreshed every 10 minutes (the server recomputes every 3 hours).
let cache: { at: number; data: MlLatest | null; p?: Promise<MlLatest | null> } = { at: 0, data: null };
function loadMl(): Promise<MlLatest | null> {
  if (cache.data && Date.now() - cache.at < 600000) return Promise.resolve(cache.data);
  if (!cache.p) {
    cache.p = api.get<MlLatest>('/ml/latest').then((d) => { cache = { at: Date.now(), data: d }; return d; }).catch(() => { cache.p = undefined; return null; });
  }
  return cache.p;
}

function Day({ label, d }: { label: string; d?: MlDay }) {
  const { t } = useTranslation();
  if (!d) return <div className="rounded-md bg-surface-2 p-2"><dt className="text-muted">{label}</dt><dd className="mt-1 text-sm">–</dd></div>;
  return (
    <div className="rounded-md bg-surface-2 p-2">
      <dt className="text-muted">{label}</dt>
      <dd className="mt-1 flex items-center gap-2">
        <span className={`rounded-pill px-2 py-0.5 text-xs font-bold ${d.elevated ? 'bg-[#ef7d00] text-white' : 'bg-surface text-muted border border-line'}`}>{d.elevated ? t('ml.elevated') : t('ml.normal')}</span>
        <span className="font-mono tabular-nums">{d.score.toFixed(2)}</span>
      </dd>
    </div>
  );
}

export function MlPanel({ locationId }: { locationId: string }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<MlLatest | null>(cache.data);
  useEffect(() => {
    let alive = true;
    const go = () => loadMl().then((d) => { if (alive) setData(d); });
    go();
    const id = setInterval(go, 600000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  if (!data) return null;
  const p = data.predictions[locationId];
  const ev = data.model.evaluation;
  const inp = p?.today?.inputs;
  return (
    <section className="rounded-lg border border-dashed border-line p-3 space-y-2" aria-labelledby="ml-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="ml-title" className="font-bold inline-flex items-center gap-1.5"><FlaskConical size={17} aria-hidden />{t('ml.title')}</h3>
        <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted">{t('ml.experimental')}</span>
      </div>
      {p ? (
        <>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <Day label={t('ml.today')} d={p.today} />
            <Day label={t('ml.tomorrow')} d={p.tomorrow} />
          </dl>
          {inp && (
            <p className="text-sm">
              {t('ml.inputs', { rain3: inp.rain_3d, ratio: inp.rain_3d_vs_normal ?? '–', hour: inp.max_1h_48h, mmi: inp.quake_max_mmi_30d })}
            </p>
          )}
        </>
      ) : <p className="text-sm text-muted">{t('ml.no_data')}</p>}
      <p className="text-xs text-muted">
        {t('ml.accuracy', { caught: Math.round(ev.caught * 100), fa: Math.round(ev.false_alarms * 100), right: Math.round(ev.warnings_right * 100) })}
        {' '}{t('ml.not_alerts')}
      </p>
      <p className="text-xs text-muted flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{t('ml.version', { v: data.model.version })}{data.computed_at ? ` · ${t('ml.updated', { time: dateTimeIST(data.computed_at, i18n.language) })}` : ''}</span>
        <a href="/api/ml/log.csv" className="inline-flex items-center gap-1 underline"><Download size={12} aria-hidden />{t('ml.log')}</a>
      </p>
    </section>
  );
}
