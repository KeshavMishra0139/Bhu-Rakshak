// Small "What does this mean?" button beside a card heading: opens Saathi, which explains that card in simple
// words using the live data for the chosen place (/api/assistant intent explain_<topic>).
import { useTranslation } from 'react-i18next';
import { HelpCircle } from 'lucide-react';
import { useSaathi } from '../citizen/Saathi';

export type HelpTopic = 'status' | 'rain' | 'roads' | 'contacts';

export function HelpButton({ topic }: { topic: HelpTopic }) {
  const { t } = useTranslation();
  const { open } = useSaathi();
  const label = t('citizen.help_label');
  return (
    <button type="button" onClick={() => open({ intent: `explain_${topic}`, label: t(`citizen.help_q_${topic}`) })}
      className="-my-2 inline-grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-brand" aria-label={label} title={label}>
      <HelpCircle size={20} aria-hidden />
    </button>
  );
}
