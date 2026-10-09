// Impact part of the "Why" card: what is exposed within 1 km (from OpenStreetMap), the monitored road segments
// through the place with their status, and the recommended actions.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, School, Hospital, Route, ShieldAlert, CheckCircle2 } from 'lucide-react';
import type { LocationSnap } from '../api/types';
import { RoadBadge } from '../citizen/RoadBadge';
import { actionsFor, loadImpact, type Impact } from '../lib/impact';
import { riskWindow } from '../lib/why';
import { levelVar } from '../lib/risk';
import { isDeva, num, placeName } from '../lib/format';

export function ImpactSection({ loc, technical = false }: { loc: LocationSnap; technical?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [imp, setImp] = useState<Impact | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setImp(null); setFailed(false);
    loadImpact(loc.id).then((x) => live && setImp(x)).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [loc.id]);

  const r = loc.risk;
  if (!r) return null;
  const w = riskWindow(r);
  const actions = actionsFor(r, w, imp, lang, placeName(loc, lang));
  const o = imp?.osm;
  const tile = 'rounded-xl bg-surface-2 p-3';

  return (
    <>
      <section className="mt-4" aria-labelledby={`imp-${loc.id}`}>
        <h3 id={`imp-${loc.id}`} className="font-semibold">
          {t('impact.title')} <span className="text-sm font-normal text-muted">{t('impact.within', { km: imp?.radius_km ?? 1 })}</span>
        </h3>
        {!imp && !failed && <div className="mt-2 grid grid-cols-2 gap-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[68px] rounded-xl" />)}</div>}
        {failed && <p className="mt-2 text-sm text-muted">{t('impact.unavailable')}</p>}
        {imp && (
          <>
            {o ? (
              <dl className="stagger mt-2 grid grid-cols-2 gap-2">
                <div className={tile}>
                  <dt className="flex items-center gap-1.5 text-xs font-semibold text-muted"><Building2 size={14} aria-hidden />{t('impact.buildings')}</dt>
                  <dd className="text-xl font-bold tabular-nums">{num(o.buildings, lang)}</dd>
                </div>
                <div className={tile}>
                  <dt className="flex items-center gap-1.5 text-xs font-semibold text-muted"><School size={14} aria-hidden />{t('impact.schools')}</dt>
                  <dd className="text-xl font-bold tabular-nums">{num(o.schools, lang)}</dd>
                </div>
                <div className={tile}>
                  <dt className="flex items-center gap-1.5 text-xs font-semibold text-muted"><Hospital size={14} aria-hidden />{t('impact.health')}</dt>
                  <dd className="text-xl font-bold tabular-nums">{num(o.health, lang)}
                    {o.hospitals > 0 && <span className="block text-xs font-semibold text-muted">{t('impact.hospitals', { count: o.hospitals })}</span>}
                  </dd>
                </div>
                <div className={tile}>
                  <dt className="flex items-center gap-1.5 text-xs font-semibold text-muted"><Route size={14} aria-hidden />{t('impact.roads')}</dt>
                  <dd className="text-xl font-bold tabular-nums">{t('impact.km', { km: o.road_km })}</dd>
                </div>
              </dl>
            ) : <p className="mt-2 text-sm text-muted">{t('impact.no_osm')}</p>}

            {imp.segments.length > 0 ? (
              <ul className="mt-2 space-y-1.5" aria-label={t('impact.segments')}>
                {imp.segments.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 rounded-xl border border-line px-2.5 py-2">
                    <span className="min-w-0 flex-1 text-sm font-semibold leading-snug">{isDeva(lang) ? s.name_hi : s.name_en}</span>
                    <RoadBadge status={s.status} />
                  </li>
                ))}
              </ul>
            ) : o && o.roads.length > 0 && (
              <p className="mt-2 flex flex-wrap gap-1.5" aria-label={t('impact.main_roads')}>
                {o.roads.slice(0, 4).map((x) => (
                  <span key={`${x.ref}|${x.name}`} className="rounded-pill border border-line px-2.5 py-0.5 text-xs font-semibold">{x.ref || x.name}</span>
                ))}
              </p>
            )}

            {technical && o && (o.school_names.length > 0 || o.health_names.length > 0) && (
              <p className="mt-2 text-xs text-muted">
                {o.school_names.length > 0 && <><span className="font-semibold">{t('impact.schools')}:</span> {o.school_names.join(', ')}. </>}
                {o.health_names.length > 0 && <><span className="font-semibold">{t('impact.health')}:</span> {o.health_names.join(', ')}.</>}
              </p>
            )}
            {o && <p className="mt-2 text-xs text-muted">{t('impact.osm_note')}</p>}
          </>
        )}
      </section>

      <section className="mt-4" aria-labelledby={`act-${loc.id}`}>
        <h3 id={`act-${loc.id}`} className="font-semibold">{t('impact.actions')}</h3>
        <ol className="mt-2 space-y-1.5">
          {actions.map((a, i) => {
            const Icon = a.urgent ? ShieldAlert : CheckCircle2;
            const strong = i === 0 && a.urgent;
            return (
              <li key={a.key} className={`flex items-start gap-2.5 rounded-xl p-2.5 ${strong ? 'font-semibold' : 'border border-line'}`}
                style={strong ? { background: `color-mix(in srgb, ${levelVar(w.kind === 'calm' ? r.level : w.level)} 16%, transparent)` } : undefined}>
                <Icon size={18} className="mt-0.5 shrink-0" style={{ color: a.urgent ? levelVar(w.kind === 'calm' ? r.level : w.level) : 'rgb(var(--brand))' }} aria-hidden />
                <span className="leading-snug">{t(`impact.${a.key}`, a.vars)}</span>
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}
