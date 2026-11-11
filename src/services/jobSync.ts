/**
 * Offline-first sync engine for the customer database (Apps Script).
 *
 * Everything the UI reads or writes goes through here:
 *  - reads  — served instantly from the IndexedDB mirror, refreshed from the
 *             server in the background; falls back to the mirror when offline.
 *  - writes — applied to the mirror immediately and queued in an outbox that
 *             replays to the backend when connectivity returns (last write
 *             wins; the user is told when the server copy moved underneath).
 *
 * The engine works identically in the browser (with the service worker's
 * Background Sync as an extra trigger) and in the Electron desktop shell
 * (which has no service worker — flush happens on start / online / interval).
 */
import {
  acquireAuthContext,
  deleteJob,
  fetchDraft,
  getCurrentUser,
  getJob,
  isDatabaseConfigured,
  isDeveloperBypassEnabled,
  listJobs,
  saveDraft,
  saveJob,
  DatabaseError,
  type AuthContext,
  type JobSummary,
} from './appsScriptService';
import {
  getAllMirrorJobs,
  getDraft,
  getMirrorJob,
  getOutboxOps,
  outboxOpIsMine,
  queueDraftOutbox,
  summarizeOutbox,
  updateOutboxOp,
  persistJobAndOutbox,
  persistDraftAndOutbox,
  reopenDeviceDatabase,
  completeOutboxOp,
  cacheServerMirrorJob,
  deleteSyncedMirrorJob,
  cacheServerDraft,
  type MirrorJob,
  type OutboxOp,
  type SyncJobSummary,
  type WorkspaceDraft,
} from './localDb';
import { createRecordId, type RestorationJobData } from '../types/jobData';
import { requestOutboxSync } from './pwa';
import { pushWorkspaceOperation, notifyWorkspace } from './jobWorkspaceService';

export interface SyncState {
  online: boolean;
  pendingCount: number;
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Transient message shown when a server copy changed underneath a local edit. */
  conflictNotice: string | null;
  /** Queued writes on this device that belong to a different account. */
  strandedCount: number;
  /** The account those stranded writes belong to, when it can be determined. */
  strandedOwner: string | null;
  draftStatus: 'idle' | 'saving' | 'saved' | 'error';
  lastDraftSavedAt: number | null;
  nextRetryAt: number | null;
  errorCode: string | null;
}

const NETWORK_ERROR_CODES = new Set(['network_error', 'timeout', 'busy', 'server_error', 'internal_error']);

function isNetworkish(err: unknown): boolean {
  return err instanceof DatabaseError && NETWORK_ERROR_CODES.has(err.code);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The account whose local edits this session may read and replay.
 *
 * Local mirrors and the outbox are per-account: on a shared machine one person
 * must never see - or publish - another person's unsaved work. Rows that are
 * fully synced carry no owner, because they are only a cache of the shared
 * server data that every account is entitled to.
 */
function currentOwner(): string | null {
  if (isDeveloperBypassEnabled()) return 'dev';
  const user = getCurrentUser();
  return user?.email ? user.email.toLowerCase() : null;
}

/** True when a locally queued row was written by somebody else's account. */
function ownedByOther(owner: string | undefined, mine: string | null): boolean {
  return !!owner && owner !== mine;
}

/** Keeps the sync badge in step with what this account can actually flush. */
async function refreshPendingState(): Promise<void> {
  const summary = await summarizeOutbox(currentOwner());
  patchState({
    pendingCount: summary.mine,
    strandedCount: summary.stranded,
    strandedOwner: summary.strandedOwner,
  });
}

// ---- state (tiny pub/sub for the UI) --------------------------------------

let state: SyncState = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  pendingCount: 0,
  syncing: false,
  lastSyncAt: null,
  lastError: null,
  conflictNotice: null,
  strandedCount: 0,
  strandedOwner: null,
  draftStatus: 'idle',
  lastDraftSavedAt: null,
  nextRetryAt: null,
  errorCode: null,
};

const listeners = new Set<(next: SyncState) => void>();

function patchState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  for (const listener of [...listeners]) listener(state);
}

