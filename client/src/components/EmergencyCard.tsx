// Emergency screen: what Saathi shows instead of the chat when someone says they are in danger. One big call button,
// the local disaster contacts that officials have entered, the nearest safe place (passed in), and three short steps.
// Nothing here waits for the network: contacts come from the offline copy when there is no connection.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, OctagonAlert, Phone } from 'lucide-react';
import { api } from '../api/client';
import type { Stakeholder } from '../api/types';

type Props = {
  /** District of the chosen place, to pick its control room; null shows only state-wide contacts. */
  district: string | null;
  /** Translate in the assistant's answer language. */
  T: (key: string, opts?: Record<string, unknown>) => string;
  onBack: () => void;
  /** Nearest safe place, when known. */
  children?: ReactNode;
};

export const EMERGENCY_STEPS = ['citizen.em_step1', 'citizen.em_step2', 'citizen.em_step3'];

export function EmergencyCard({ district, T, onBack, children }: Props) {
  const [contacts, setContacts] = useState<Stakeholder[]>([]);
  const call = useRef<HTMLAnchorElement>(null);
  useEffect(() => { call.current?.focus(); }, []);
  useEffect(() => {
    api.get<{ stakeholders: Stakeholder[] }>('/stakeholders').then((d) => setContacts(d.stakeholders)).catch(() => {});
  }, []);
  // Only contacts with a number; 112 has its own button.
  const local = contacts.filter((c) => c.phone && c.phone !== '112' && (c.district === district || c.district === 'All'));

  return (
    <section aria-labelledby="em-title" className="space-y-3">
      <div role="alert" className="flex items-center gap-3 rounded-2xl bg-[#fdecea] px-4 py-3 text-[#7a1f17]">
        <OctagonAlert size={28} aria-hidden className="shrink-0" />
        <h3 id="em-title" className="text-lg font-semibold leading-tight">{T('citizen.em_title')}</h3>
      </div>

      <div>
        <a ref={call} href="tel:112" className="flex min-h-[64px] items-center justify-center gap-3 rounded-2xl bg-risk-critical px-4 text-xl font-bold text-white shadow-[0_10px_24px_rgba(179,38,30,0.3)]">
          <Phone size={24} aria-hidden />{T('citizen.em_call')}
        </a>
        <p className="mt-1.5 text-center text-[13px] text-[#3e5a63]">{T('citizen.em_call_sub')}</p>
      </div>

      {local.length > 0 && (
        <div className="rounded-2xl border border-[#e1eaec] bg-white p-3.5">
          <h4 className="font-bold">{T('citizen.em_local')}</h4>
          <ul className="mt-1 divide-y divide-[#e1eaec]">
            {local.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 text-[14px] font-semibold">{c.role}</span>
                <a href={`tel:${c.phone}`} className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border border-[#cbdde1] px-3.5 text-[14px] font-bold text-[#0b2a33] hover:bg-[#e4eff1]">
                  <Phone size={15} aria-hidden />{c.phone}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {children}

      <div className="rounded-2xl border border-[#e1eaec] bg-white p-3.5">
        <h4 className="font-bold">{T('citizen.em_steps')}</h4>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[15px] leading-relaxed">
          {EMERGENCY_STEPS.map((k) => <li key={k}>{T(k)}</li>)}
        </ol>
      </div>

      <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[#cbdde1] bg-white px-4 text-[14px] font-semibold text-[#0b2a33] hover:bg-[#e4eff1]">
        <ArrowLeft size={16} aria-hidden />{T('citizen.em_back')}
      </button>
    </section>
  );
}
