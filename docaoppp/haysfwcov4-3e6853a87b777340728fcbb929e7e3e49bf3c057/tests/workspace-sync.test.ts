import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { mockBackend } from './helpers/backend';
import { createWorkspace } from '../src/workspaces/model';
import { cachedWorkspace, cachedWorkspaces, saveWorkspaceLocally, syncWorkspaces, flushWorkspace, resolveWorkspaceConflict, queueJobDocument, cachedJobDocuments, fetchJobDocument, workspaceSyncError, refreshWorkspaces, loadWorkspace, refreshJobDocuments } from '../src/services/workspaces';
import { updateWorkspaceRow } from '../src/workspaces/localStore';

let backend: ReturnType<typeof mockBackend>;
let restore: () => void;
beforeEach(async () => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('hays-job-workspaces-v1', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('workspaces', { keyPath: 'workspace.id' });
      request.result.createObjectStore('documents', { keyPath: 'document.id' }).createIndex('workspace', 'document.workspaceId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['workspaces', 'documents'], 'readwrite');
    tx.objectStore('workspaces').clear(); tx.objectStore('documents').clear();
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  });
  db.close();
  backend = mockBackend(); restore = backend.installFetch();
});
afterEach(async () => { await syncWorkspaces().catch(() => undefined); restore(); });
function job(name = 'Local customer') {
  const value = createWorkspace(); value.record.customer.customerName = name; value.record.customer.jobNumber = 'JOB-1'; return value;
}
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test('local jobs survive storage reads, and a lost save response retries identical mutation and payload', async () => {
  const value = job();
  await saveWorkspaceLocally(value);
  value.record.customer.customerName = 'Unsaved caller change';
  assert.equal((await cachedWorkspaces())[0].workspace.record.customer.customerName, 'Local customer');
  const fetch = globalThis.fetch; const payloads: unknown[] = [];
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body));
    const response = await fetch(input, init);
    if (body.action === 'saveWorkspace') { payloads.push(body); if (payloads.length === 1) throw new TypeError('Lost save response'); }
    return response;
  };
  await assert.rejects(syncWorkspaces(), /Lost save response/);
  const persisted = await cachedWorkspace(value.id);
  assert.ok(persisted?.inFlight?.mutationId); assert.match(workspaceSyncError(), /Lost/);
  await syncWorkspaces();
  assert.deepEqual(payloads[0], payloads[1]);
  assert.equal((await cachedWorkspace(value.id))?.workspace.revision, 1);
  assert.equal((await cachedWorkspace(value.id))?.inFlight, undefined);
});

test('an edit during a pending save remains durable and saves after the first revision', async () => {
  const value = job(); await saveWorkspaceLocally(value);
  const fetch = globalThis.fetch; const started = deferred(); const resume = deferred(); let count = 0;
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)); const result = await fetch(input, init);
    if (body.action === 'saveWorkspace' && ++count === 1) { started.release(); await resume.promise; }
    return result;
  };
  const syncing = syncWorkspaces(); await started.promise;
  value.record.customer.customerName = 'Newer device edit'; await saveWorkspaceLocally(value);
  resume.release(); await syncing;
  const row = await cachedWorkspace(value.id);
  assert.equal(row?.workspace.record.customer.customerName, 'Newer device edit');
  assert.equal(row?.serverRevision, 2); assert.equal(row?.dirty, false);
  assert.equal(backend.post({ action: 'openWorkspace', workspaceId: value.id }).workspace.record.customer.customerName, 'Newer device edit');
});

test('conflicts preserve device edits until explicit device or server resolution', async () => {
  const value = job(); await saveWorkspaceLocally(value); await syncWorkspaces();
  const remote = backend.post({ action: 'openWorkspace', workspaceId: value.id }).workspace;
  remote.record.customer.customerName = 'Another device';
  assert.equal(backend.post({ action: 'saveWorkspace', workspace: remote, expectedRevision: 1, mutationId: 'other-device' }).ok, true);
  value.record.customer.customerName = 'Local conflict'; await saveWorkspaceLocally(value);
  await assert.rejects(syncWorkspaces(), /changed|conflict/i);
  assert.equal((await cachedWorkspace(value.id))?.workspace.record.customer.customerName, 'Local conflict');
  assert.equal((await cachedWorkspace(value.id))?.conflict, true);
  await resolveWorkspaceConflict(value.id, 'device'); await syncWorkspaces();
  assert.equal((await cachedWorkspace(value.id))?.serverRevision, 3);
  await resolveWorkspaceConflict(value.id, 'server');
  assert.equal((await cachedWorkspace(value.id))?.dirty, false);
});

