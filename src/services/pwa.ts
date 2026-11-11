import { isDesktop } from './desktopBridge';

/**
 * PWA lifecycle glue.
 *
 * The service worker is production-only: register through this module and test
 * PWA behaviour with `npm run build && npm run preview`. In the packaged
 * desktop shell (Electron) no service worker is registered — the app is
 * already local.
 */

let initialized = false;

export interface PwaOptions {
  /** A new version is waiting — offer "Reload to update" in the UI. */
  onNeedRefresh: (applyUpdate: () => Promise<void>) => void;
  /** The shell has been cached; the app now opens offline. */
  onOfflineReady: () => void;
}

export function initPwa(options: PwaOptions): void {
  if (initialized) return;
  if (isDesktop()) return;
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  initialized = true;
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const updateSW = registerSW({
      onNeedRefresh() {
        options.onNeedRefresh(() => updateSW(true));
      },
      onOfflineReady() {
        options.onOfflineReady();
      },
      onRegisteredSW(_swUrl, registration) {
        // Poll for updates hourly while the app stays open.
        if (registration) {
          setInterval(() => void registration.update(), 60 * 60 * 1000);
        }
      },
      onRegisterError(error) {
        console.error('Service worker registration failed:', error);
      },
    });
  });
}

/** True when the app is launched as an installed PWA window. */
export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches;
}

/**
 * Best-effort Background Sync registration (Chromium only). If unsupported the
 * outbox still flushes on reconnect / app start through the sync engine.
 */
export async function requestOutboxSync(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const sync = (
      registration as ServiceWorkerRegistration & {
        sync?: { register: (tag: string) => Promise<void> };
      }
    ).sync;
    if (sync) await sync.register('hays-outbox');
  } catch {
    // Background Sync is unavailable — the app-level flush covers this case.
  }
}
