import { useTranslation } from 'react-i18next';
import { BrandShield } from './BrandShield';

/** Branded loading screen: the shield builds itself, then the warning waves pulse and data runs into the brain. */
export function AppLoader({ inline = false }: { inline?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={`fade-enter flex flex-col items-center justify-center gap-4 ${inline ? 'py-16' : 'min-h-[60vh]'}`} role="status" aria-label={t('common.loading')}>
      <BrandShield variant="full" motion="loading" size={inline ? 120 : 170} />
      <div className="w-40 loader-bar" aria-hidden />
      <p className="text-sm text-muted">{t('common.loading')}</p>
    </div>
  );
}
