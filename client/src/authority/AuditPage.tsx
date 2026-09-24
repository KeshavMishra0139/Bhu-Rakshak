import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dateTimeIST } from '../lib/format';
import { useLive } from './useLive';

type Entry = { id: number; at: string; performed_by: string; action: string; entity_type: string | null; entity_id: string | null; details_json: string | null };

export function AuditTable({ adminPath = false }: { adminPath?: boolean }) {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState('');
  const { data } = useLive<{ entries: Entry[] }>(`${adminPath ? '/admin/audit' : '/audit'}?limit=300${q ? `&q=${encodeURIComponent(q)}` : ''}`, ['incident_updated', 'alert_published', 'report_updated', 'road_updated', 'inbox_updated']);
  return (
    <div className="space-y-3">
      <label htmlFor="audit-q" className="sr-only">{t('audit.search')}</label>
      <input id="audit-q" className="input max-w-sm" placeholder={t('audit.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-muted">
            <tr>{(['when', 'who', 'action', 'entity'] as const).map((k) => <th key={k} scope="col" className="px-3 py-2 font-semibold">{t(`audit.${k}`)}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data?.entries.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-muted">{t('audit.empty')}</td></tr>}
            {data?.entries.map((e) => (
              <tr key={e.id}>
                <td className="px-3 py-2 font-mono whitespace-nowrap">{dateTimeIST(e.at, i18n.language)}</td>
                <td className="px-3 py-2">{e.performed_by}</td>
                <td className="px-3 py-2 font-mono">{e.action}</td>
                <td className="px-3 py-2 font-mono text-muted">{e.entity_type ? `${e.entity_type}:${e.entity_id ?? ''}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AuditPage() {
  const { t } = useTranslation();
  return <div className="mx-auto max-w-6xl p-4 space-y-4"><h1 className="text-2xl font-bold">{t('audit.title')}</h1><AuditTable /></div>;
}