test('a failed unrelated job cannot block flushing a successfully synced job', async () => {
  const good = job('Good'); const bad = job('Bad');
  await saveWorkspaceLocally(good); await saveWorkspaceLocally(bad);
  const fetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.workspace?.id === bad.id) throw new TypeError('Bad job unavailable');
    return fetch(input, init);
  };
  const saved = await flushWorkspace(good.id);
  assert.equal(saved.record.customer.customerName, 'Good');
  assert.ok((await cachedWorkspace(bad.id))?.inFlight);
  assert.match(workspaceSyncError(), /Bad job/);
});

test('malformed workspace acknowledgments cannot clear a durable pending save', async () => {
  const value = job(); await saveWorkspaceLocally(value);
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, workspace: { ...value, revision: 0 } }));
  await assert.rejects(syncWorkspaces(), /revision|acknowledge/i);
  const row = await cachedWorkspace(value.id); assert.ok(row?.inFlight); assert.equal(row?.serverRevision, 0);
});

test('an earlier cross-tab acknowledgment cannot replace a newer saved revision', async () => {
  const value = job(); await saveWorkspaceLocally(value);
  const fetch = globalThis.fetch; const started = deferred(); const resume = deferred();
  globalThis.fetch = async (input, init) => { const response = await fetch(input, init); started.release(); await resume.promise; return response; };
  const syncing = syncWorkspaces(); await started.promise;
  const newest = structuredClone(value); newest.revision = 2; newest.record.customer.customerName = 'Newer tab acknowledged';
  await updateWorkspaceRow(value.id, () => ({ workspace: newest, serverRevision: 2, dirty: false }));
  resume.release(); await syncing;
  assert.equal((await cachedWorkspace(value.id))?.workspace.record.customer.customerName, 'Newer tab acknowledged');
  assert.equal((await cachedWorkspace(value.id))?.serverRevision, 2);
});

for (const loseResponse of [false, true]) {
  test(`queued PDF ${loseResponse ? 'lost response' : 'failed upload'} retry preserves IDs and bytes`, async () => {
    const value = job(); await saveWorkspaceLocally(value); await syncWorkspaces();
    const bytes = new TextEncoder().encode('%PDF-1.4\nimmutable PDF\n%%EOF'); const original = bytes.slice();
    const queued = await queueJobDocument(value, 'contract', 'contract.pdf', bytes); bytes.fill(0);
    const fetch = globalThis.fetch; const payloads: any[] = [];
    globalThis.fetch = async (input, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.action === 'saveJobDocument') {
        payloads.push(body);
        if (payloads.length === 1) { if (loseResponse) await fetch(input, init); throw new TypeError('Upload interrupted'); }
      }
      return fetch(input, init);
    };
    await assert.rejects(syncWorkspaces(), /Upload interrupted/);
    assert.equal((await cachedJobDocuments(value.id))[0].pending, true);
    await syncWorkspaces(); assert.deepEqual(payloads[0], payloads[1]);
    const document = (await cachedJobDocuments(value.id))[0]; assert.equal(document.pending, false);
    assert.equal(document.document.id, queued.document.id); assert.ok(document.document.driveFileId);
    assert.deepEqual(new Uint8Array(await (await fetchJobDocument(document.document)).arrayBuffer()), original);
    assert.equal(backend.post({ action: 'listJobDocuments', workspaceId: value.id }).documents.length, 1);
  });
}

test('malformed PDF acknowledgments cannot mark an upload shared', async () => {
  const value = job(); await saveWorkspaceLocally(value); await syncWorkspaces();
  const queued = await queueJobDocument(value, 'contract', 'contract.pdf', new TextEncoder().encode('%PDF-1.4\n%%EOF'));
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, document: queued.document }));
  await assert.rejects(syncWorkspaces(), /document|acknowledge/i);
  assert.equal((await cachedJobDocuments(value.id))[0].pending, true);
});

