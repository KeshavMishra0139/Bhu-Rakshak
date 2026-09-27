import { useTranslation } from 'react-i18next';

/** Branded loading screen: the logo's ridge line draws itself over the base line, with a slim progress bar. */
export function AppLoader({ inline = false }: { inline?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={`fade-enter flex flex-col items-center justify-center gap-4 ${inline ? 'py-16' : 'min-h-[60vh]'}`} role="status" aria-label={t('common.loading')}>
      <svg width="56" height="56" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="7" fill="#0B2A33" />
        <path className="loader-ridge" d="M4 24 L12 12 L17 18 L21 13 L28 24" fill="none" stroke="#7CC4CF" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        <path className="loader-base" d="M7 27 H25" stroke="#E8B64A" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <div className="w-40 loader-bar" aria-hidden />
      <p className="text-sm text-muted">{t('common.loading')}</p>
    </div>
  );
}
