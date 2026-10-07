import { useTranslation } from 'react-i18next';
import { BrandShield } from './BrandShield';

/** The Bhu-Rakshak shield with the name. The waves ripple on hover; with `alert` they turn red and pulse. */
export function Logo({ onDark = false, compact = false, alert = false }: { onDark?: boolean; compact?: boolean; alert?: boolean }) {
  const { t, i18n } = useTranslation();
  return (
    <span className="inline-flex items-center gap-2.5">
      <BrandShield variant="mini" motion={alert ? 'alert' : 'hover'} size={30} />
      {!compact && (
        <span className="leading-tight">
          {/* translate="no": browser auto-translate must not change the brand name. */}
          <span translate="no" className={`block font-bold text-[1.05rem] ${onDark ? 'text-white' : 'text-ink'}`}>{t('app.name')}</span>
          <span translate="no" className={`block text-xs ${onDark ? 'text-on-brand/70' : 'text-muted'}`} lang={i18n.language === 'en' ? 'hi' : 'en'}>{t('app.name_local')}</span>
        </span>
      )}
    </span>
  );
}