export function subscribeSyncState(listener: (next: SyncState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSyncState(): SyncState {
  return state;
}

let conflictTimer: number | null = null;

function noticeConflict(message: string) {
  patchState({ conflictNotice: message });
  if (conflictTimer) window.clearTimeout(conflictTimer);
  conflictTimer = window.setTimeout(() => patchState({ conflictNotice: null }), 8000);
}

export function clearConflictNotice() {
  if (conflictTimer) window.clearTimeout(conflictTimer);
  patchState({ conflictNotice: null });
}

// ---- summary helpers ------------------------------------------------------

function summaryFromRecord(record: RestorationJobData, prior?: JobSummary | null): JobSummary {
  return {
    recordId: record.recordId ?? prior?.recordId ?? '',
    jobNumber: record.customer?.jobNumber || prior?.jobNumber || '',
    jobName: record.customer?.jobName || prior?.jobName || '',
    customerName: record.customer?.customerName || prior?.customerName || '',
    email: record.customer?.email || prior?.email || '',
    mobilePhone: record.customer?.mobilePhone || prior?.mobilePhone || '',
    lossAddress: record.customer?.lossAddress || prior?.lossAddress || '',
    carrier: record.insurance?.carrier || prior?.carrier || '',
    claimNumber: record.insurance?.claimNumber || prior?.claimNumber || '',
    status: prior?.status || 'Draft',
    createdAt: prior?.createdAt || record.dateCreated || new Date().toISOString(),
    updatedAt: prior?.updatedAt || '',
    updatedBy: prior?.updatedBy || '',
    schemaVersion: prior?.schemaVersion ?? record.schemaVersion ?? 0,
    deleted: false,
  };
}

function stripRecord(job: JobSummary): JobSummary {
  const { record: _record, ...summary } = job;
  return summary;
}

/** Fill blank server columns from the cached record (older backends leave them empty). */
function displaySummary(server: JobSummary, record: RestorationJobData | null): JobSummary {
  const base = stripRecord(server);
  if (!record) return base;
  const derived = summaryFromRecord(record, base);
  return {
    ...base,
    jobNumber: base.jobNumber || derived.jobNumber,
    jobName: base.jobName || derived.jobName,
    customerName: base.customerName || derived.customerName,
    email: base.email || derived.email,
    mobilePhone: base.mobilePhone || derived.mobilePhone,
    lossAddress: base.lossAddress || derived.lossAddress,
    carrier: base.carrier || derived.carrier,
    claimNumber: base.claimNumber || derived.claimNumber,
  };
}

// ---- reads ----------------------------------------------------------------

/** Instantly available summaries from the local mirror (no network). */
export async function readCachedJobSummaries(): Promise<SyncJobSummary[]> {
  const owner = currentOwner();
  const all = await getAllMirrorJobs();
  return all
    .filter((row) => row.syncState !== 'pending-delete')
    .filter((row) => row.syncState === 'synced' || !ownedByOther(row.owner, owner))
    .map((row) => ({
      ...(row.record ? summaryFromRecord(row.record, row.summary) : row.summary),
      syncState: row.syncState,
    }))
    .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
}

export interface RefreshJobsResult {
  jobs: SyncJobSummary[];
  fromCache: boolean;
  error?: string;
}

/** Server refresh with mirror fallback. Never throws. */
export async function refreshJobs(): Promise<RefreshJobsResult> {
  if (!state.online) return { jobs: await readCachedJobSummaries(), fromCache: true };
  if (!isDatabaseConfigured()) {
    return {
      jobs: await readCachedJobSummaries(),
      fromCache: true,
      error: 'The customer database is not connected yet.',
    };
  }
  try {
    const auth = await acquireAuthContext();
    if (state.pendingCount > 0) void flushOutboxNow(false);
    const readStartedAt = Date.now();
    const { jobs } = await listJobs(auth, { fullRecords: true });
    const merged = await mergeServerList(jobs, readStartedAt);
    patchState({
      lastSyncAt: new Date().toISOString(),
      ...(state.pendingCount === 0 && state.errorCode !== 'device_storage' ? { lastError: null, errorCode: null } : {}),
    });
    await refreshPendingState();
    return { jobs: merged, fromCache: false };
  } catch (err) {
    const cached = await readCachedJobSummaries();
    if (isNetworkish(err)) {
      if (cached.length) return { jobs: cached, fromCache: true };
      return { jobs: [], fromCache: true, error: 'Offline — no saved copies on this device yet.' };
    }
    return { jobs: cached, fromCache: cached.length > 0, error: errorMessage(err) };
  }
}

async function mergeServerList(serverJobs: JobSummary[], readStartedAt: number): Promise<SyncJobSummary[]> {
  const owner = currentOwner();
  const mirror = await getAllMirrorJobs();
  const byId = new Map(mirror.map((row) => [row.recordId, row]));
  const seen = new Set<string>();
  const conflicts: string[] = [];
  const results: SyncJobSummary[] = [];

  for (const job of serverJobs) {
    seen.add(job.recordId);
    const local = byId.get(job.recordId);

    // Another account has unsynced edits for this record. Leave its row exactly
    // as it is - that person will publish it - and show the server copy here.
    if (local && local.syncState !== 'synced' && ownedByOther(local.owner, owner)) {
      results.push({ ...stripRecord(job), syncState: 'synced' });
      continue;
    }

    if (!local) {
      const next = await cacheServerMirrorJob({
        recordId: job.recordId,
        summary: stripRecord(job),
        record: job.record ?? null,
        syncState: 'synced',
        baseUpdatedAt: job.updatedAt || null,
        locallyUpdatedAt: new Date().toISOString(),
      }, readStartedAt);
      if (ownedByOther(next.owner, owner)) results.push({ ...stripRecord(job), syncState: 'synced' });
      else if (next.syncState !== 'pending-delete') results.push({ ...displaySummary(next.summary, next.record), syncState: next.syncState });
      continue;
    }

    if (local.syncState === 'synced') {
      const next = await cacheServerMirrorJob({
        ...local,
        summary: stripRecord(job),
        record: job.record ?? local.record,
        baseUpdatedAt: job.updatedAt || local.baseUpdatedAt,
        locallyUpdatedAt: new Date().toISOString(),
      }, readStartedAt);
      if (ownedByOther(next.owner, owner)) results.push({ ...stripRecord(job), syncState: 'synced' });
      else if (next.syncState !== 'pending-delete') results.push({ ...displaySummary(next.summary, next.record), syncState: next.syncState });
      continue;
    }

    if (local.syncState === 'pending-delete') {
      // Hidden until the delete syncs; ignore the server copy (no resurrection).
      continue;
    }

    // pending-save: keep the local copy; flag if the server moved since our base.
    if (local.baseUpdatedAt && job.updatedAt && job.updatedAt > local.baseUpdatedAt) {
      conflicts.push(job.jobNumber || local.summary.jobNumber || 'a record');
    }
    const derived = local.record ? summaryFromRecord(local.record, local.summary) : local.summary;
    results.push({ ...derived, syncState: 'pending-save' });
  }

  for (const row of mirror) {
    if (seen.has(row.recordId)) continue;
    if (row.syncState === 'synced') {
      if (Date.parse(row.locallyUpdatedAt) > readStartedAt) {
        results.push({ ...displaySummary(row.summary, row.record), syncState: 'synced' });
        continue;
      }
      // Gone from the server (deleted elsewhere) — drop the stale mirror row.
      await deleteSyncedMirrorJob(row.recordId, readStartedAt);
      continue;
    }
    if (row.syncState === 'pending-save' && !ownedByOther(row.owner, owner)) {
      results.push({
        ...(row.record ? summaryFromRecord(row.record, row.summary) : row.summary),
        syncState: 'pending-save',
      });
    }
  }

  if (conflicts.length) {
    noticeConflict(
      `${conflicts.join(', ')} changed on the server while you had unsaved edits. ` +
        `Syncing will overwrite — open the record to review.`
    );
  }
  return results;
}

export interface LoadedJob {
  job: RestorationJobData;
  fromCache: boolean;
}

/** Opens one record: local copy wins when it has unsynced edits; else server-first. */
export async function loadJobOffline(recordId: string): Promise<LoadedJob> {
  const owner = currentOwner();
  const mirror = await getMirrorJob(recordId);
  // Another account's unsynced copy is off limits: fall through to the server.
  const cached = mirror && !ownedByOther(mirror.owner, owner) ? mirror : undefined;

  if (cached && cached.syncState !== 'synced' && cached.record) {
    return { job: cached.record, fromCache: true };
  }
  try {
    const auth = await acquireAuthContext();
    const readStartedAt = Date.now();
    const result = await getJob(auth, { recordId });
    const stored = await cacheServerMirrorJob({
      recordId,
      summary: summaryFromRecord(result.job, cached?.summary ?? null),
      record: result.job,
      syncState: 'synced',
      baseUpdatedAt: result.updatedAt || cached?.summary?.updatedAt || null,
      locallyUpdatedAt: new Date().toISOString(),
    }, readStartedAt);
    return stored.record && !ownedByOther(stored.owner, owner)
      ? { job: stored.record, fromCache: stored.syncState !== 'synced' }
      : { job: result.job, fromCache: false };
  } catch (err) {
    if (isNetworkish(err) && cached?.record) {
      return { job: cached.record, fromCache: true };
    }
    throw err;
  }
}

// ---- writes ---------------------------------------------------------------

export interface SaveJobOutcome {
  record: RestorationJobData;
  recordId: string;
  created: boolean;
  /** True when the write is queued locally and will sync later. */
  queued: boolean;
}

/** Saves a job through the mirror + outbox. Never loses the edit when offline. */
export async function saveJobOffline(job: RestorationJobData): Promise<SaveJobOutcome> {
  const owner = currentOwner();
  if (!owner) throw new DatabaseError('Sign in to save this job.', 'no_session');
  if (getCurrentUser()?.role === 'viewer') throw new DatabaseError('Your account has read-only access.', 'forbidden');
  const recordId = job.recordId || createRecordId();
  const record: RestorationJobData = { ...job, recordId };
  const existing = await getMirrorJob(recordId);
  const created = !existing;

  await persistJobAndOutbox({
    recordId,
    summary: summaryFromRecord(record, existing?.summary ?? null),
    record,
    syncState: 'pending-save',
    baseUpdatedAt: existing?.baseUpdatedAt ?? existing?.summary?.updatedAt ?? null,
    locallyUpdatedAt: new Date().toISOString(),
    owner: owner ?? undefined,
  }, {
    type: 'save',
    recordId,
    job: record,
    createdAt: Date.now(),
    attempts: 0,
    owner: owner ?? undefined,
  });
  await refreshPendingState();

  if (state.online) void flushOutboxNow(false);
  else void requestOutboxSync();

  return {
    record,
    recordId,
    created,
    queued: true,
  };
}

export interface DeleteJobOutcome {
  queued: boolean;
}

/** Deletes a job through the mirror + outbox (soft delete server-side). */
export async function deleteJobOffline(recordId: string): Promise<DeleteJobOutcome> {
  const owner = currentOwner();
  if (!owner) throw new DatabaseError('Sign in to delete this job.', 'no_session');
  if (getCurrentUser()?.role === 'viewer') throw new DatabaseError('Your account has read-only access.', 'forbidden');
  const existing = await getMirrorJob(recordId);
  let mirror: MirrorJob;
  if (!existing) {
    // Not in the mirror — still queue the delete so the server converges.
    mirror = {
      recordId,
      summary: summaryFromRecord({ recordId } as RestorationJobData, null),
      record: null,
      syncState: 'pending-delete',
      baseUpdatedAt: null,
      locallyUpdatedAt: new Date().toISOString(),
      owner: owner ?? undefined,
    };
  } else {
    mirror = {
      ...existing,
      syncState: 'pending-delete',
      locallyUpdatedAt: new Date().toISOString(),
      owner: owner ?? undefined,
    };
  }
  await persistJobAndOutbox(mirror, {
    type: 'delete',
    recordId,
    createdAt: Date.now(),
    attempts: 0,
    owner: owner ?? undefined,
  });
  await refreshPendingState();

  if (state.online) void flushOutboxNow(false);
  else void requestOutboxSync();

  return { queued: true };
}

// ---- outbox flush ---------------------------------------------------------

let flushPromise: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;

function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  const delay = Math.min(60_000, 2000 * 2 ** Math.min(failures++, 5));
  const jitter = Math.floor(Math.random() * 500);
  patchState({ nextRetryAt: Date.now() + delay + jitter });
  retryTimer = setTimeout(() => { retryTimer = null; void flushOutboxNow(false); }, delay + jitter);
}

/** Replays the outbox to the Apps Script backend. Re-entrant calls share one run. */
export function flushOutboxNow(force = true): Promise<void> {
  if (!state.online || (!force && state.nextRetryAt && Date.now() < state.nextRetryAt)) return Promise.resolve();
  if (!flushPromise) {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    patchState({ nextRetryAt: null });
    // Web Locks serializes replay across tabs, where available.
    const run = () => doFlush();
    const pending = typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('hays-database-sync', run) : run();
    flushPromise = pending.catch((err) => {
      const code = err instanceof DatabaseError ? err.code : 'device_storage';
      patchState({ lastError: errorMessage(err), errorCode: code });
      if (NETWORK_ERROR_CODES.has(code)) scheduleRetry();
    }).finally(() => {
      flushPromise = null;
    });
  }
  return flushPromise;
}

export async function syncNow(): Promise<void> {
  try {
    await flushDraftSave();
    await flushOutboxNow();
  } catch (err) { reportDraftError(err); }
}

async function doFlush(): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const owner = currentOwner();
  // Only this account's writes are replayed. Anything queued by a different
  // account on this device stays put until that person signs in, so nobody ever
  // publishes - or is credited with - somebody else's edit.
  const ops = (await getOutboxOps()).filter((op) => outboxOpIsMine(op, owner))
    .sort((a, b) => Number(a.type === 'draft') - Number(b.type === 'draft') || (a.id ?? 0) - (b.id ?? 0));
  if (ops.length === 0) {
    await refreshPendingState();
    return;
  }

  let auth: AuthContext;
  try {
    auth = await acquireAuthContext();
  } catch {
    // Signed out — keep the queue; it flushes after the next sign-in.
    return;
  }

  patchState({ syncing: true });
  let conflictLine: string | null = null;
  let hadFailure = false;
  let publishedAny = false;

  try {
    const needsBaseCheck = ops.some((op) => op.type === 'save' && op.recordId);
    let serverRows: Map<string, JobSummary> | null = null;
    if (needsBaseCheck && (await Promise.all(ops.filter(op => op.type === 'save').map(op => getMirrorJob(op.recordId)))).some(row => row?.baseUpdatedAt)) {
      try {
        const { jobs } = await listJobs(auth);
        serverRows = new Map(jobs.map((job) => [job.recordId, job]));
      } catch {
        serverRows = null; // conflict check is best-effort
      }
    }

    for (const op of ops) {
      if (currentOwner() !== owner || !state.online) return;
      // A replaced draft has a new operation ID; do not send the stale snapshot.
      if (!(await getOutboxOps()).some(item => item.id === op.id)) continue;
      if (op.type === 'workspace' && ops.some(earlier => earlier.type === 'workspace' && earlier.id! <= op.id! && earlier.mutation?.id === op.mutation?.id && earlier.recordId === op.recordId && earlier.errorCode)) { hadFailure = true; continue; }
      const mirror = await getMirrorJob(op.recordId);
      try {
        let published = true;
        if (op.type === 'workspace' && op.mutation) {
          await pushWorkspaceOperation(op);
        } else if (op.type === 'draft' && op.draft) {
          published = await pushDraft(auth, op);
        } else if (op.type === 'save' && op.job) {
          const serverRow = serverRows?.get(op.recordId);
          if (
            mirror?.baseUpdatedAt &&
            serverRow?.updatedAt &&
            serverRow.updatedAt > mirror.baseUpdatedAt
          ) {
            const actor =
              serverRow.updatedBy && serverRow.updatedBy !== getCurrentUser()?.email
                ? ` by ${serverRow.updatedBy}`
                : '';
            conflictLine = `${serverRow.jobNumber || op.job.customer?.jobNumber || 'A record'} was changed${actor} after your last download`;
          }
          const result = await saveJob(auth, op.job);
          await applyServerSave(op, result.record);
        } else if (op.type === 'delete') {
          await deleteJob(auth, op.recordId);
          await completeOutboxOp(op);
        } else {
          throw new DatabaseError('A queued change is incomplete. Keep this device copy and save the job again.', 'invalid_operation');
        }
        if (published) {
          publishedAny = true;
        }
        await refreshPendingState();
      } catch (err) {
        if (isNetworkish(err)) {
          await updateOutboxOp({ ...op, attempts: op.attempts + 1, lastError: errorMessage(err) });
          patchState({ lastError: errorMessage(err) });
          throw err; // stop this run; retry on the next trigger
        }
        if (err instanceof DatabaseError && err.code === 'not_found' && op.type !== 'draft' && op.type !== 'workspace') {
          // The server no longer has this record — clear local traces and move on.
          if (op.type === 'delete') await completeOutboxOp(op);
          else throw err;
          await refreshPendingState();
          continue;
        }
        if (op.type === 'draft' && err instanceof DatabaseError && err.code === 'unknown_action') {
          hadFailure = true;
          patchState({ lastError: 'Cloud draft backup needs the updated Apps Script deployment. Your draft is saved on this device.', errorCode: 'unknown_action' });
          continue;
        }
        // Rejected write (role, validation, …): keep it queued, report, continue.
        hadFailure = true;
        op.errorCode = err instanceof DatabaseError ? err.code : 'device_storage';
        await updateOutboxOp({ ...op, attempts: op.attempts + 1, lastError: errorMessage(err) });
        if (op.type === 'workspace') notifyWorkspace();
        patchState({ lastError: errorMessage(err), errorCode: err instanceof DatabaseError ? err.code : 'device_storage' });
        // An invalid deployment response affects every operation. Keep the rest
        // queued rather than sending more writes without acknowledgements.
        if (err instanceof DatabaseError && ['bad_response', 'session_expired', 'unauthenticated', 'unauthorized', 'forbidden'].includes(err.code)) return;
      }
    }

    if (publishedAny) patchState({ lastSyncAt: new Date().toISOString() });
    if (!hadFailure && state.errorCode !== 'device_storage') {
      failures = 0;
      patchState({ lastError: null, errorCode: null, nextRetryAt: null });
      // Drain writes added during this request promptly, after releasing this run.
      if (state.pendingCount > 0) setTimeout(() => void flushOutboxNow(false), 0);
    }
    if (conflictLine) {
      noticeConflict(`${conflictLine}. Your version was saved last — review it when convenient.`);
    }
  } finally {
    patchState({ syncing: false });
  }
}

