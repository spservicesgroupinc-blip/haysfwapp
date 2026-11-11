import assert from 'node:assert/strict';
import vm from 'node:vm';
import { test, type TestContext } from 'node:test';
import { build } from 'esbuild';
import { IDBFactory, IDBKeyRange, IDBObjectStore, IDBDatabase, forceCloseDatabase } from 'fake-indexeddb';

// Exercise the real sync engine, transport and IndexedDB transactions together.
const bundle = await build({
  stdin: { contents: `export * from './src/services/jobSync';
    export * as storage from './src/services/localDb';
    export * as workspace from './src/services/jobWorkspaceService';
    export { login, logout } from './src/services/appsScriptService';`, resolveDir: process.cwd() },
  bundle: true, write: false, format: 'iife', globalName: 'syncEngine', platform: 'browser',
  external: ['virtual:pwa-register'],
  define: { 'import.meta.env': JSON.stringify({ VITE_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/TEST/exec' }) },
});

const owner = 'test@example.com';
const job = { recordId: 'customer-1', customer: { jobNumber: 'TEST-1', customerName: 'Test' } };
const reply = (data: unknown) => new Response(JSON.stringify({ ok: true, data }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(t: TestContext, fetcher: (body: any) => Promise<Response> | Response) {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const trackedTimeout = (fn: () => void, ms: number) => {
    const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms);
    timers.add(timer);
    return timer;
  };
  t.after(() => { for (const timer of timers) clearTimeout(timer); });
  let session: string | null = JSON.stringify({ token: 'test-session', expiresAt: '2099-01-01T00:00:00Z',
    user: { email: owner, name: 'Test', role: 'editor' } });
  const context = vm.createContext({
    console, URL, AbortController, structuredClone, indexedDB: new IDBFactory(), IDBKeyRange,
    setTimeout: trackedTimeout, clearTimeout,
    window: { setTimeout: trackedTimeout, clearTimeout }, navigator: { onLine: true },
    localStorage: {
      getItem: () => session, setItem: (_key: string, value: string) => { session = value; },
      removeItem: () => { session = null; },
    },
    fetch: async (_url: string, options: RequestInit) => fetcher(JSON.parse(options.body as string)),
  });
  vm.runInContext(bundle.outputFiles[0].text, context);
  return context.syncEngine;
}

test('unreadable responses retain the outbox; a successful retry clears the error', async (t) => {
  let broken = true;
  let requests = 0;
  const engine = setup(t, () => {
    requests++;
    return broken ? new Response('<html>Unexpected Google error</html>') :
      reply({ job, recordId: job.recordId, updatedAt: '2026-10-06T12:00:00Z' });
  });
  const draft = { id: 'current', job, recordId: job.recordId, savedAt: 1 };
  await engine.storage.persistDraftAndOutbox(draft, owner);
  await engine.storage.enqueueOutbox({ type: 'draft', recordId: job.recordId, draft, createdAt: 1, attempts: 0, owner });
  await engine.flushOutboxNow();
  assert.equal(requests, 1);
  const queued = await engine.storage.getOutboxOps();
  assert.equal(queued.length, 2);
  assert.equal(queued[0].attempts, 1);
  assert.equal(engine.getSyncState().lastSyncAt, null);
  assert.ok(engine.getSyncState().lastError);
  assert.equal(engine.getSyncState().syncing, false);
  broken = false;
  await engine.flushOutboxNow();
  assert.equal((await engine.storage.getOutboxOps()).length, 0);
  assert.equal(engine.getSyncState().lastError, null);
  assert.equal(engine.getSyncState().pendingCount, 0);
  assert.ok(engine.getSyncState().lastSyncAt);
});

test('manual save completes durably without waiting for the network', async (t) => {
  const started = deferred<void>();
  const response = deferred<Response>();
  const engine = setup(t, () => { started.resolve(); return response.promise; });
  const outcome = await engine.saveJobOffline(job);
  assert.equal(outcome.queued, true);
  assert.equal((await engine.storage.getMirrorJob(job.recordId)).record.customer.jobNumber, 'TEST-1');
  assert.equal((await engine.storage.getOutboxOps()).length, 1);
  await started.promise;
  const run = engine.flushOutboxNow();
  assert.equal(engine.flushOutboxNow(), run);
  response.resolve(reply(job));
  await run;
  assert.equal((await engine.storage.getMirrorJob(job.recordId)).syncState, 'synced');
});

test('connection failure after a local save never rejects the saved job; retry recovers', async (t) => {
  let broken = true;
  const engine = setup(t, () => {
    if (broken) throw new TypeError('Failed to fetch');
    return reply(job);
  });
  assert.equal((await engine.saveJobOffline(job)).queued, true);
  await engine.flushOutboxNow();
  assert.equal(engine.getSyncState().errorCode, 'network_error');
  assert.ok(engine.getSyncState().nextRetryAt > Date.now());
  assert.equal((await engine.storage.getOutboxOps()).length, 1);
  broken = false;
  await engine.flushOutboxNow();
  assert.equal((await engine.storage.getOutboxOps()).length, 0);
  assert.equal(engine.getSyncState().lastError, null);
});

test('an old save acknowledgement cannot overwrite a newer save or delete', async (t) => {
  const started = deferred<void>();
  const response = deferred<Response>();
  let first = true;
  const engine = setup(t, (body) => {
    if (first) { first = false; started.resolve(); return response.promise; }
    return reply(body.job ?? { deleted: true });
  });
  await engine.saveJobOffline(job);
  await started.promise;
  const run = engine.flushOutboxNow();
  const latest = { ...job, customer: { ...job.customer, customerName: 'Latest edit' } };
  await engine.saveJobOffline(latest);
  response.resolve(reply(job));
  await run;
  const local = await engine.storage.getMirrorJob(job.recordId);
  assert.equal(local.record.customer.customerName, 'Latest edit');
  assert.equal(local.syncState, 'pending-save');
  await engine.flushOutboxNow();
  assert.equal((await engine.storage.getMirrorJob(job.recordId)).record.customer.customerName, 'Latest edit');
  await engine.deleteJobOffline(job.recordId);
  await engine.flushOutboxNow();
  assert.equal(await engine.storage.getMirrorJob(job.recordId), undefined);
});

test('autosave is durable and preserves edits made during cloud sync', async (t) => {
  const started = deferred<void>();
  const response = deferred<Response>();
  let first = true;
  const sent: any[] = [];
  const engine = setup(t, (body) => {
    sent.push(body.draft.job);
    if (first) { first = false; started.resolve(); return response.promise; }
    return reply({ job: body.draft.job, updatedAt: '2026-10-06T12:01:00Z' });
  });
  engine.scheduleDraftSave(job, job.recordId);
  await engine.flushDraftSave();
  assert.equal(engine.getSyncState().draftStatus, 'saved');
  const originalId = (await engine.storage.getOutboxOps())[0].id;
  const run = engine.flushOutboxNow();
  await started.promise;
  const latest = { ...job, customer: { ...job.customer, customerName: 'Typed during sync' } };
  engine.scheduleDraftSave(latest, job.recordId);
  await engine.flushDraftSave();
  const queued = await engine.storage.getOutboxOps();
  assert.equal(queued.length, 1);
  assert.notEqual(queued[0].id, originalId);
  response.resolve(reply({ job, updatedAt: '2026-10-06T12:00:00Z' }));
  await run;
  assert.equal((await engine.storage.getDraft(owner)).job.customer.customerName, 'Typed during sync');
  await engine.flushOutboxNow();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].customer.customerName, 'Typed during sync');
  assert.equal((await engine.storage.getOutboxOps()).length, 0);
});

test('account drafts and pending autosaves remain isolated', async (t) => {
  const engine = setup(t, () => reply(null));
  const otherOwner = 'other@example.com';
  await engine.storage.persistDraftAndOutbox({ id: 'current', job, savedAt: 1 }, owner);
  await engine.storage.persistDraftAndOutbox({ id: 'current', job: { ...job, recordId: 'other-job' }, savedAt: 2 }, otherOwner);
  assert.equal((await engine.storage.getOutboxOps()).length, 2);
  assert.equal((await engine.storage.getDraft(owner)).job.recordId, job.recordId);
  assert.equal((await engine.storage.getDraft(otherOwner)).job.recordId, 'other-job');
  assert.equal(await engine.storage.getDraft('unknown@example.com'), undefined);
  const old = (await engine.storage.getOutboxOps())[0];
  await engine.storage.persistDraftAndOutbox({ id: 'current', job, savedAt: 3 }, owner);
  await engine.storage.updateOutboxOp({ ...old, attempts: 1 });
  assert.equal((await engine.storage.getOutboxOps()).length, 2);
});

test('local recovery is immediate and delayed shared recovery preserves pending edits', async (t) => {
  const response = deferred<Response>();
  const started = deferred<void>();
  const engine = setup(t, () => { started.resolve(); return response.promise; });
  await engine.storage.putDraft({ id: `current:${owner}`, owner, job, savedAt: 1, serverUpdatedAt: '2026-10-06T11:00:00Z' });
  let painted = false;
  const recovery = engine.restoreDraft(() => { painted = true; });
  await started.promise;
  assert.equal(painted, true);
  const latest = { ...job, customer: { ...job.customer, customerName: 'Unsynced edit' } };
  engine.scheduleDraftSave(latest, job.recordId);
  await engine.flushDraftSave();
  response.resolve(reply({ draft: { job, recordId: job.recordId, updatedAt: '2026-10-06T12:00:00Z' } }));
  const recovered = await recovery;
  assert.equal(recovered.job.customer.customerName, 'Unsynced edit');
  assert.equal((await engine.storage.getDraft(owner)).job.customer.customerName, 'Unsynced edit');
});

test('obsolete draft deployments retain pending backups and report the upgrade needed', async (t) => {
  const engine = setup(t, () => new Response(JSON.stringify({ ok: false, code: 'unknown_action', error: 'Unsupported' })));
  engine.scheduleDraftSave(job, job.recordId);
  await engine.flushDraftSave();
  await engine.flushOutboxNow();
  assert.equal((await engine.storage.getOutboxOps()).length, 1);
  assert.equal(engine.getSyncState().errorCode, 'unknown_action');
  assert.match(engine.getSyncState().lastError, /updated Apps Script deployment/);
});

test('incomplete success payloads cannot acknowledge a customer save', async (t) => {
  const engine = setup(t, () => reply({}));
  await engine.saveJobOffline(job);
  await engine.flushOutboxNow();
  assert.equal((await engine.storage.getOutboxOps()).length, 1);
  assert.equal(engine.getSyncState().errorCode, 'bad_response');
});

test('a transaction aborted after request success is reported as a failed local save', async (t) => {
  const engine = setup(t, () => reply(job));
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
    const request = original.apply(this, args);
    request.addEventListener('success', () => request.transaction!.abort());
    return request;
  };
  try {
    await assert.rejects(engine.storage.putDraft({ id: 'current', job, savedAt: 1 }));
    assert.equal(await engine.storage.getDraft(), undefined);
    await assert.rejects(engine.saveJobOffline(job));
    assert.equal((await engine.storage.getOutboxOps()).length, 0);
  } finally { IDBObjectStore.prototype.put = original; }
});

test('a failed device autosave can retry without requiring the user to type again', async (t) => {
  const engine = setup(t, (body) => reply({ job: body.draft.job, updatedAt: '2026-10-06T12:00:00Z' }));
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
    const request = original.apply(this, args);
    request.addEventListener('success', () => request.transaction!.abort());
    return request;
  };
  try {
    engine.scheduleDraftSave(job, job.recordId);
    await assert.rejects(engine.flushDraftSave());
    assert.equal(engine.getSyncState().draftStatus, 'error');
    assert.equal((await engine.storage.getOutboxOps()).length, 0);
  } finally { IDBObjectStore.prototype.put = original; }
  await engine.syncNow();
  assert.equal(engine.getSyncState().draftStatus, 'saved');
  assert.equal((await engine.storage.getDraft(owner)).job.recordId, job.recordId);
  assert.equal(engine.getSyncState().lastError, null);
});

