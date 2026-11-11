import React, { useRef, useState } from 'react';
import {
  Database,
  Save,
  Loader2,
  Plus,
  LogOut,
  ChevronDown,
  Cloud,
  AlertCircle,
  Check,
  UserCircle,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';

interface NavbarProps {
  jobNumber: string;
  customerName: string;
  onReset: () => void;
  /** Unsaved changes exist. */
  isDirty: boolean;
  isSavingJob: boolean;
  savedJobsCount: number;
  /** Email verified by the customer database, when signed in. */
  databaseEmail: string | null;
  isDatabaseConfigured: boolean;
  /** True when the developer shared-secret bypass is active (no sign-in). */
  isDeveloperBypass: boolean;
  onSaveJob: () => void;
  /** Opens the saved jobs library. */
  onOpenSavedCustomers: () => void;
  /** Signs the application user out of the database session. */
  onSignOut: () => void;
  /** Records queued locally that still need to reach the database. */
  pendingSyncCount?: number;
  /** True while the device has no connectivity. */
  isOffline?: boolean;
  draftStatus?: 'idle' | 'saving' | 'saved' | 'error';
  isSyncing?: boolean;
}

const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:opacity-45 disabled:cursor-not-allowed';

export const Navbar: React.FC<NavbarProps> = ({
  jobNumber,
  customerName,
  onReset,
  isDirty,
  isSavingJob,
  savedJobsCount,
  databaseEmail,
  isDatabaseConfigured,
  isDeveloperBypass,
  onSaveJob,
  onOpenSavedCustomers,
  onSignOut,
  pendingSyncCount = 0,
  isOffline = false,
  draftStatus = 'idle',
  isSyncing = false,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const hasCustomer = Boolean(customerName.trim());

  const saveTitle = !isDatabaseConfigured
    ? 'Connect the job database to save this job'
    : isDirty
    ? 'Save changes to the customer database'
    : 'Saved — save again to overwrite';

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 pt-safe">
      <div className="max-w-[1400px] mx-auto px-3 sm:px-5">
        <div className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-2 lg:gap-4 min-h-16 py-2 lg:py-0">
          {/* Brand */}
          <BrandLogo
            size={34}
            sublabel="Restoration Document Suite"
            sublabelClassName="hidden sm:block"
          />

          {/* Job context */}
          <div className="hidden xl:flex items-center gap-2 min-w-0 rounded-lg border border-slate-200 bg-slate-50/80 px-3 h-9">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                hasCustomer ? (isDirty ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-slate-300'
              }`}
              aria-hidden
            />
            <span className="text-[13px] font-medium text-slate-900 truncate max-w-[220px]">
              {hasCustomer ? customerName : 'New job'}
            </span>
            <span className="text-slate-300 select-none">·</span>
            <span className="text-[12px] text-slate-500 tabular-nums truncate">
              {jobNumber || 'no job #'}
            </span>
            {isDirty && (
              <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                Unsaved
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="flex w-full lg:w-auto items-center justify-end gap-1.5 sm:gap-2 shrink-0">
            {(isOffline || pendingSyncCount > 0 || draftStatus !== 'idle') && (
              <span
                title={
                  isOffline
                    ? 'Offline — changes are saved on this device and sync automatically'
                    : `${pendingSyncCount} change${pendingSyncCount === 1 ? '' : 's'} waiting to sync`
                }
                role="status"
                aria-live="polite"
                className={`hidden sm:inline-flex mr-auto lg:mr-0 items-center gap-1.5 h-9 px-2.5 rounded-lg border text-[11px] font-semibold ${draftStatus === 'error' ? 'border-red-200 bg-red-50 text-red-700' : isOffline || pendingSyncCount > 0 ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}
              >
                {isSyncing || draftStatus === 'saving' ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> : <Check className="w-3 h-3" aria-hidden />}
                {draftStatus === 'error' ? 'Autosave needs attention' : draftStatus === 'saving' ? 'Saving draft…' : isOffline ? 'Saved on device' : isSyncing ? 'Syncing…' : pendingSyncCount > 0 ? 'Saved on device' : 'Draft synced'}
              </span>
            )}
            <button
              type="button"
              onClick={onOpenSavedCustomers}
              aria-label="Open saved jobs"
              title={databaseEmail ? `Saved jobs — signed in as ${databaseEmail}` : 'Open saved jobs'}
              className={`${BTN_BASE} min-h-11 px-2 sm:px-3 border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900`}
            >
              <Database className="w-4 h-4 text-slate-400" aria-hidden />
              <span>Jobs</span>
              {savedJobsCount > 0 && (
                <span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded bg-slate-200 text-slate-700 text-[11px] font-bold flex items-center justify-center tabular-nums">
                  {savedJobsCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={onReset}
              title="Start a new job"
              className={`${BTN_BASE} min-h-11 px-2 sm:px-3 border border-slate-300 text-slate-700 hover:bg-slate-50 hover:text-slate-900`}
            >
              <Plus className="w-4 h-4" aria-hidden />
              <span>New job</span>
            </button>

            <button
              type="button"
              onClick={onSaveJob}
              disabled={isSavingJob || !isDatabaseConfigured}
              title={saveTitle}
              className={`${BTN_BASE} min-h-11 px-2.5 sm:px-3.5 bg-red-600 text-white hover:bg-red-700 shadow-sm`}
            >
              {isSavingJob ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              ) : isDirty ? (
                <Save className="w-4 h-4" aria-hidden />
              ) : (
                <Check className="w-4 h-4" aria-hidden />
              )}
              <span>{isSavingJob ? 'Saving…' : 'Save job'}</span>
            </button>

            {/* Account and integrations */}
            <div
              className="relative"
              onKeyDown={(event) => {
                if (event.key === 'Escape' && isMenuOpen) {
                  setIsMenuOpen(false);
                  accountButtonRef.current?.focus();
                }
              }}
            >
              <button
                ref={accountButtonRef}
                type="button"
                onClick={() => setIsMenuOpen((open) => !open)}
                title="Account and connections"
                aria-label="Account and connections"
                aria-controls="account-panel"
                aria-expanded={isMenuOpen}
                className={`${BTN_BASE} min-h-11 min-w-11 px-2 border border-slate-200 text-slate-600 hover:bg-slate-50`}
              >
                <UserCircle className="w-4 h-4" aria-hidden />
                <span className="hidden 2xl:inline">Account</span>
                <ChevronDown className={`hidden 2xl:block w-3 h-3 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} aria-hidden />
              </button>

              {isMenuOpen && (
                <>
                  <button
                    type="button"
                    aria-hidden
                    tabIndex={-1}
                    onClick={() => setIsMenuOpen(false)}
                    className="fixed inset-0 z-40 cursor-default"
                  />
                  <div id="account-panel" className="absolute right-0 top-12 z-50 w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
                    {/* Connection status */}
                    <div className="px-3.5 py-3 border-b border-slate-100">
                      <div className="flex items-start gap-2.5">
                        {isDatabaseConfigured ? (
                          <span
                            className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                              isDeveloperBypass ? 'bg-amber-500' : 'bg-emerald-500'
                            }`}
                          />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-slate-900">
                            {isDatabaseConfigured ? 'Google Apps Script connected' : 'Google Apps Script not connected'}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">
                            {isDeveloperBypass
                              ? 'Developer mode — sign-in bypassed'
                              : databaseEmail || (isDatabaseConfigured ? 'Not signed in' : 'Ask your administrator to connect the database')}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Shared backend storage */}
                    <div className="px-3.5 py-3 border-b border-slate-100">
                      <div className="flex items-start gap-2.5">
                        <Cloud className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-slate-900">Shared Drive &amp; job database</p>
                          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">Documents and job records use this account through the app's Google Apps Script backend.</p>
                        </div>
                      </div>
                    </div>

                    {/* Application sign out */}
                    {databaseEmail && !isDeveloperBypass && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsMenuOpen(false);
                          onSignOut();
                        }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-3 text-left hover:bg-slate-50 transition-colors border-t border-slate-100"
                      >
                        <LogOut className="w-4 h-4 text-slate-400" />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold text-slate-900">Sign out</span>
                          <span className="block text-[11px] text-slate-500 truncate">
                            {databaseEmail}
                          </span>
                        </span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