async function applyServerSave(op: OutboxOp, serverRecord: RestorationJobData) {
  const recordId = op.recordId;
  const mirror = await getMirrorJob(recordId);
  const record = { ...(mirror?.record ?? {}), ...serverRecord, recordId } as RestorationJobData;
  await completeOutboxOp(op, {
    recordId,
    summary: summaryFromRecord(record, mirror?.summary ?? null),
    record,
    syncState: 'synced',
    // The next list refresh picks up the server's authoritative updatedAt.
    baseUpdatedAt: null,
    locallyUpdatedAt: new Date().toISOString(),
  });
}

// ---- drafts ---------------------------------------------------------------

/**
 * Publishes one queued workspace draft.
 *
 * Only the acknowledged operation is removed; later edits keep their own ID.
 */
async function pushDraft(auth: AuthContext, op: OutboxOp): Promise<boolean> {
  if (!op.draft) return true;
  const draft = op.draft;

  const saved = await saveDraft(auth, {
    job: draft.job,
    recordId: draft.recordId,
    savedAt: draft.savedAt,
  });

  await completeOutboxOp(op, undefined, {
      id: 'current',
      job: draft.job,
      recordId: draft.recordId,
      savedAt: draft.savedAt,
      serverUpdatedAt: saved.updatedAt,
      updatedBy: saved.updatedBy,
    });
  return true;
}