test('autosave reopens an unexpectedly closed browser database without losing the draft', async (t) => {
  const engine = setup(t, (body) => reply({ job: body.draft.job, updatedAt: '2026-11-10T12:00:00Z' }));
  const original = IDBDatabase.prototype.transaction;
  let connection: IDBDatabase | undefined;
  IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
    connection = this;
    return original.apply(this, args);
  };
  try {
    await engine.storage.getDraft(owner);
  } finally { IDBDatabase.prototype.transaction = original; }
  assert.ok(connection);
  forceCloseDatabase(connection as any);
  await new Promise(resolve => setTimeout(resolve, 0));
  engine.scheduleDraftSave(job, job.recordId);
  await engine.flushDraftSave();
  assert.equal((await engine.storage.getDraft(owner)).job.recordId, job.recordId);
});

test('a transient internal browser storage error retries once with a fresh connection', async (t) => {
  const engine = setup(t, () => reply({}));
  await engine.storage.getDraft(owner);
  const original = IDBDatabase.prototype.transaction;
  let fail = true;
  IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
    if (fail) {
      fail = false;
      const error = new Error('Internal error.');
      error.name = 'UnknownError';
      throw error;
    }
    return original.apply(this, args);
  };
  try {
    engine.scheduleDraftSave(job, job.recordId);
    await engine.flushDraftSave();
    assert.equal(engine.getSyncState().draftStatus, 'saved');
    assert.equal((await engine.storage.getOutboxOps()).length, 1);
  } finally { IDBDatabase.prototype.transaction = original; }
});

