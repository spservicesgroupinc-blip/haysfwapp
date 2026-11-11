import { workspaceApi } from './workspaceApi';
import { ApiError } from './storage';
import { readWorkspaceRows, readWorkspaceRow, updateWorkspaceRow, readDocumentRows, readDocumentRow, updateDocumentRow } from '../workspaces/localStore';
import type { Workspace, WorkspaceRow, JobDocument, DocumentRow } from '../workspaces/types';
export type { Workspace, WorkspaceRow, JobDocument, DocumentRow } from '../workspaces/types';

const listeners = new Set<() => void>();
let channel: BroadcastChannel | undefined;
const emit = () => { listeners.forEach(listener => listener()); channel?.postMessage('changed'); };
export const subscribeWorkspaces = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | undefined;
let retryDelay = 3000;
let initialized = false;
let lastSyncError = '';
export const workspaceSyncError = () => lastSyncError;

function schedule(delay = 2000) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = undefined; void syncWorkspaces().catch(() => undefined); }, delay);
  // Browser timers are numeric; Node test timers should not hold the process open.
  if (typeof timer === 'object' && 'unref' in timer) timer.unref();
}

export function startWorkspaceSync(): () => void {
  if (initialized || typeof window === 'undefined') return () => undefined;
  initialized = true;
  channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('hays-workspace-events') : undefined;
  if (channel) channel.onmessage = () => listeners.forEach(listener => listener());
  const resume = () => schedule(0);
  window.addEventListener('online', resume);
  resume();
  return () => { window.removeEventListener('online', resume); channel?.close(); channel = undefined; initialized = false; if (timer) clearTimeout(timer); };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
}

/** Apply only this editor's changed leaves to the latest durable copy. */
function mergeEdits(baseline: Workspace, edited: Workspace, latest: Workspace): { workspace: Workspace; collision: boolean } {
  let collision = false;
  const merge = (base: unknown, next: unknown, current: unknown, path: string): unknown => {
    if (['revision', 'updatedAt', 'record.updatedAt'].includes(path) || sameValue(base, next)) return structuredClone(current);
    if (base && next && current && typeof base === 'object' && typeof next === 'object' && typeof current === 'object' && !Array.isArray(base) && !Array.isArray(next) && !Array.isArray(current)) {
      const before = base as Record<string, unknown>, after = next as Record<string, unknown>, saved = current as Record<string, unknown>;
      return Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after), ...Object.keys(saved)])].map(key => [key, merge(before[key], after[key], saved[key], path ? `${path}.${key}` : key)]));
    }
    if (!sameValue(base, current) && !sameValue(next, current)) collision = true;
    return structuredClone(next);
  };
  return { workspace: merge(baseline, edited, latest, '') as Workspace, collision };
}

export async function saveWorkspaceLocally(workspace: Workspace, baseline?: Workspace): Promise<WorkspaceRow> {
  const next = structuredClone(workspace);
  next.updatedAt = new Date().toISOString();
  next.record.recordId = next.id;
  const result = await updateWorkspaceRow(next.id, current => {
    const merged = current && baseline ? mergeEdits(baseline, next, current.localConflict ?? current.workspace) : { workspace: next, collision: false };
    merged.workspace.updatedAt = next.updatedAt;
    if (current && (merged.collision || current.localConflict)) return { ...current, localConflict: merged.workspace, conflict: true, error: 'This job has competing edits in another tab. Choose which device draft to keep.' };
    return { ...current, workspace: merged.workspace, serverRevision: current?.serverRevision ?? next.revision, dirty: true, error: current?.conflict ? current.error : undefined };
  });
  emit(); schedule();
  return result!;
}

export const cachedWorkspaces = () => readWorkspaceRows();
export const cachedWorkspace = (id: string) => readWorkspaceRow(id);

function validWorkspace(value: Workspace) {
  if (!value || typeof value.id !== 'string' || (!Number.isInteger(value.revision) || value.revision < 0) || !value.record?.customer || !value.record?.financials || typeof value.originalContract !== 'string' || typeof value.previousChanges !== 'string') throw new Error('The workspace service returned an invalid job.');
  return value;
}

async function cacheServer(workspace: Workspace) {
  validWorkspace(workspace);
  await updateWorkspaceRow(workspace.id, current => current?.dirty || current?.inFlight || current?.conflict || (current && current.serverRevision > workspace.revision) ? current : { workspace, serverRevision: workspace.revision, dirty: false });
}

export async function refreshWorkspaces(): Promise<WorkspaceRow[]> {
  const result = await workspaceApi<{ workspaces: Workspace[] }>('listWorkspaces');
  if (!Array.isArray(result.workspaces)) throw new Error('The workspace service returned an invalid job list.');
  for (const workspace of result.workspaces) await cacheServer(workspace);
  emit();
  return readWorkspaceRows();
}