async function safeGetDraft(): Promise<WorkspaceDraft | undefined> {
  try {
    return await getDraft(currentOwner());
  } catch {
    return undefined;
  }
}

// ---- lifecycle ------------------------------------------------------------

let initialized = false;

/** Wires connectivity listeners, the SW relay and the retry interval. */
export function initJobSync(): () => void {
  if (initialized) return () => {};
  initialized = true;
  state = { ...state, online: navigator.onLine };

  const onOnline = () => {
    patchState({ online: true });
    void flushOutboxNow(false);
  };
  const onOffline = () => patchState({ online: false });

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  const onSwMessage = (event: MessageEvent) => {
    const data = event.data as { type?: string } | undefined;
    if (data?.type === 'HAYS_FLUSH_OUTBOX') void flushOutboxNow(false);
  };
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', onSwMessage);
  }

  const timer = window.setInterval(() => {
    if (state.online && state.pendingCount > 0 && !state.syncing) void flushOutboxNow(false);
  }, 60_000);

  const onHidden = () => { if (document.visibilityState === 'hidden') void flushDraftSave().catch(reportDraftError); };
  const onPageHide = () => { void flushDraftSave().catch(reportDraftError); };
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (state.draftStatus !== 'saving' && state.draftStatus !== 'error') return;
    void flushDraftSave().catch(reportDraftError);
    event.preventDefault();
    event.returnValue = '';
  };
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('beforeunload', onBeforeUnload);
  void refreshPendingState().catch(reportDraftError);
  void flushOutboxNow(false);

  return () => {
    initialized = false;
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener('message', onSwMessage);
    }
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onHidden);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('beforeunload', onBeforeUnload);
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  };
}

