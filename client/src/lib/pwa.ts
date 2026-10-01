// Installable app + offline support: registers the service worker (production builds only) and keeps the browser's
// "install" prompt so the app can offer its own Install button.
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: InstallEvent | null = null;
const listeners = new Set<(available: boolean) => void>();
const notify = () => listeners.forEach((fn) => fn(!!deferred));

export function initPwa() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallEvent; notify(); });
  window.addEventListener('appinstalled', () => { deferred = null; notify(); });
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* app still works online */ }); });
  }
}

export const canInstall = () => !!deferred;
export function onInstallAvailable(fn: (available: boolean) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  notify();
  await e.prompt();
  return (await e.userChoice).outcome === 'accepted';
}