test('offline changes stay on device and recover when connectivity returns', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  try {
    const value = job(); await saveWorkspaceLocally(value);
    await assert.rejects(flushWorkspace(value.id), /device|sync/i);
    assert.equal((await cachedWorkspace(value.id))?.dirty, true);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
    const saved = await flushWorkspace(value.id); assert.equal(saved.revision, 1);
  } finally { if (original) Object.defineProperty(globalThis, 'navigator', original); else Reflect.deleteProperty(globalThis, 'navigator'); }
});

test('a stale cross-tab conflict response cannot mark a newer saved revision conflicted', async () => {
  const value = job(); await saveWorkspaceLocally(value);
  const started = deferred(); const resume = deferred();
  globalThis.fetch = async () => { started.release(); await resume.promise; return new Response(JSON.stringify({ ok: false, code: 'CONFLICT', error: 'An earlier mutation conflicted' })); };
  const syncing = syncWorkspaces(); await started.promise;
  const newest = structuredClone(value); newest.revision = 2;
  await updateWorkspaceRow(value.id, () => ({ workspace: newest, serverRevision: 2, dirty: false }));
  resume.release(); await assert.rejects(syncing, /conflicted/);
  const row = await cachedWorkspace(value.id); assert.equal(row?.serverRevision, 2); assert.equal(row?.conflict, undefined); assert.equal(row?.error, undefined);
});

test('queuing a PDF freezes its bytes before asynchronous fingerprinting returns', async () => {
  const value = job();
  const bytes = new TextEncoder().encode('%PDF-1.4\noriginal bytes\n%%EOF'); const original = bytes.slice();
  const queuing = queueJobDocument(value, 'contract', 'contract.pdf', bytes);
  bytes.fill(0);
  const row = await queuing;
  assert.deepEqual(new Uint8Array(await (await fetchJobDocument(row.document)).arrayBuffer()), original);
});


test('refreshing and reopening jobs cannot replace unsynced device edits', async () => {
  const value = job(); await saveWorkspaceLocally(value); await syncWorkspaces();
  value.record.customer.customerName = 'Unsynced correction'; await saveWorkspaceLocally(value);
  await refreshWorkspaces(); await loadWorkspace(value.id);
  assert.equal((await cachedWorkspace(value.id))?.workspace.record.customer.customerName, 'Unsynced correction');
  assert.equal((await cachedWorkspace(value.id))?.dirty, true);
});

test('PDF metadata refresh retains queued uploads and cached byte downloads', async () => {
  const value = job(); await saveWorkspaceLocally(value); await syncWorkspaces();
  const first = await queueJobDocument(value, 'contract', 'first.pdf', new TextEncoder().encode('%PDF-1.4\nfirst PDF\n%%EOF'));
  await syncWorkspaces();
  const fetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (JSON.parse(String(init?.body)).action === 'saveJobDocument') throw new TypeError('Upload held for metadata refresh');
    return fetch(input, init);
  };
  const second = await queueJobDocument(value, 'contract', 'second.pdf', new TextEncoder().encode('%PDF-1.4\nsecond PDF\n%%EOF'));
  const rows = await refreshJobDocuments(value.id);
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.document.id === second.document.id)?.pending, true);
  assert.ok(rows.find(row => row.document.id === first.document.id)?.data);
});

test('stale editors merge independent fields while preserving both conflicting drafts', async () => {
  const value = job(); await saveWorkspaceLocally(value); await syncWorkspaces();
  const baseline = (await cachedWorkspace(value.id))!.workspace;
  const first = structuredClone(baseline); first.record.customer.customerName = 'First tab';
  await saveWorkspaceLocally(first, baseline);
  const second = structuredClone(baseline); second.record.customer.mainPhone = '555';
  await saveWorkspaceLocally(second, baseline);
  assert.equal((await cachedWorkspace(value.id))?.workspace.record.customer.customerName, 'First tab');
  assert.equal((await cachedWorkspace(value.id))?.workspace.record.customer.mainPhone, '555');
  const competing = structuredClone(baseline); competing.record.customer.customerName = 'Second tab';
  await saveWorkspaceLocally(competing, baseline);
  const conflict = (await cachedWorkspace(value.id))!;
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.workspace.record.customer.customerName, 'First tab');
  assert.equal(conflict.localConflict?.record.customer.customerName, 'Second tab');
  assert.equal(conflict.localConflict?.record.customer.mainPhone, '555');
  await resolveWorkspaceConflict(value.id, 'device');
  assert.equal((await cachedWorkspace(value.id))?.workspace.record.customer.customerName, 'Second tab');
  assert.equal((await cachedWorkspace(value.id))?.localConflict, undefined);
  await syncWorkspaces();
  assert.equal(backend.post({ action: 'openWorkspace', workspaceId: value.id }).workspace.record.customer.mainPhone, '555');
});