// ---- workspace drafts -----------------------------------------------------

let draftTimer: number | null = null;
let draftPushTimer: number | null = null;
let draftMaxTimer: number | null = null;
let pendingDraft: WorkspaceDraft | null = null;
let draftWrite: Promise<void> = Promise.resolve();
let draftSequence = 0;

function reportDraftError(err: unknown) {
  patchState({ draftStatus: 'error', lastError: `Autosave could not store your changes on this device: ${errorMessage(err)}`, errorCode: 'device_storage' });
}

/** Flush before explicit saves, sign-out, hiding the window or applying an update. */
export function flushDraftSave(): Promise<void> {
  if (draftTimer) { window.clearTimeout(draftTimer); draftTimer = null; }
  const next = pendingDraft;
  if (!next) return draftWrite;
  pendingDraft = null;
  draftWrite = draftWrite.catch(() => {}).then(async () => {
    const persist = async () => {
      const previous = await getDraft(next.owner);
      await persistDraftAndOutbox({ ...next, serverUpdatedAt: previous?.serverUpdatedAt }, next.owner);
    };
    try { await persist(); }
    catch (err) {
      const name = err && typeof err === 'object' && 'name' in err ? err.name : '';
      if (name !== 'UnknownError' && name !== 'InvalidStateError') throw err;
      reopenDeviceDatabase();
      await persist();
    }
    if (state.errorCode === 'device_storage') patchState({ lastError: null, errorCode: null });
    await refreshPendingState();
    if (next.savedAt === draftSequence) patchState({ draftStatus: 'saved', lastDraftSavedAt: next.savedAt });
  }).catch((err) => {
    if (!pendingDraft || pendingDraft.savedAt < next.savedAt) pendingDraft = next;
    reportDraftError(err);
    throw err;
  });
  return draftWrite;
}

