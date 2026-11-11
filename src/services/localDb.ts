/**
 * IndexedDB persistence for the offline-first job store.
 *
 * Stores:
 *  - `jobs`   — one mirror row per record: last known server summary, the full
 *               record JSON, and the local sync state.
 *  - `outbox` — ordered queue of pending writes (save/delete) for the Apps
 *               Script database; replayed when connectivity returns.
 *  - `drafts` — the current workspace record, autosaved so a reload/restart
 *               never loses in-progress work.
 */
import type { RestorationJobData } from '../types/jobData';
import type { JobSummary } from './appsScriptService';
import type { WorkspaceMutation, WorkspaceSnapshot } from '../types/jobWorkspace';

export type JobSyncStatus = 'synced' | 'pending-save' | 'pending-delete';

/** A job summary plus its local sync state, used by the saved-jobs list. */
export interface SyncJobSummary extends JobSummary {
  syncState: JobSyncStatus;
}

export interface MirrorJob {
  recordId: string;
  /** Last known server-shaped summary (locally derived while pending). */
  summary: JobSummary;
  /** Full record JSON. May be null for rows cached from a summary-only list. */
  record: RestorationJobData | null;
  syncState: JobSyncStatus;
  /** Server `updatedAt` at the time the local edit started (conflict base). */
  baseUpdatedAt: string | null;
  /** When this mirror row last changed locally. */
  locallyUpdatedAt: string;
  /**
   * Lower-cased account email that made the unsynced edit. Unset on synced rows
   * because those are just a cache of the shared server data, and unset on rows
   * written before ownership existed. Pending rows are only ever shown to, and
   * flushed by, the account that created them.
   */
  owner?: string;
}

export interface OutboxOp {
  id?: number;
  type: 'save' | 'delete' | 'draft' | 'workspace';
  mutation?: WorkspaceMutation;
  errorCode?: string;
  recordId: string;
  job?: RestorationJobData;
  /** The autosaved workspace record, for `type: 'draft'` operations. */
  draft?: WorkspaceDraft;
  createdAt: number;
  attempts: number;
  lastError?: string;
  /** Account that queued the write; only that account replays it. */
  owner?: string;
}

export interface WorkspaceDraft {
  id: string;
  job: RestorationJobData;
  recordId?: string;
  savedAt: number;
  /** `updatedAt` of the server copy this local draft mirrors, when known. */
  serverUpdatedAt?: string;
  /** Who last wrote the draft server-side, when known. */
  updatedBy?: string;
  owner?: string;
}

const DB_NAME = 'hays.docsuite';
const DB_VERSION = 2;
const WORKSPACES = 'workspaces';

const JOBS = 'jobs';
const OUTBOX = 'outbox';
const DRAFTS = 'drafts';

let dbPromise: Promise<IDBDatabase> | null = null;
let currentDb: IDBDatabase | null = null;

/** Reconnect without deleting the database or any pending writes. */
export function reopenDeviceDatabase(): void {
  currentDb?.close();
  currentDb = null;
  dbPromise = null;
}

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(JOBS)) db.createObjectStore(JOBS, { keyPath: 'recordId' });
        if (!db.objectStoreNames.contains(OUTBOX)) {
          db.createObjectStore(OUTBOX, { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(WORKSPACES)) db.createObjectStore(WORKSPACES, { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const db = request.result;
        currentDb = db;
        const forget = () => {
          if (currentDb === db) { currentDb = null; dbPromise = null; }
        };
        db.onversionchange = () => { db.close(); forget(); };
        db.onclose = forget;
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    }).catch((err) => { dbPromise = null; throw err; });
  }
  return dbPromise;
}

function runRequest<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const request = operation(tx.objectStore(storeName));
        // A successful request can still be rolled back by a failed commit.
        tx.oncomplete = () => resolve(request.result as T);
        tx.onabort = () => reject(tx.error ?? new Error('Device storage could not commit the save.'));
        request.onerror = () => reject(request.error);
      })
  );
}

// ---- jobs mirror ----------------------------------------------------------

export function getAllMirrorJobs(): Promise<MirrorJob[]> {
  return runRequest<MirrorJob[]>(JOBS, 'readonly', (store) => store.getAll());
}

export function getMirrorJob(recordId: string): Promise<MirrorJob | undefined> {
  return runRequest<MirrorJob | undefined>(JOBS, 'readonly', (store) => store.get(recordId));
}

export function putMirrorJob(job: MirrorJob): Promise<void> {
  return runRequest<void>(JOBS, 'readwrite', (store) => store.put(job));
}

export function deleteMirrorJob(recordId: string): Promise<void> {
  return runRequest<void>(JOBS, 'readwrite', (store) => store.delete(recordId));
}

/** A delayed server read must never replace edits made since that read began. */
export async function cacheServerMirrorJob(server: MirrorJob, readStartedAt = Date.now()): Promise<MirrorJob> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(JOBS, 'readwrite');
    const store = tx.objectStore(JOBS);
    let result = server;
    const request = store.get(server.recordId);
    request.onsuccess = () => {
      const current = request.result as MirrorJob | undefined;
      if (current && (current.syncState !== 'synced' || Date.parse(current.locallyUpdatedAt) > readStartedAt)) result = current;
      else { result = { ...server, record: server.record ?? current?.record ?? null }; store.put(result); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error);
  });
}