export async function loadWorkspace(id: string): Promise<WorkspaceRow | undefined> {
  const result = await workspaceApi<{ workspace: Workspace }>('openWorkspace', { workspaceId: id });
  await cacheServer(result.workspace); emit();
  return readWorkspaceRow(id);
}

async function syncWorkspace(id: string): Promise<void> {
  // Freeze and persist the mutation before sending it. Unknown outcomes retry the same payload.
  let row = await updateWorkspaceRow(id, current => {
    if (!current || current.conflict || current.inFlight || !current.dirty) return current;
    return { ...current, dirty: false, inFlight: { workspace: structuredClone(current.workspace), expectedRevision: current.serverRevision, mutationId: crypto.randomUUID() }, error: undefined };
  });
  while (row?.inFlight && !row.conflict) {
    const sending = row.inFlight;
    try {
      const result = await workspaceApi<{ workspace: Workspace; mutation?: { id: string; revision: number } }>('saveWorkspace', sending);
      const saved = validWorkspace(result.workspace);
      if (saved.id !== id) throw new Error('The server acknowledged a different job.');
      const acknowledgedRevision = sending.expectedRevision + 1;
      const laterReplay = saved.revision > acknowledgedRevision && result.mutation?.id === sending.mutationId && result.mutation.revision === acknowledgedRevision;
      if (saved.revision !== acknowledgedRevision && !laterReplay) throw new Error('The server did not acknowledge the expected job revision.');
      await updateWorkspaceRow(id, current => {
        if (!current || current.inFlight?.mutationId !== sending.mutationId) return current;
        if (current.localConflict) return { ...current, workspace: { ...current.workspace, revision: saved.revision }, serverRevision: saved.revision, inFlight: undefined };
        if (laterReplay && current.dirty) return { ...current, workspace: { ...current.workspace, revision: saved.revision }, serverRevision: saved.revision, inFlight: undefined, conflict: true, error: 'This job changed on another device after your save. Choose which changes to keep.' };
        return { ...current, workspace: current.dirty ? { ...current.workspace, revision: saved.revision } : saved, serverRevision: saved.revision, inFlight: undefined, error: undefined };
      });
      emit();
      // A newer edit gets its own mutation with the acknowledged revision.
      row = await updateWorkspaceRow(id, current => current?.dirty && !current.inFlight && !current.conflict ? { ...current, dirty: false, inFlight: { workspace: structuredClone(current.workspace), expectedRevision: current.serverRevision, mutationId: crypto.randomUUID() } } : current);
    } catch (error) {
      const conflict = error instanceof ApiError && error.code === 'CONFLICT';
      await updateWorkspaceRow(id, current => current?.inFlight?.mutationId === sending.mutationId ? { ...current, error: error instanceof Error ? error.message : String(error), conflict } : current);
      emit(); throw error;
    }
  }
  if (row?.conflict) throw new ApiError(row.error || 'This job changed on another device.', 'CONFLICT');
}

export function syncWorkspaces(): Promise<void> {
  if (running) return running;
  running = (async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    let failure: unknown;
    for (const row of await readWorkspaceRows()) {
      if (!row.dirty && !row.inFlight) continue;
      try { await syncWorkspace(row.workspace.id); } catch (error) { failure = error; }
    }
    for (const row of await readDocumentRows()) {
      if (!row.pending) continue;
      const job = await readWorkspaceRow(row.document.workspaceId);
      if (!job || job.dirty || job.inFlight || job.conflict || !job.serverRevision) continue;
      try {
        const { document, data, mutationId } = row;
        const result = await workspaceApi<{ document: JobDocument }>('saveJobDocument', { workspaceId: document.workspaceId, documentId: document.id, mutationId, kind: document.kind, inputFingerprint: document.inputFingerprint, templateVersion: document.templateVersion, file: { name: document.name, mimeType: 'application/pdf', size: atob(data!).length, data } });
        if (!validDocument(result.document) || result.document.id !== document.id || result.document.workspaceId !== document.workspaceId || result.document.inputFingerprint !== document.inputFingerprint || result.document.templateVersion !== document.templateVersion || result.document.kind !== document.kind) throw new Error('The server did not acknowledge the document.');
        await updateDocumentRow(document.id, current => current ? { ...current, document: result.document, pending: false, error: undefined } : current); emit();
      } catch (error) {
        await updateDocumentRow(row.document.id, current => current ? { ...current, error: error instanceof Error ? error.message : String(error) } : current); emit(); failure = error;
      }
    }
    if (failure) throw failure;
  })().then(() => { lastSyncError = ''; retryDelay = 3000; }, error => { lastSyncError = error instanceof Error ? error.message : String(error); schedule(retryDelay); retryDelay = Math.min(retryDelay * 2, 60000); throw error; }).finally(() => { running = undefined; emit(); });
  return running;
}