/**
 * Debounced autosave of the current workspace record.
 *
 * The local mirror write is quick (350ms); its cloud backup is queued atomically.
 * The push to the Apps Script database waits for a longer idle gap (2s), so a
 * long typing session cannot hammer the backend with one request per pause. The
 * queued push is durable either way: it is replayed on the next start, on
 * reconnect, and by the periodic flush.
 */
export function scheduleDraftSave(job: RestorationJobData, recordId?: string) {
  const owner = currentOwner();
  if (!owner || getCurrentUser()?.role === 'viewer') return;
  pendingDraft = { id: `current:${owner}`, job, recordId, owner, savedAt: Math.max(Date.now(), ++draftSequence) };
  draftSequence = pendingDraft.savedAt;
  patchState({ draftStatus: 'saving' });
  if (draftTimer) window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => {
    void flushDraftSave().catch(reportDraftError);
  }, 350);

  if (draftPushTimer) window.clearTimeout(draftPushTimer);
  draftPushTimer = window.setTimeout(() => {
    if (draftMaxTimer) { window.clearTimeout(draftMaxTimer); draftMaxTimer = null; }
    void flushDraftSave().then(() => flushOutboxNow(false)).catch(reportDraftError);
  }, 2000);
  if (!draftMaxTimer) draftMaxTimer = window.setTimeout(() => {
    draftMaxTimer = null;
    void flushDraftSave().then(() => flushOutboxNow(false)).catch(reportDraftError);
  }, 8000);
}

