import React, { useMemo, useState } from 'react';
import {
  Search,
  RefreshCw,
  FolderOpen,
  Trash2,
  Loader2,
  AlertCircle,
  Database,
  CloudOff,
  Plus,
  X,
  Upload,
} from 'lucide-react';
import type { SyncJobSummary } from '../services/localDb';

interface SavedCustomersPageProps {
  jobs: SyncJobSummary[];
  isLoading: boolean;
  error: string | null;
  search: string;
  currentRecordId?: string;
  isDatabaseConfigured: boolean;
  /** Verified email, when signed in to the database. */
  databaseEmail: string | null;
  /** True when the developer shared-secret bypass is active (no sign-in). */
  isDeveloperBypass: boolean;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onOpenJob: (recordId: string) => void;
  onDeleteJob: (job: SyncJobSummary) => void;
  onNewJob?: () => void;
  onImportCustomers?: () => void;
}

type JobSort = 'recent' | 'customer' | 'number';
const JOB_COLLATOR = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' });

function updatedTime(job: SyncJobSummary): number {
  const timestamp = Date.parse(job.updatedAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatWhen(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (isNaN(date.getTime())) return value;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const STATUS_STYLES: Record<string, string> = {
  Draft: 'bg-slate-100 text-slate-700 border-slate-200',
  Active: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  'On Hold': 'bg-amber-100 text-amber-700 border-amber-200',
  Complete: 'bg-blue-100 text-blue-700 border-blue-200',
  Cancelled: 'bg-rose-100 text-rose-700 border-rose-200',
};

/** Home page for saved jobs, including cached records waiting to sync. */
export const SavedCustomersPage: React.FC<SavedCustomersPageProps> = ({
  jobs,
  isLoading,
  error,
  search,
  currentRecordId,
  isDatabaseConfigured,
  databaseEmail,
  isDeveloperBypass,
  onSearchChange,
  onRefresh,
  onOpenJob,
  onDeleteJob,
  onNewJob,
  onImportCustomers,
}) => {
  const [sort, setSort] = useState<JobSort>('recent');
  const query = search.trim().toLowerCase();
  const visible = useMemo(() => {
    const matching = query
      ? jobs.filter((job) =>
          [job.jobNumber, job.jobName, job.customerName, job.email, job.lossAddress, job.carrier, job.claimNumber]
            .join(' ')
            .toLowerCase()
            .includes(query)
        )
      : [...jobs];

    return matching.sort((a, b) => {
      if (sort === 'customer') {
        return JOB_COLLATOR.compare(a.customerName || 'Unnamed customer', b.customerName || 'Unnamed customer')
          || updatedTime(b) - updatedTime(a);
      }
      if (sort === 'number') {
        if (!a.jobNumber && b.jobNumber) return 1;
        if (a.jobNumber && !b.jobNumber) return -1;
        return JOB_COLLATOR.compare(a.jobNumber, b.jobNumber) || updatedTime(b) - updatedTime(a);
      }
      return updatedTime(b) - updatedTime(a);
    });
  }, [jobs, query, sort]);

  return (
    <section className="bg-white rounded-xl border border-slate-200" aria-label="Jobs">
      {/* Page header */}
      <div className="px-3 sm:px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="shrink-0 p-2.5 rounded-lg bg-red-50 text-red-600">
            <FolderOpen className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900 tracking-tight">
              Jobs
            </h2>
            <p className="mt-0.5 text-sm text-slate-500 break-words">
              {isDatabaseConfigured
                ? databaseEmail
                  ? `Signed in as ${databaseEmail}`
                  : 'Find a saved job and pick up where you left off.'
                : 'Connect your job library to save and sync jobs.'}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
          <span className="text-sm text-slate-500">
            {isDatabaseConfigured
              ? `${jobs.length} saved job${jobs.length === 1 ? '' : 's'}`
              : 'Not connected'}
          </span>
          {onNewJob && (
            <button
              type="button"
              onClick={onNewJob}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New job
            </button>
          )}
          {onImportCustomers && (
            <button type="button" onClick={onImportCustomers} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600">
              <Upload className="h-4 w-4" aria-hidden /> Upload customer CSV
            </button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-3 sm:px-5 py-3 border-b border-slate-100 flex flex-col lg:flex-row lg:items-end gap-3">
        <div className="relative flex-1">
          <label htmlFor="saved-jobs-search" className="mb-1.5 block text-xs font-semibold text-slate-600">
            Search jobs
          </label>
          <span className="absolute bottom-0 left-0 h-11 pl-3 flex items-center pointer-events-none text-slate-400">
            <Search className="w-4 h-4" aria-hidden="true" />
          </span>
          <input
            id="saved-jobs-search"
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Customer, job number, address or claim…"
            className="min-h-11 w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
          />
        </div>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 lg:w-44">
            <label htmlFor="saved-jobs-sort" className="mb-1.5 block text-xs font-semibold text-slate-600">
              Sort by
            </label>
            <select
              id="saved-jobs-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as JobSort)}
              className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
            >
              <option value="recent">Recent update</option>
              <option value="customer">Customer A–Z</option>
              <option value="number">Job number</option>
            </select>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading || !isDatabaseConfigured}
            className="inline-flex min-h-11 items-center justify-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
            )}
            {isLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-3 sm:px-5 py-4 min-h-[240px]">
        {!isDatabaseConfigured && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <CloudOff className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed">
              <p className="font-bold">Your job library is not connected yet.</p>
              <p className="mt-1">
                Deploy <code className="font-mono">apps-script/Code.gs</code> (see{' '}
                <code className="font-mono">apps-script/README.md</code>), then add{' '}
                <code className="font-mono">VITE_APPS_SCRIPT_URL</code> and{' '}
                <code className="font-mono">VITE_GOOGLE_CLIENT_ID</code> to{' '}
                <code className="font-mono">.env.local</code> and restart the dev server.
              </p>
            </div>
          </div>
        )}

        {isDatabaseConfigured && isDeveloperBypass && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-[13px] font-semibold text-amber-900">Developer mode</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-amber-800">
              Sign-in is bypassed with a shared secret. Anyone holding the web-app URL and this secret
              has full access — remove <code className="font-mono">VITE_DEV_SHARED_SECRET</code> and the
              Apps Script <code className="font-mono">SHARED_SECRET</code> property before going live.
            </p>
          </div>
        )}

        {isDatabaseConfigured && error && (
          <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-900">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <p className="text-xs font-medium leading-relaxed">{error}</p>
          </div>
        )}

        {isDatabaseConfigured && isLoading && jobs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-14 text-slate-500" role="status">
            <Loader2 className="w-6 h-6 animate-spin text-red-600" />
            <p className="mt-3 text-sm font-semibold">Loading saved jobs…</p>
          </div>
        )}

        {isDatabaseConfigured && !isLoading && !error && visible.length === 0 && (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <div className="p-3 rounded-2xl bg-slate-100 text-slate-400">
              <Database className="w-6 h-6" />
            </div>
            <p className="mt-3 text-sm font-bold text-slate-800">
              {jobs.length === 0 ? 'No saved jobs yet' : 'No matches'}
            </p>
            <p className="mt-1 text-sm text-slate-500 max-w-sm">
              {jobs.length === 0
                ? 'Start a job, add the customer details, and save it here for later.'
                : 'Try another customer, address or job number.'}
            </p>
            {jobs.length === 0 && onNewJob ? (
              <button
                type="button"
                onClick={onNewJob}
                className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                New job
              </button>
            ) : jobs.length > 0 && query ? (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Clear search
              </button>
            ) : null}
          </div>
        )}

        {visible.length > 0 && (
          <ul className="space-y-2">
            {visible.map((job) => {
              const isCurrent = !!currentRecordId && job.recordId === currentRecordId;
              return (
                <li
                  key={job.recordId}
                  aria-current={isCurrent ? 'true' : undefined}
                  className={`rounded-xl border p-3.5 transition ${
                    isCurrent
                      ? 'border-red-300 bg-red-50/40'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="min-w-0 max-w-full font-semibold text-base text-slate-900 break-words">
                          {job.customerName || 'Unnamed customer'}
                        </span>
                        <span className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded">
                          {job.jobNumber ? `Job ${job.jobNumber}` : 'No job number'}
                        </span>
                        {job.status && (
                          <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded border ${
                              STATUS_STYLES[job.status] ?? 'bg-slate-100 text-slate-700 border-slate-200'
                            }`}
                          >
                            {job.status}
                          </span>
                        )}
                        {job.syncState === 'pending-save' && (
                          <span
                            title="Saved on this device — waiting to sync to the database"
                            className="text-xs font-semibold px-2 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700"
                          >
                            Pending sync
                          </span>
                        )}
                        {isCurrent && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded border border-red-300 bg-white text-red-700">
                            Open now
                          </span>
                        )}
                      </div>
                      {job.jobName && (
                        <p className="mt-1 text-sm font-medium text-slate-700 break-words">{job.jobName}</p>
                      )}
                      <p className="mt-1 text-sm text-slate-600 break-words">
                        {job.lossAddress || 'No loss address'}
                        {job.carrier ? ` • ${job.carrier}` : ''}
                        {job.claimNumber ? ` • Claim ${job.claimNumber}` : ''}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 break-words">
                        Updated {formatWhen(job.updatedAt)}
                        {job.updatedBy ? ` by ${job.updatedBy}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onOpenJob(job.recordId)}
                        aria-label={`${isCurrent ? 'Continue editing' : 'Open job'} ${job.jobNumber || job.customerName || 'unnamed job'}`}
                        className="inline-flex min-h-11 flex-1 sm:flex-none items-center justify-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
                      >
                        <FolderOpen className="w-4 h-4" aria-hidden="true" />
                        {isCurrent ? 'Continue editing' : 'Open job'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteJob(job)}
                        aria-label={`Delete job ${job.jobNumber || job.customerName || 'unnamed job'}`}
                        className="inline-flex min-h-11 items-center justify-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-lg border border-rose-200 text-rose-700 bg-white hover:bg-rose-50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 sm:px-5 py-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs text-slate-500">
        <span role="status" aria-live="polite">
          {isDatabaseConfigured
            ? `${visible.length} of ${jobs.length} saved job${jobs.length === 1 ? '' : 's'}`
            : 'Not connected'}
        </span>
        <span>Open a job to review details and prepare documents.</span>
      </div>
    </section>
  );
};
