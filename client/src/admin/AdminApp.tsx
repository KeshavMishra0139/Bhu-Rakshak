import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, FileText } from 'lucide-react';
import { api, errorKey } from '../api/client';
import type { Stakeholder, User } from '../api/types';
import { AppHeader } from '../components/AppHeader';
import { HealthPanel } from '../components/HealthPanel';
import { AuditTable } from '../authority/AuditPage';
import { dateTimeIST } from '../lib/format';

type Tab = 'pending' | 'users' | 'audit' | 'health' | 'contacts';

function Pending() {
  const { t, i18n } = useTranslation();
  const [users, setUsers] = useState<(User & { has_id_document: boolean })[] | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const load = () => api.get<{ users: (User & { has_id_document: boolean })[] }>('/admin/pending').then((d) => setUsers(d.users)).catch((e) => setErr(errorKey(e)));
  useEffect(() => { load(); }, []);
  const act = async (id: string, what: 'approve' | 'reject') => {
    try { await api.post(`/admin/users/${id}/${what}`, what === 'reject' ? { reason: reason[id] || '' } : {}); load(); } catch (e) { setErr(errorKey(e)); }
  };
  if (err) return <p className="field-error" role="alert">{t(err)}</p>;
  if (!users) return <div className="h-32 card animate-pulse" />;
  if (!users.length) return <p className="card p-6 text-muted">{t('adminx.no_pending')}</p>;
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {users.map((u) => (
        <li key={u.id} className="card p-4 space-y-2">
          <p className="font-bold text-lg">{u.name}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">{t('signup.official_email')}</dt><dd>{u.email}</dd>
            <dt className="text-muted">{t('adminx.role')}</dt><dd>{u.sub_role ? t(`roles.${u.sub_role}`) : ''}</dd>
            <dt className="text-muted">{t('signup.district')}</dt><dd>{u.district ? t(`districts.${u.district}`) : ''}</dd>
            <dt className="text-muted">{t('signup.badge_id')}</dt><dd>{u.badge_id}</dd>
            <dt className="text-muted">{t('signup.department')}</dt><dd>{u.department}</dd>
            <dt className="text-muted">{t('adminx.joined')}</dt><dd>{dateTimeIST(u.created_at, i18n.language)}</dd>
          </dl>
          {u.has_id_document ? <a className="btn-ghost !min-h-[36px] py-1 text-sm" href={`/api/admin/users/${u.id}/id-document`} target="_blank" rel="noopener noreferrer"><FileText size={16} aria-hidden />{t('adminx.view_id')}</a>
            : <p className="text-sm text-muted">{t('adminx.no_id')}</p>}
          <label htmlFor={`rr-${u.id}`} className="field-label !mb-1 text-sm">{t('adminx.reject_reason')}</label>
          <input id={`rr-${u.id}`} className="input !min-h-[38px] py-1.5" value={reason[u.id] || ''} onChange={(e) => setReason({ ...reason, [u.id]: e.target.value })} />
          <div className="flex gap-2 pt-1">
            <button type="button" className="btn-primary" onClick={() => act(u.id, 'approve')}><Check size={18} aria-hidden />{t('adminx.approve')}</button>
            <button type="button" className="btn-secondary" onClick={() => act(u.id, 'reject')}><X size={18} aria-hidden />{t('adminx.reject')}</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Users() {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  useEffect(() => { const id = setTimeout(() => api.get<{ users: User[] }>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((d) => setUsers(d.users)).catch(() => {}), 200); return () => clearTimeout(id); }, [q]);
  return (
    <div className="space-y-3">
      <label htmlFor="u-q" className="sr-only">{t('adminx.search_users')}</label>
      <input id="u-q" className="input max-w-sm" placeholder={t('adminx.search_users')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-muted">
            <tr><th className="px-3 py-2">{t('signup.name')}</th><th className="px-3 py-2">{t('signup.email')} / {t('signup.phone')}</th><th className="px-3 py-2">{t('adminx.role')}</th><th className="px-3 py-2">{t('signup.district')}</th><th className="px-3 py-2">{t('common.status')}</th><th className="px-3 py-2">{t('adminx.joined')}</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-3 py-2 font-semibold">{u.name}</td>
                <td className="px-3 py-2">{u.email || u.phone}</td>
                <td className="px-3 py-2">{u.role === 'authority' && u.sub_role ? t(`roles.${u.sub_role}`) : t(`roles.${u.role}`)}</td>
                <td className="px-3 py-2">{u.district ? t(`districts.${u.district}`, { defaultValue: u.district }) : '–'}</td>
                <td className="px-3 py-2">{u.status === 'active' ? t('adminx.approved') : u.status === 'rejected' ? t('adminx.rejected') : t('common.pending')}</td>
                <td className="px-3 py-2 font-mono">{dateTimeIST(u.created_at, i18n.language)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Contacts() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Stakeholder[]>([]);
  const [saved, setSaved] = useState<number | null>(null);
  useEffect(() => { api.get<{ stakeholders: Stakeholder[] }>('/stakeholders').then((d) => setRows(d.stakeholders)).catch(() => {}); }, []);
  const save = async (s: Stakeholder) => { await api.put(`/admin/stakeholders/${s.id}`, { name: s.name, phone: s.phone }).catch(() => {}); setSaved(s.id); setTimeout(() => setSaved(null), 1500); };
  return (
    <div className="space-y-3">
      <p className="text-muted">{t('adminx.contacts_hint')}</p>
      <ul className="space-y-2">
        {rows.map((s) => (
          <li key={s.id} className="card p-3 grid gap-2 sm:grid-cols-[1fr_1fr_160px_auto] items-end">
            <div><p className="font-semibold">{s.role}</p><p className="text-sm text-muted">{t(`districts.${s.district}`, { defaultValue: s.district })}</p></div>
            <input aria-label={t('signup.name')} className="input !min-h-[38px] py-1.5" value={s.name || ''} onChange={(e) => setRows(rows.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))} />
            <input aria-label={t('signup.phone')} className="input !min-h-[38px] py-1.5 font-mono" placeholder={t('citizen.to_be_configured')} value={s.phone || ''} onChange={(e) => setRows(rows.map((x) => (x.id === s.id ? { ...x, phone: e.target.value } : x)))} />
            <button type="button" className="btn-secondary !min-h-[38px]" onClick={() => save(s)}>{saved === s.id ? t('common.saved') : t('common.save')}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AdminApp() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('pending');
  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto max-w-6xl px-4 py-6 space-y-5">
        <h1 className="text-[1.8rem] font-bold">{t('admin.title')}</h1>
        <div role="tablist" aria-label={t('admin.title')} className="flex flex-wrap gap-1.5 border-b border-line">
          {(['pending', 'users', 'audit', 'health', 'contacts'] as Tab[]).map((k) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`px-3 py-2.5 font-semibold border-b-2 -mb-px ${tab === k ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
              {t(`adminx.${k}`)}
            </button>
          ))}
        </div>
        <div role="tabpanel">
          {tab === 'pending' && <Pending />}
          {tab === 'users' && <Users />}
          {tab === 'audit' && <AuditTable adminPath />}
          {tab === 'health' && <div className="card p-5"><HealthPanel /></div>}
          {tab === 'contacts' && <Contacts />}
        </div>
      </main>
    </>
  );
}