/**
 * Queues the local draft for publishing. Used when the local copy is ahead of
 * the shared one, including drafts that were never pushed.
 */
async function queueCurrentDraftPush(): Promise<void> {
  const draft = await safeGetDraft();
  if (!draft) return;

  try {
    await queueDraftOutbox({
      type: 'draft',
      recordId: draft.recordId ?? draft.job.recordId ?? '',
      draft,
      createdAt: Date.now(),
      attempts: 0,
      owner: currentOwner() ?? undefined,
    });
  } catch {
    return;
  }

  await refreshPendingState();
  if (state.online) void flushOutboxNow(false);
}

export interface RestoredDraft {
  job: RestorationJobData;
  recordId?: string;
  updatedBy?: string;
  updatedAt?: string;
  /** Where the record came from, so the UI can say so. */
  origin: 'server' | 'local';
}

/** Failures that mean "no server draft to read", not "something is broken". */
function isDraftReadMiss(err: unknown): boolean {
  if (!(err instanceof DatabaseError)) return false;
  return (
    err.code === 'unknown_action' ||
    err.code === 'not_configured' ||
    err.code === 'network_error' ||
    err.code === 'timeout' ||
    err.code === 'bad_response' ||
    err.code === 'no_session' ||
    err.code === 'session_expired' ||
    err.code === 'unauthenticated' ||
    err.code === 'unauthorized'
  );
}

