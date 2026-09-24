import type { ReactNode } from 'react';
import { LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useRiskStream } from '../live/RiskStreamProvider';
import { LiveIndicator } from './LiveIndicator';
import { UpdatedAgo } from './UpdatedAgo';
import { LanguageToggle } from './LanguageToggle';
import { ThemeToggle } from './ThemeToggle';
import { Logo } from './Logo';

export function AppHeader({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const { me, logout } = useAuth();
  const { lastUpdateAt } = useRiskStream();
  const nav = useNavigate();
  return (
    <header className="sticky z-30 bg-surface/95 backdrop-blur border-b border-line" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', top: 'var(--devbar-h, 0px)' }}>
      <div className="mx-auto max-w-7xl px-4 h-16 flex items-center gap-3">
        <Logo />
        <div className="ml-2 hidden md:flex items-center gap-3">
          <LiveIndicator />
          <UpdatedAgo at={lastUpdateAt} />
        </div>
        <div className="flex-1">{children}</div>
        <div className="md:hidden"><LiveIndicator /></div>
        <LanguageToggle />
        <div className="hidden sm:block"><ThemeToggle /></div>
        {me && (
          <button type="button" className="btn-ghost px-3" onClick={async () => { await logout(); nav('/login'); }}>
            <LogOut size={18} aria-hidden />
            <span className="hidden lg:inline">{t('common.sign_out')}</span>
          </button>
        )}
      </div>
    </header>
  );
}