export async function flushWorkspace(id: string): Promise<Workspace> {
  // Other jobs may need attention; only this job determines whether it can proceed.
  await syncWorkspaces().catch(() => undefined);
  const row = await readWorkspaceRow(id);
  if (!row || row.dirty || row.inFlight || row.conflict || !row.serverRevision) throw new Error(row?.error || 'This job is saved on this device and still needs to sync. Connect and retry.');
  return row.workspace;
}

/** Explicit conflict resolution; newer edits remain on-device until a person chooses. */
export async function resolveWorkspaceConflict(id: string, choice: 'device' | 'server') {
  let resolvedLocally = false;
  await updateWorkspaceRow(id, current => {
    if (!current?.localConflict) return current;
    resolvedLocally = true;
    return { ...current, workspace: choice === 'device' ? { ...current.localConflict, revision: current.serverRevision } : current.workspace, dirty: choice === 'device' || current.dirty, localConflict: undefined, conflict: undefined, error: undefined };
  });
  if (resolvedLocally) { emit(); schedule(0); return; }
  const result = await workspaceApi<{ workspace: Workspace }>('openWorkspace', { workspaceId: id });
  const remote = validWorkspace(result.workspace);
  await updateWorkspaceRow(id, current => choice === 'device' && current ? { workspace: { ...current.workspace, revision: remote.revision }, serverRevision: remote.revision, dirty: true } : { workspace: remote, serverRevision: remote.revision, dirty: false });
  emit(); if (choice === 'device') schedule(0);
}

export async function documentFingerprint(kind: string, record: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([1, kind, record]));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function encode(bytes: Uint8Array) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}

export async function queueJobDocument(workspace: Workspace, kind: string, name: string, bytes: Uint8Array): Promise<DocumentRow> {
  if (bytes.length > 15 * 1024 * 1024) throw new Error('The PDF exceeds the 15 MB upload limit.');
  // Capture bytes synchronously; the caller may reuse its buffer while hashing.
  const data = encode(bytes);
  const document: JobDocument = { id: crypto.randomUUID(), workspaceId: workspace.id, name, kind, driveFileId: '', inputFingerprint: await documentFingerprint(kind, workspace.record), templateVersion: 1, createdAt: new Date().toISOString() };
  const row: DocumentRow = { document, data, pending: true, mutationId: crypto.randomUUID() };
  await updateDocumentRow(document.id, () => row); emit(); schedule(0);
  return row;
}

export const cachedJobDocuments = (workspaceId: string) => readDocumentRows(workspaceId);

function validDocument(value: JobDocument): boolean {
  return !!value && typeof value.id === 'string' && !!value.id && typeof value.workspaceId === 'string' && !!value.workspaceId && typeof value.driveFileId === 'string' && !!value.driveFileId && typeof value.name === 'string' && typeof value.kind === 'string' && typeof value.inputFingerprint === 'string' && Number.isInteger(value.templateVersion) && value.templateVersion > 0 && typeof value.createdAt === 'string';
}

export async function refreshJobDocuments(workspaceId: string): Promise<DocumentRow[]> {
  const result = await workspaceApi<{ documents: JobDocument[] }>('listJobDocuments', { workspaceId });
  if (!Array.isArray(result.documents)) throw new Error('The workspace service returned an invalid document list.');
  for (const document of result.documents) {
    if (!validDocument(document)) throw new Error('The document service returned invalid document metadata.');
    if (document.workspaceId !== workspaceId) throw new Error('The document belongs to another job.');
    await updateDocumentRow(document.id, current => current?.pending ? current : { ...current, document, pending: false });
  }
  emit(); return readDocumentRows(workspaceId);
}

export async function fetchJobDocument(document: JobDocument): Promise<Blob> {
  const cached = await readDocumentRow(document.id);
  if (cached?.document.workspaceId !== document.workspaceId && cached) throw new Error('This document belongs to another job.');
  let data = cached?.data;
  if (!data) {
    const result = await workspaceApi<{ name: string; mimeType: string; data: string }>('fetchJobDocument', { workspaceId: document.workspaceId, documentId: document.id });
    if (result.mimeType !== 'application/pdf' || typeof result.data !== 'string') throw new Error('The document service returned an invalid PDF.');
    data = result.data;
    await updateDocumentRow(document.id, () => ({ document, data, pending: false }));
  }
  return new Blob([Uint8Array.from(atob(data), value => value.charCodeAt(0))], { type: 'application/pdf' });
}
