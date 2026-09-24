import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme, type ThemePref } from '../theme/ThemeProvider';
import { useAuth } from '../auth/AuthProvider';

const OPTIONS: { value: ThemePref; Icon: typeof Sun }[] = [
  { value: 'light', Icon: Sun },
  { value: 'dark', Icon: Moon },
  { value: 'system', Icon: Monitor },
];

export function ThemeToggle({ onDark = false }: { onDark?: boolean }) {
  const { t } = useTranslation();
  const { pref, setPref } = useTheme();
  const { savePrefs } = useAuth();
  return (
    <div role="radiogroup" aria-label={t('theme.label')} className={`inline-flex rounded-lg border p-0.5 ${onDark ? 'border-white/15' : 'border-line bg-surface'}`}>
      {OPTIONS.map(({ value, Icon }) => {
        const active = pref === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={t(`theme.${value}`)}
            aria-label={t(`theme.${value}`)}
            onClick={() => { setPref(value); savePrefs({ theme: value }); }}
            className={`h-9 w-9 inline-flex items-center justify-center rounded-md transition-colors ${
              active ? (onDark ? 'bg-white/15 text-white' : 'bg-surface-2 text-ink') : onDark ? 'text-on-brand/70 hover:text-white' : 'text-muted hover:text-ink'
            }`}
          >
            <Icon size={17} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