export async function deleteSyncedMirrorJob(recordId: string, readStartedAt = Date.now()): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(JOBS, 'readwrite');
    const store = tx.objectStore(JOBS);
    const request = store.get(recordId);
    request.onsuccess = () => {
      if (request.result?.syncState === 'synced' && Date.parse(request.result.locallyUpdatedAt) <= readStartedAt) store.delete(recordId);
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}

// ---- outbox ---------------------------------------------------------------

export function enqueueOutbox(op: Omit<OutboxOp, 'id'>): Promise<number> {
  return runRequest<number>(OUTBOX, 'readwrite', (store) => store.add(op));
}

export async function getOutboxOps(): Promise<OutboxOp[]> {
  const ops = await runRequest<OutboxOp[]>(OUTBOX, 'readonly', (store) => store.getAll());
  return ops.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

export function updateOutboxOp(op: OutboxOp): Promise<void> {
  return openDb().then((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OUTBOX, 'readwrite');
    const store = tx.objectStore(OUTBOX);
    const request = store.get(op.id!);
    request.onsuccess = () => {
      // A newer draft may have replaced this operation while it was in flight.
      if (request.result) store.put(op);
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  }));
}

export function deleteOutboxOp(id: number): Promise<void> {
  return runRequest<void>(OUTBOX, 'readwrite', (store) => store.delete(id));
}

export function countOutbox(): Promise<number> {
  return runRequest<number>(OUTBOX, 'readonly', (store) => store.count());
}

/**
 * True when `owner` is allowed to replay this queued write: it either belongs
 * to that account, or it predates ownership tagging.
 */
export function outboxOpIsMine(op: OutboxOp, owner: string | null): boolean {
  if (!op.owner) return true;
  return owner !== null && op.owner === owner;
}

export interface OutboxSummary {
  /** Writes this account can replay right now. */
  mine: number;
  /** Writes queued by a different account, waiting for that person to sign in. */
  stranded: number;
  /** Account that owns the stranded writes, when it can be determined. */
  strandedOwner: string | null;
}

/** Splits the outbox into "mine" and "waiting for another account". */
export async function summarizeOutbox(owner: string | null): Promise<OutboxSummary> {
  const ops = await getOutboxOps();
  let mine = 0;
  let stranded = 0;
  let strandedOwner: string | null = null;

  for (const op of ops) {
    if (outboxOpIsMine(op, owner)) {
      mine += 1;
    } else {
      stranded += 1;
      if (!strandedOwner) strandedOwner = op.owner ?? null;
    }
  }

  return { mine, stranded, strandedOwner };
}

/**
 * Queues a draft push, reusing the pending draft operation when there is one so
 * a long editing session cannot fill the outbox with superseded drafts.
 */
export async function queueDraftOutbox(op: Omit<OutboxOp, 'id'>): Promise<void> {
  await persistDraftAndOutbox(op.draft!, op.owner);
}

/** Commit the mirror and its replayable write together, never half a save. */
export async function persistJobAndOutbox(mirror: MirrorJob, op: Omit<OutboxOp, 'id'>): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([JOBS, OUTBOX], 'readwrite');
    tx.objectStore(JOBS).put(mirror);
    tx.objectStore(OUTBOX).add(op);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Could not save on this device.'));
  });
}

function draftKey(owner?: string | null): string {
  return owner ? `current:${owner}` : 'current';
}

/** Persist each idle edit and its cloud backup in the same durable transaction. */
export async function persistDraftAndOutbox(draft: WorkspaceDraft, owner?: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([DRAFTS, OUTBOX], 'readwrite');
    const stored = { ...draft, id: draftKey(owner), owner };
    tx.objectStore(DRAFTS).put(stored);
    const outbox = tx.objectStore(OUTBOX);
    const request = outbox.getAll();
    request.onsuccess = () => {
      for (const op of request.result as OutboxOp[]) {
        if (op.type === 'draft' && op.owner === owner) outbox.delete(op.id!);
      }
      // Allocate a new ID: an older response cannot remove the newer payload.
      outbox.add({ type: 'draft', recordId: draft.recordId ?? draft.job.recordId ?? '',
        draft: stored, createdAt: draft.savedAt, attempts: 0, owner });
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Could not autosave on this device.'));
  });
}

