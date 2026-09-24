import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { setLanguage } from '../i18n';
import { useAuth } from '../auth/AuthProvider';

/** One tap switches the whole interface. The button is labelled in the language it switches to. */
export function LanguageToggle({ onDark = false }: { onDark?: boolean }) {
  const { t, i18n } = useTranslation();
  const { savePrefs } = useAuth();
  const next = i18n.language === 'hi' ? 'en' : 'hi';
  return (
    <button
      type="button"
      onClick={() => { setLanguage(next); savePrefs({ language: next }); }}
      className={`btn-ghost px-3 ${onDark ? 'text-on-brand hover:bg-white/10' : ''}`}
      lang={next}
      aria-label={t('lang.switch')}
    >
      <Languages size={18} aria-hidden />
      <span>{next === 'hi' ? 'हिन्दी' : 'English'}</span>
    </button>
  );
}