test('a delayed customer list cannot replace a job saved and synced after the read started', async (t) => {
  const engine = setup(t, () => reply(job));
  const storage = engine.storage;
  const summary = { recordId: job.recordId, customerName: 'Stale server name' };
  const server = { recordId: job.recordId, summary, record: job, syncState: 'synced',
    baseUpdatedAt: null, locallyUpdatedAt: '2026-10-06T12:00:00Z' };
  const latest = { ...server, record: { ...job, customer: { ...job.customer, customerName: 'Newly synced name' } }, locallyUpdatedAt: '2026-10-06T12:01:00Z' };
  await storage.putMirrorJob(latest);
  const startedAt = Date.parse('2026-10-06T12:00:30Z');
  const cached = await storage.cacheServerMirrorJob(server, startedAt);
  assert.equal(cached.record.customer.customerName, 'Newly synced name');
  await storage.deleteSyncedMirrorJob(job.recordId, startedAt);
  assert.ok(await storage.getMirrorJob(job.recordId));
});

test('session expiry returns to sign-in without losing the pending save', async (t) => {
  const engine = setup(t, () => new Response(JSON.stringify({ ok: false, code: 'session_expired', error: 'Sign in again.' })));
  await engine.saveJobOffline(job);
  await engine.flushOutboxNow();
  assert.equal((await engine.storage.getOutboxOps()).length, 1);
  assert.equal(engine.getSyncState().errorCode, 'session_expired');
  await assert.rejects(engine.saveJobOffline(job), /Sign in to save/);
});

