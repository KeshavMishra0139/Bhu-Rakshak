import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LANGS, setLanguage, type Lang } from '../i18n';
import { useAuth } from '../auth/AuthProvider';

// Each language is named in itself, so people can find their own.
const NAMES: Record<Lang, string> = { en: 'English', hi: 'हिन्दी', ne: 'नेपाली' };

/** Language menu (English · हिन्दी · नेपाली). Switches the whole interface instantly and remembers the choice. */
export function LanguageToggle({ onDark = false }: { onDark?: boolean }) {
  const { t, i18n } = useTranslation();
  const { savePrefs } = useAuth();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = (LANGS.includes(i18n.language as Lang) ? i18n.language : 'en') as Lang;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const choose = (l: Lang) => { setOpen(false); if (l === current) return; setLanguage(l); savePrefs({ language: l }); };

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu" aria-label={t('lang.label')}
        className={`btn-ghost px-3 ${onDark ? 'text-on-brand hover:bg-white/10' : ''}`}>
        <Languages size={18} aria-hidden />
        <span lang={current}>{NAMES[current]}</span>
        <ChevronDown size={14} aria-hidden className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul role="menu" aria-label={t('lang.label')} className="pop-enter origin-top-right absolute right-0 top-full z-[1200] mt-1 w-44 card shadow-xl py-1">
          {LANGS.map((l) => (
            <li key={l} role="none">
              <button type="button" role="menuitemradio" aria-checked={l === current} lang={l} onClick={() => choose(l)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-ink hover:bg-surface-2">
                <span className={l === current ? 'font-semibold' : ''}>{NAMES[l]}</span>
                {l === current && <Check size={16} className="text-brand" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
