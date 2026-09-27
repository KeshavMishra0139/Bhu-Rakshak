import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Level } from '../api/types';
import { LEVEL_ICON, levelVar } from '../lib/risk';

type Toast = { id: number; text: string; level?: Level; urgent?: boolean };
type Ctx = { push: (t: Omit<Toast, 'id'>) => void };
const ToastContext = createContext<Ctx | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);
  const push = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = ++seq;
    setToasts((ts) => [...ts.slice(-3), { ...toast, id }]);
    setTimeout(() => dismiss(id), toast.urgent ? 12000 : 7000);
  }, [dismiss]);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed z-50 bottom-4 right-4 left-4 sm:left-auto sm:w-[380px] flex flex-col gap-2" aria-live="assertive">
        {toasts.map((x) => {
          const Icon = x.level ? LEVEL_ICON[x.level] : null;
          return (
            <div key={x.id} className="toast-enter card shadow-lg flex items-start gap-3 p-3.5 border-l-4" style={{ borderLeftColor: x.level ? levelVar(x.level) : undefined }}>
              {Icon && <Icon size={20} style={{ color: levelVar(x.level!) }} aria-hidden className="mt-0.5 shrink-0" />}
              <p className="flex-1 text-[0.95rem] font-semibold">{x.text}</p>
              <button type="button" onClick={() => dismiss(x.id)} className="text-muted hover:text-ink p-1" aria-label={t('common.close')}>
                <X size={16} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToasts() {
  const c = useContext(ToastContext);
  if (!c) throw new Error('useToasts outside ToastProvider');
  return c;
}
