import React, { useEffect, useState } from 'react';
import { AlertTriangle, Download, Loader2, RefreshCw, RotateCw, WifiOff, X } from 'lucide-react';
import { initPwa, isStandalone } from '../services/pwa';
import {
  clearConflictNotice,
  getSyncState,
  subscribeSyncState,
  syncNow,
  flushDraftSave,
  type SyncState,
} from '../services/jobSync';
import { isDesktop } from '../services/desktopBridge';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Floating status stack (bottom-right): offline banner, pending-sync counter,
 * "update available" reload prompt and the PWA install offer.
 *
 * Uses the brand's floating-layer conventions (rounded-xl, bordered, shadow-lg,
 * amber = caution, red = the single primary action).
 */
export const PwaStatus: React.FC = () => {
  const [sync, setSync] = useState<SyncState>(getSyncState);
  const [updateReady, setUpdateReady] = useState<(() => Promise<void>) | null>(null);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandalone());
  const [dismissedInstall, setDismissedInstall] = useState(false);

  useEffect(() => subscribeSyncState(setSync), []);

  useEffect(() => {
    initPwa({
      onNeedRefresh: (applyUpdate) => setUpdateReady(() => applyUpdate),
      onOfflineReady: () => {
        /* The offline banner appears on its own when the network drops. */
      },
    });

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      setDismissedInstall(false);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const showInstall = !!installEvent && !installed && !dismissedInstall && !isDesktop();
  const showSyncCard = !sync.online || sync.pendingCount > 0 || sync.strandedCount > 0 || !!sync.lastError;
  const retryable = ['network_error', 'timeout', 'busy', 'server_error', 'internal_error'].includes(sync.errorCode ?? '');

  if (!showInstall && !showSyncCard && !updateReady && !sync.conflictNotice) return null;

  const pendingLabel = `${sync.pendingCount} change${sync.pendingCount === 1 ? '' : 's'}`;
  const strandedLabel = `${sync.strandedCount} change${
    sync.strandedCount === 1 ? '' : 's'
  } saved by ${sync.strandedOwner ?? 'another account'}`;

  const handleInstall = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === 'accepted') setInstalled(true);
    setInstallEvent(null);
  };

  return (
    <div className="fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] sm:inset-x-auto sm:right-5 sm:bottom-5 sm:max-w-sm z-50 flex flex-col items-stretch sm:items-end gap-2">
      {updateReady && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg flex items-start gap-3">
          <RotateCw className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-[13px] font-semibold text-slate-900">A new version is ready</p>
            <p className="text-[12px] text-slate-500 mt-0.5 leading-snug">
              Reload to get the latest updates.
            </p>
            <button
              type="button"
              onClick={() => void flushDraftSave().then(() => updateReady()).catch(() => {})}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
            >
              Reload now
            </button>
          </div>
        </div>
      )}

      {sync.conflictNotice && (
        <div className="w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-lg flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-[12px] font-medium text-amber-900 leading-snug flex-1">
            {sync.conflictNotice}
          </p>
          <button
            type="button"
            onClick={clearConflictNotice}
            title="Dismiss"
            className="text-amber-700 hover:text-amber-900 transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {showSyncCard && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg flex items-start gap-3">
          {sync.online ? (
            sync.syncing ? (
              <Loader2 className="w-4 h-4 animate-spin text-slate-400 mt-0.5 shrink-0" />
            ) : (
              <RefreshCw className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
            )
          ) : (
            <WifiOff className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-900">
              {sync.online
                ? sync.pendingCount > 0
                  ? sync.syncing
                    ? `Syncing ${pendingLabel}…`
                    : `${pendingLabel} waiting to sync`
                  : sync.lastError ? 'Saving needs attention' : `${strandedLabel} waiting to sync`
                : 'Offline — working from saved copies'}
            </p>
            <p className="text-[12px] text-slate-500 mt-0.5 leading-snug">
              {sync.errorCode === 'device_storage' ? 'The latest changes could not be saved. Keep this window open and try saving again.' : sync.online
                ? sync.pendingCount > 0
                  ? sync.lastError
                    ? retryable ? 'Changes are saved on this device. Retrying the connection automatically.' : 'Changes are saved on this device. Resolve the connection issue, then select Sync now.'
                    : 'Saving to the customer database automatically.'
                  : sync.lastError ? 'Keep this window open until your changes are saved.' : `Sign in as ${sync.strandedOwner ?? 'the account that made them'} to send them to the customer database.`
                : sync.pendingCount > 0
                  ? 'Changes are saved on this device and will sync when the connection returns.'
                  : 'You can keep editing and generating documents.'}
            </p>
            {sync.lastError && (
              <p className="text-[11px] text-rose-700 mt-1 leading-snug">Last sync error: {sync.lastError}</p>
            )}
            {sync.online && !sync.syncing && (sync.pendingCount > 0 || sync.errorCode === 'device_storage') && (
              <button
                type="button"
                onClick={() => void syncNow()}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Sync now
              </button>
            )}
          </div>
        </div>
      )}

      {showInstall && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg flex items-start gap-3">
          <Download className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-900">Install Hays + Sons</p>
            <p className="text-[12px] text-slate-500 mt-0.5 leading-snug">
              Add it to this computer — opens in its own window and works offline.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleInstall()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Install
              </button>
              <button
                type="button"
                onClick={() => setDismissedInstall(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
