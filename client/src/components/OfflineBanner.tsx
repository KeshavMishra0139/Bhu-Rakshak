// "Offline — showing data from …" banner for the citizen and officer screens. The risk levels and map shown while
// offline are the last ones this device received (kept by the live stream and the service worker).
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WifiOff, RefreshCw, Download } from 'lucide-react';
import { useRiskStream } from '../live/RiskStreamProvider';
import { dateTimeIST } from '../lib/format';
import { canInstall, onInstallAvailable, promptInstall } from '../lib/pwa';

function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

export function OfflineBanner({ className = '' }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const { status, lastUpdateAt, list } = useRiskStream();
  const online = useOnline();
  // The time of the data itself: the newest risk calculation we hold, else when it last arrived.
  const dataAt = useMemo(() => list.reduce<string | null>((m, l) => (l.risk?.updated_at && (!m || l.risk.updated_at > m) ? l.risk.updated_at : m), null) || lastUpdateAt, [list, lastUpdateAt]);
  const offline = !online || status === 'offline';
  if (!offline && status !== 'reconnecting') return null;
  const time = dataAt ? dateTimeIST(dataAt, i18n.language) : null;

  if (!offline) {
    return (
      <p role="status" className={`flex items-center gap-2 text-sm text-muted ${className}`}>
        <RefreshCw size={15} className="animate-spin [animation-duration:2.5s]" aria-hidden />
        {time ? t('offline.reconnecting', { time }) : t('offline.reconnecting_nodata')}
      </p>
    );
  }
  return (
    <div role="status" className={`flex items-start gap-3 rounded-card border border-[#e0a63a]/60 bg-[#e0a63a]/15 p-3 ${className}`}>
      <WifiOff size={20} className="mt-0.5 shrink-0 text-[#c27c0e]" aria-hidden />
      <div className="min-w-0">
        <p className="font-bold">{time ? t('offline.banner', { time }) : t('offline.banner_nodata')}</p>
        <p className="text-sm text-muted">{t('offline.sub')}</p>
      </div>
    </div>
  );
}

/** Small "Install app" button, shown only when the browser offers installation. */
export function InstallButton({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  const [available, setAvailable] = useState(canInstall());
  useEffect(() => onInstallAvailable(setAvailable), []);
  if (!available) return null;
  return (
    <button type="button" onClick={() => promptInstall()} className={`btn-ghost px-2.5 text-sm ${className}`} title={t('offline.install_tip')}>
      <Download size={17} aria-hidden /><span className="max-sm:sr-only">{t('offline.install')}</span>
    </button>
  );
}
