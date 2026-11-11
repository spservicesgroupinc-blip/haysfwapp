import { callAuthenticatedAppsScript, getCurrentUser, isDeveloperBypassEnabled, DatabaseError } from './appsScriptService';
import { acknowledgeWorkspace, cacheWorkspace, getOutboxOps, getWorkspaceCache, queueWorkspaceMutation, reconcileWorkspace, type OutboxOp } from './localDb';
import type { WorkspaceEntity, WorkspaceMutation, WorkspaceSnapshot, StaffMember } from '../types/jobWorkspace';

const listeners = new Set<() => void>();
export const subscribeWorkspace = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const notifyWorkspace = () => { for (const listener of listeners) listener(); };
export function workspaceOwner(): string {
  if (isDeveloperBypassEnabled()) return 'dev';
  const email = getCurrentUser()?.email.toLowerCase();
  if (!email) throw new Error('Sign in to open the job dashboard.');
  return email;
}
export async function readWorkspace(recordId: string) {
  const owner = workspaceOwner();
  const snapshot = await getWorkspaceCache(owner, recordId);
  const pending = (await getOutboxOps()).filter(op => op.type === 'workspace' && op.owner === owner && op.recordId === recordId);
  const entities = new Map((snapshot?.entities ?? []).map(e => [`${e.kind}:${e.id}`, e]));
  for (const op of pending) {
    const m = op.mutation!;
    if (m.kind === 'contract' || (m.kind === 'changeOrder' && ['Approved', 'Voided'].includes(m.data.status))) continue;
    entities.set(`${m.kind}:${m.id}`, { id: m.id, recordId, kind: m.kind, revision: m.expectedRevision + 1,
      data: m.data, updatedAt: new Date(op.createdAt).toISOString(), updatedBy: owner });
  }
  return { snapshot, entities: [...entities.values()], pending };
}
export async function refreshWorkspace(recordId: string): Promise<void> {
  const owner = workspaceOwner();
  try {
    type Page = Omit<WorkspaceSnapshot, 'staff'> & { totalEntities: number; totalActivity: number };
    const first = await callAuthenticatedAppsScript<Page>('getJobWorkspace', { recordId, page: 1, pageSize: 100 });
    if (!Array.isArray(first?.entities) || !Array.isArray(first?.activity)) throw new DatabaseError('The dashboard response was invalid.', 'bad_response');
    const entities = [...first.entities];
    const activity = [...first.activity];
    const pages = Math.ceil(Math.max(first.totalEntities, first.totalActivity) / 100);
    for (let page = 2; page <= pages; page++) {
      const next = await callAuthenticatedAppsScript<Page>('getJobWorkspace', { recordId, page, pageSize: 100 });
      entities.push(...next.entities); activity.push(...next.activity);
    }
    const { staff } = await callAuthenticatedAppsScript<{ staff: StaffMember[] }>('listAssignableStaff');
    if (owner !== workspaceOwner()) return;
    await cacheWorkspace(owner, recordId, { entities, activity, staff, fetchedAt: first.fetchedAt });
    notifyWorkspace();
  } catch (error) {
    if (error instanceof DatabaseError && error.code === 'unknown_action') throw new DatabaseError('The job dashboard needs the updated Apps Script backend deployed as a new version. Existing document forms are still available.', 'unknown_action');
    throw error;
  }
}
export async function saveWorkspaceMutation(mutation: WorkspaceMutation): Promise<void> {
  const user = getCurrentUser();
  if (!isDeveloperBypassEnabled() && !['admin', 'editor'].includes(user?.role ?? '')) throw new Error('Your account has read-only access.');
  await queueWorkspaceMutation(workspaceOwner(), mutation);
  notifyWorkspace();
}
export async function pushWorkspaceOperation(op: OutboxOp): Promise<void> {
  const result = await callAuthenticatedAppsScript<WorkspaceEntity>('mutateJobWorkspace', { ...op.mutation });
  if (!result?.id || !Number.isInteger(result.revision)) throw new DatabaseError('The dashboard write was not acknowledged.', 'bad_response');
  await acknowledgeWorkspace(op, result);
  notifyWorkspace();
}
export async function resolveWorkspaceConflict(recordId: string, local: WorkspaceEntity, keepLocal: boolean): Promise<void> {
  const owner = workspaceOwner();
  await refreshWorkspace(recordId);
  const cache = await getWorkspaceCache(owner, recordId);
  const latest = cache?.entities.find(e => e.kind === local.kind && e.id === local.id);
  // Never reapply a stale financial decision automatically.
  if (keepLocal && (local.kind === 'contract' || ['Approved', 'Voided'].includes(local.data.status))) throw new Error('Use the latest version and review this financial decision again.');
  await reconcileWorkspace(owner, recordId, local.kind, local.id, keepLocal ? { operationId: crypto.randomUUID(), recordId, kind: local.kind,
    id: local.id, data: local.data, expectedRevision: latest?.revision ?? 0 } : undefined);
  notifyWorkspace();
}