/** Acknowledge only the operation sent, preserving any edits queued during it. */
export async function completeOutboxOp(op: OutboxOp, mirror?: MirrorJob, draft?: WorkspaceDraft): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([OUTBOX, JOBS, DRAFTS], 'readwrite');
    const outbox = tx.objectStore(OUTBOX);
    const request = outbox.getAll();
    request.onsuccess = () => {
      const ops = request.result as OutboxOp[];
      outbox.delete(op.id!);
      if (op.type !== 'draft') {
        const newer = ops.some((item) => (item.type === 'save' || item.type === 'delete') && item.recordId === op.recordId && item.id! > op.id!);
        if (!newer) {
          if (mirror) tx.objectStore(JOBS).put(mirror);
          else if (op.type === 'delete') tx.objectStore(JOBS).delete(op.recordId);
        }
      } else if (draft) {
        const store = tx.objectStore(DRAFTS);
        const latest = store.get(draftKey(op.owner));
        latest.onsuccess = () => {
          const local = latest.result as WorkspaceDraft | undefined;
          if (local?.savedAt === op.draft?.savedAt) store.put({ ...draft, id: draftKey(op.owner), owner: op.owner });
        };
      }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}

// ---- workspace draft ------------------------------------------------------

export function putDraft(draft: WorkspaceDraft): Promise<void> {
  return runRequest<void>(DRAFTS, 'readwrite', (store) => store.put(draft));
}

export async function cacheServerDraft(draft: WorkspaceDraft, expectedSavedAt?: number): Promise<WorkspaceDraft> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFTS, 'readwrite');
    const store = tx.objectStore(DRAFTS);
    let result = draft;
    const request = store.get(draft.id);
    request.onsuccess = () => {
      const current = request.result as WorkspaceDraft | undefined;
      if (current && current.savedAt !== expectedSavedAt) result = current;
      else store.put(draft);
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getDraft(owner?: string | null): Promise<WorkspaceDraft | undefined> {
  const draft = await runRequest<WorkspaceDraft | undefined>(DRAFTS, 'readonly', (store) => store.get(draftKey(owner)));
  if (draft || !owner) return draft;
  // Existing installations have an unowned draft under the original key.
  const legacy = await runRequest<WorkspaceDraft | undefined>(DRAFTS, 'readonly', (store) => store.get('current'));
  return legacy?.owner ? undefined : legacy;
}

// Account-scoped dashboard cache. Confirmed snapshots stay separate from pending
// operations; the UI projects the latter without overwriting confirmed revisions.
export async function getWorkspaceCache(owner: string, recordId: string): Promise<WorkspaceSnapshot | undefined> {
  const row = await runRequest<{ snapshot: WorkspaceSnapshot } | undefined>(WORKSPACES, 'readonly', store => store.get(`${owner}:${recordId}`));
  return row?.snapshot;
}
export async function cacheWorkspace(owner: string, recordId: string, snapshot: WorkspaceSnapshot): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WORKSPACES, 'readwrite');
    const store = tx.objectStore(WORKSPACES);
    const key = `${owner}:${recordId}`;
    const request = store.get(key);
    request.onsuccess = () => {
      const old = request.result?.snapshot as WorkspaceSnapshot | undefined;
      const entities = new Map(snapshot.entities.map(e => [`${e.kind}:${e.id}`, e]));
      for (const e of old?.entities ?? []) {
        const key = `${e.kind}:${e.id}`;
        if (!entities.has(key) || entities.get(key)!.revision < e.revision) entities.set(key, e);
      }
      store.put({ id: key, snapshot: { ...snapshot, entities: [...entities.values()] } });
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}
export async function queueWorkspaceMutation(owner: string, mutation: WorkspaceMutation): Promise<void> {
  await runRequest(OUTBOX, 'readwrite', store => store.add({ type: 'workspace', mutation, recordId: mutation.recordId, owner, createdAt: Date.now(), attempts: 0 }));
}
export async function acknowledgeWorkspace(op: OutboxOp, entity: import('../types/jobWorkspace').WorkspaceEntity): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([WORKSPACES, OUTBOX], 'readwrite');
    const store = tx.objectStore(WORKSPACES);
    const key = `${op.owner}:${op.recordId}`;
    const request = store.get(key);
    request.onsuccess = () => {
      const snapshot: WorkspaceSnapshot = request.result?.snapshot ?? { entities: [], activity: [], staff: [], fetchedAt: '' };
      const old = snapshot.entities.find(e => e.id === entity.id && e.kind === entity.kind);
      if (!old || old.revision <= entity.revision) snapshot.entities = [...snapshot.entities.filter(e => e.id !== entity.id || e.kind !== entity.kind), entity];
      store.put({ id: key, snapshot });
      tx.objectStore(OUTBOX).delete(op.id!);
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}
/** Explicit reconciliation replaces all this account's dependent edits together. */
export async function reconcileWorkspace(owner: string, recordId: string, kind: string, entityId: string, replacement?: WorkspaceMutation): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX, 'readwrite');
    const store = tx.objectStore(OUTBOX);
    const request = store.getAll();
    request.onsuccess = () => {
      for (const op of request.result as OutboxOp[]) {
        if (op.owner === owner && op.type === 'workspace' && op.recordId === recordId && op.mutation?.kind === kind && op.mutation.id === entityId) store.delete(op.id!);
      }
      if (replacement) store.add({ type: 'workspace', mutation: replacement, recordId, owner, createdAt: Date.now(), attempts: 0 });
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}