test('a busy backend keeps edits queued and schedules a delayed retry', async (t) => {
  const engine = setup(t, () => new Response(JSON.stringify({ ok: false, code: 'busy', error: 'Database is busy.' })));
  await engine.saveJobOffline(job);
  await engine.flushOutboxNow();
  assert.equal((await engine.storage.getOutboxOps()).length, 1);
  assert.equal(engine.getSyncState().errorCode, 'busy');
  assert.ok(engine.getSyncState().nextRetryAt > Date.now());
});

test('dashboard writes coexist with job acknowledgements without stranding the job mirror', async t => {
  const engine = setup(t, body => body.action === 'mutateJobWorkspace' ? reply({ ...body, revision: 1, updatedAt: '2026-11-11T12:00:00Z', updatedBy: owner }) :
    reply({ job, recordId: job.recordId, updatedAt: '2026-11-11T12:00:00Z' }));
  await engine.storage.persistJobAndOutbox({ recordId: job.recordId, record: job, summary: {}, syncState: 'pending-save', baseUpdatedAt: null, locallyUpdatedAt: '', owner },
    { type: 'save', recordId: job.recordId, job, createdAt: 1, attempts: 0, owner });
  await engine.workspace.saveWorkspaceMutation({ operationId: 'intent-1', recordId: job.recordId, kind: 'workItem', id: 'task', expectedRevision: 0,
    data: { title: 'Call customer', category: 'Task', status: 'Open' } });
  await engine.flushOutboxNow();
  assert.equal((await engine.storage.getMirrorJob(job.recordId)).syncState, 'synced');
  assert.equal((await engine.storage.getOutboxOps()).length, 0);
  assert.equal((await engine.workspace.readWorkspace(job.recordId)).entities[0].data.title, 'Call customer');
});

test('dashboard conflict retains local work and blocks dependent edits across retries', async t => {
  let requests = 0;
  const engine = setup(t, () => { requests++; return new Response(JSON.stringify({ ok: false, code: 'conflict', error: 'Entry changed' })); });
  for (let n = 0; n < 2; n++) await engine.workspace.saveWorkspaceMutation({ operationId: `intent-${n}`, recordId: job.recordId, kind: 'workItem', id: 'task', expectedRevision: n, data: { title: `Local ${n}` } });
  await engine.flushOutboxNow();
  await engine.flushOutboxNow();
  assert.equal(requests, 1);
  const local = await engine.workspace.readWorkspace(job.recordId);
  assert.equal(local.pending.length, 2);
  assert.equal(local.entities[0].data.title, 'Local 1');
  assert.equal(local.pending[0].errorCode, 'conflict');
});

test('pending financial decisions do not become confirmed dashboard totals', async t => {
  const engine = setup(t, () => reply({}));
  await engine.workspace.saveWorkspaceMutation({ operationId: 'financial-1', recordId: job.recordId, kind: 'contract', id: 'contract', expectedRevision: 0,
    data: { originalCents: 1000000, openingCents: 0, reviewed: true } });
  const view = await engine.workspace.readWorkspace(job.recordId);
  assert.equal(view.entities.length, 0);
  assert.equal(view.pending.length, 1);
});

test('dashboard pending work and cached staff are isolated by account', async t => {
  const engine = setup(t, () => reply({}));
  await engine.workspace.saveWorkspaceMutation({ operationId: 'one', recordId: job.recordId, kind: 'workItem', id: 'task', expectedRevision: 0, data: { title: 'Private pending work' } });
  await engine.logout();
  assert.throws(() => engine.workspace.workspaceOwner(), /Sign in/);
  const ops = await engine.storage.getOutboxOps();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].owner, owner);
});
