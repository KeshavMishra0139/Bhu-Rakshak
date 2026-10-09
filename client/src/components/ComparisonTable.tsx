// "How Bhu-Rakshak compares": GSI landslide forecasts and NDEM hazard maps next to this prototype, from
// client/src/data/comparison.json. Anything not confirmed from a source is marked [to verify]. Scrolls sideways on
// phones with the first column pinned.
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, MoveHorizontal } from 'lucide-react';
import data from '../data/comparison.json';

type Row = { id: string; label: string } & Record<string, string>;
const VERIFY = '[to verify]';

/** Text with every "[to verify]" shown as a small amber tag. */
function Cell({ text }: { text: string }) {
  const { t } = useTranslation();
  const parts = text.split(VERIFY);
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {p}
          {i < parts.length - 1 && (
            <span className="mx-0.5 inline-block whitespace-nowrap rounded bg-[#fde7c7] px-1.5 py-px text-[11px] font-bold text-[#8a4b00]" title={t('compare.verify_tip')}>{t('compare.verify')}</span>
          )}
        </Fragment>
      ))}
    </>
  );
}

export function ComparisonTable({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  const rows = data.rows as Row[];
  return (
    <section className={className} aria-labelledby="compare-title">
      <h2 id="compare-title" className="text-2xl font-semibold">{t('compare.title')}</h2>
      <p className="mt-1 max-w-3xl text-muted">{t('compare.intro')}</p>
      <p className="mt-3 flex items-center gap-1.5 text-sm text-muted sm:hidden"><MoveHorizontal size={16} aria-hidden />{t('compare.swipe')}</p>
      <div className="mt-3 overflow-x-auto rounded-card border border-line" role="region" aria-labelledby="compare-title" tabIndex={0}>
        <table className="w-full min-w-[780px] border-collapse text-left text-sm">
          <thead>
            <tr className="bg-surface-2">
              <th scope="col" className="sticky left-0 z-10 w-24 bg-surface-2 p-2.5 align-bottom text-xs font-bold uppercase tracking-wide text-muted sm:w-36 sm:p-3">{t('compare.aspect')}</th>
              {data.columns.map((c) => (
                <th key={c.id} scope="col" className={`p-3 align-bottom ${'ours' in c && c.ours ? 'bg-brand/12' : ''}`}>
                  <span className="block font-bold">{c.name}</span>
                  <span className="block text-xs font-normal text-muted">{c.sub}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <th scope="row" className="sticky left-0 z-10 bg-surface p-2.5 text-[13px] font-semibold sm:p-3 sm:text-sm">{r.label}</th>
                {data.columns.map((c) => (
                  <td key={c.id} className={`p-3 leading-snug ${'ours' in c && c.ours ? 'bg-brand/[0.06]' : ''}`}><Cell text={r[c.id] || '—'} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-semibold text-brand">{t('compare.sources', { date: data.checked_on })}</summary>
        <ul className="mt-2 space-y-1">
          {data.sources.map((s) => (
            <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 text-brand hover:underline"><ExternalLink size={13} className="mt-1 shrink-0" aria-hidden />{s.title}</a></li>
          ))}
        </ul>
        <p className="mt-2 text-muted">{t('compare.note')}</p>
      </details>
    </section>
  );
}
