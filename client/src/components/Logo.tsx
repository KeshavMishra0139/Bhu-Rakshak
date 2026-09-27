import { useTranslation } from 'react-i18next';

/** Mark: a ridge line over a steady base line (the slope, watched). */
export function Logo({ onDark = false, compact = false }: { onDark?: boolean; compact?: boolean }) {
  const { t, i18n } = useTranslation();
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="7" fill={onDark ? 'rgba(255,255,255,0.08)' : '#0B2A33'} />
        <path d="M4 24 L12 12 L17 18 L21 13 L28 24 Z" fill="none" stroke="#7CC4CF" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M7 27 H25" stroke="#E8B64A" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      {!compact && (
        <span className="leading-tight">
          <span className={`block font-bold text-[1.05rem] ${onDark ? 'text-white' : 'text-ink'}`}>{t('app.name')}</span>
          <span className={`block text-xs ${onDark ? 'text-on-brand/70' : 'text-muted'}`} lang={i18n.language === 'en' ? 'hi' : 'en'}>{t('app.name_local')}</span>
        </span>
      )}
    </span>
  );
}