/**
 * Returns the record the workspace should open with.
 *
 * The Apps Script copy is the shared system of record, which is what makes an
 * unfinished job reappear on another machine or under another account. It only
 * displaces the local copy when the shared draft has genuinely moved on since
 * this device last saw it - decided from server timestamps, so a wrong device
 * clock can never cause a newer local edit to be discarded. Offline, or on a
 * deployment without draft support, the local mirror is used.
 */
export async function restoreDraft(onLocal?: (draft: RestoredDraft) => void): Promise<RestoredDraft | undefined> {
  const owner = currentOwner();
  const local = await safeGetDraft();
  const localResult: RestoredDraft | undefined = local
    ? { job: local.job, recordId: local.recordId, updatedBy: local.updatedBy, origin: 'local' }
    : undefined;
  if (localResult) onLocal?.(localResult);

  if (!isDatabaseConfigured() || !state.online) return localResult;

  try {
    const auth = await acquireAuthContext();
    const server = await fetchDraft(auth);
    if (currentOwner() !== owner) return undefined;
    // Typing during recovery always wins over a delayed server response.
    const latest = await safeGetDraft();
    if (pendingDraft || (latest && latest.savedAt !== local?.savedAt)) return latest
      ? { job: latest.job, recordId: latest.recordId, origin: 'local' } : localResult;

    if (!server) {
      // Nothing shared yet: publish whatever this device already had.
      if (local) void queueCurrentDraftPush().catch(reportDraftError);
      return localResult;
    }

    const seenAt = Date.parse(local?.serverUpdatedAt ?? '');
    const sharedMovedOn = !Number.isNaN(seenAt) && Date.parse(server.updatedAt) > seenAt;
    const hasEdits = (await getOutboxOps()).some(op => op.type === 'draft' && outboxOpIsMine(op, owner));
    if (local && (!sharedMovedOn || hasEdits)) {
      if (hasEdits || !local.serverUpdatedAt) void queueCurrentDraftPush().catch(reportDraftError);
      return localResult;
    }

    const mirrored: WorkspaceDraft = {
      id: owner ? `current:${owner}` : 'current',
      owner: owner ?? undefined,
      job: server.job,
      recordId: server.recordId || server.job.recordId,
      savedAt: Date.parse(server.updatedAt) || Date.now(),
      serverUpdatedAt: server.updatedAt,
      updatedBy: server.updatedBy,
    };
    let restored = mirrored;
    try {
      restored = await cacheServerDraft(mirrored, local?.savedAt);
    } catch {
      /* cache-only write */
    }

    return {
      job: restored.job,
      recordId: restored.recordId,
      updatedBy: server.updatedBy,
      updatedAt: server.updatedAt,
      origin: restored === mirrored ? 'server' : 'local',
    };
  } catch (err) {
    if (isDraftReadMiss(err)) return localResult;
    throw err;
  }
}