test('choosing the other local tab preserves its pending immutable transaction', async () => {
  const value = job(); await saveWorkspaceLocally(value); await syncWorkspaces();
  const baseline = (await cachedWorkspace(value.id))!.workspace;
  const first = structuredClone(baseline); first.record.customer.customerName = 'First tab';
  await saveWorkspaceLocally(first, baseline);
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('Offline'); };
  await assert.rejects(syncWorkspaces(), /Offline/);
  const pending = (await cachedWorkspace(value.id))!.inFlight;
  const second = structuredClone(baseline); second.record.customer.customerName = 'Second tab';
  await saveWorkspaceLocally(second, baseline);
  await resolveWorkspaceConflict(value.id, 'server');
  const kept = (await cachedWorkspace(value.id))!;
  assert.equal(kept.workspace.record.customer.customerName, 'First tab');
  assert.deepEqual(kept.inFlight, pending);
  assert.equal(kept.localConflict, undefined);
  globalThis.fetch = fetch; await syncWorkspaces();
});

for (const newerLocal of [false, true]) test(`lost response replay after another device saves recovers ${newerLocal ? 'with a local draft' : 'without local edits'}`, async () => {
  const value = job(); await saveWorkspaceLocally(value);
  const fetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => { await fetch(input, init); throw new TypeError('Lost response'); };
  await assert.rejects(syncWorkspaces(), /Lost response/);
  const remote = backend.post({ action: 'openWorkspace', workspaceId: value.id }).workspace;
  remote.record.customer.customerName = 'Another device';
  assert.equal(backend.post({ action: 'saveWorkspace', workspace: remote, expectedRevision: 1, mutationId: 'competing-device' }).ok, true);
  if (newerLocal) { value.record.customer.mainPhone = 'New local phone'; await saveWorkspaceLocally(value); }
  globalThis.fetch = fetch;
  if (newerLocal) {
    await assert.rejects(syncWorkspaces(), /changed|conflict/i);
    const row = (await cachedWorkspace(value.id))!;
    assert.equal(row.conflict, true); assert.equal(row.inFlight, undefined);
    assert.equal(row.workspace.record.customer.mainPhone, 'New local phone');
    await resolveWorkspaceConflict(value.id, 'server');
  } else await syncWorkspaces();
  assert.equal((await cachedWorkspace(value.id))?.workspace.record.customer.customerName, 'Another device');
  assert.equal((await cachedWorkspace(value.id))?.serverRevision, 2);
});

test('a later workspace revision without the matching mutation receipt cannot clear an in-flight save', async () => {
  const value = job(); await saveWorkspaceLocally(value);
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, workspace: { ...value, revision: 2 }, mutation: { id: 'unrelated-mutation', revision: 1 } }));
  await assert.rejects(syncWorkspaces(), /acknowledge/i);
  assert.ok((await cachedWorkspace(value.id))?.inFlight);
  assert.equal((await cachedWorkspace(value.id))?.serverRevision, 0);
});

test('a refresh started before a save cannot roll the acknowledged workspace backward', async () => {
  const value = job(); await saveWorkspaceLocally(value); await syncWorkspaces();
  const fetch = globalThis.fetch; const started = deferred(); const resume = deferred();
  globalThis.fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (JSON.parse(String(init?.body)).action === 'listWorkspaces') { started.release(); await resume.promise; }
    return response;
  };
  const refreshing = refreshWorkspaces(); await started.promise;
  value.record.customer.customerName = 'Acknowledged newer edit'; await saveWorkspaceLocally(value); await syncWorkspaces();
  resume.release(); await refreshing;
  assert.equal((await cachedWorkspace(value.id))?.serverRevision, 2);
  assert.equal((await cachedWorkspace(value.id))?.workspace.record.customer.customerName, 'Acknowledged newer edit');
});
