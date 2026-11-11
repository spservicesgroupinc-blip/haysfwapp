import { createHash, randomUUID } from 'node:crypto';
import type { Workspace, JobDocument } from '../src/workspaces/types.ts';

type Payload = Record<string, any>;
type Result = Record<string, any>;
interface LocalRequest { id: string; revision: number; updatedAt: string; workspaceId?: string }
class LocalApiError extends Error {
  constructor(readonly code: string, message: string, readonly currentRevision?: number) { super(message); }
}
function fail(code: string, message: string, revision?: number): never { throw new LocalApiError(code, message, revision); }
const canonical = (value: any): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const identifier = (value: unknown, label: string): string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : fail('VALIDATION', `A valid ${label} identifier is required.`);
function mutation(body: Payload) {
  identifier(body.mutationId, 'mutation');
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) fail('VALIDATION', 'A valid expected revision is required.');
}
function money(value: unknown): string {
  if (typeof value !== 'string' || value.length > 40) fail('VALIDATION', 'Enter a decimal dollar amount.');
  const text = value.trim(); if (!text) return '';
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(text)) fail('VALIDATION', 'Dollar amounts must have at most two decimal places.');
  const [whole, fraction = ''] = text.replace(/^[+-]/, '').split('.');
  const normalized = whole.replace(/^0+(?=\d)/, ''); const cents = fraction.padEnd(2, '0');
  if (normalized.length > 13) fail('VALIDATION', 'Dollar amount is too large.');
  return `${text.startsWith('-') && (normalized !== '0' || cents !== '00') ? '-' : ''}${normalized}.${cents}`;
}
function jobStage(value: unknown): string {
  if (typeof value !== 'string' || !['lead', 'in_progress', 'complete', 'closed'].includes(value)) fail('VALIDATION', 'Choose a valid job stage.');
  return value;
}
function customerIdField(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100) fail('VALIDATION', 'Invalid customer identifier.');
  return value;
}
function workspaceShape(input: Payload): Workspace {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('VALIDATION', 'A workspace is required.');
  identifier(input.id, 'workspace');
  const sections = ['branch', 'customer', 'insurance', 'financials', 'team', 'mortgage', 'changeOrder', 'productionNotes', 'checklist'];
  const roots = ['id', 'recordId', 'dateCreated', 'updatedAt', 'schemaVersion'];
  if (!input.record || typeof input.record !== 'object' || Array.isArray(input.record)) fail('VALIDATION', 'A job record is required.');
  for (const key of Object.keys(input.record)) if (!sections.includes(key) && !roots.includes(key)) fail('VALIDATION', `Unknown job record section: ${key}`);
  for (const section of sections) {
    const values = input.record[section];
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > 200) fail('VALIDATION', `Invalid job ${section} section.`);
    for (const [key, value] of Object.entries(values)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key) || key.length > 100 || !(value === null || typeof value === 'boolean' || typeof value === 'string' && value.length <= 100000 || typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e13)) fail('VALIDATION', `Invalid value in job ${section}.`);
    }
  }
  const workspace = { id: input.id, revision: 0, updatedAt: '', record: structuredClone(input.record), originalContract: money(input.originalContract), previousChanges: money(input.previousChanges), ...(input.stage === undefined ? {} : { stage: jobStage(input.stage) }), ...(input.customerId === undefined ? {} : { customerId: customerIdField(input.customerId) }), ...(input.sourceRecordId === undefined ? {} : { sourceRecordId: input.sourceRecordId }), ...(input.migration === undefined ? {} : { migration: structuredClone(input.migration) }) } as Workspace;
  if (Buffer.byteLength(JSON.stringify(workspace)) > 1000000) fail('VALIDATION', 'This job record exceeds the supported 1 MB size.');
  return workspace;
}

/** Explicit local /__api__ fixture only. Never imported by the browser application.
 * State is isolated per Vite server and resets on restart; no live services are called.
 */
export function createWorkspaceDevApi<T extends LocalRequest>(requests: T[]) {
  const workspaces = new Map<string, { workspace: Workspace; mutations: Map<string, string> }>();
  const documents = new Map<string, { document: JobDocument; data: string; mutationId: string; hash: string }>();
  const links = new Map<string, Map<string, string>>();
  let reference: Payload = { customers: [], fileName: '', updatedAt: '', updatedBy: '', version: '' };
  const requireWorkspace = (id: unknown) => {
    const found = workspaces.get(identifier(id, 'workspace'));
    if (!found) fail('NOT_FOUND', 'Job workspace not found.');
    return found;
  };
  const respond = (action: string, body: Payload): Result | undefined => {
    if (action === 'listWorkspaces') return { ok: true, workspaces: [...workspaces.values()].map(item => item.workspace).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
    if (action === 'openWorkspace') return { ok: true, workspace: requireWorkspace(body.workspaceId).workspace };
    if (action === 'saveWorkspace') {
      mutation(body);
      const workspace = workspaceShape(body.workspace);
      const hash = digest([body.expectedRevision, workspace]); const current = workspaces.get(workspace.id);
      if (current?.mutations.has(body.mutationId)) {
        if (current.mutations.get(body.mutationId) !== hash) fail('MUTATION_MISMATCH', 'This save identifier was already used for different job data.');
        return { ok: true, workspace: current.workspace, mutation: { id: body.mutationId, revision: body.expectedRevision + 1 } };
      }
      const revision = current?.workspace.revision || 0;
      if (body.expectedRevision !== revision) fail('CONFLICT', 'This job changed in another window. Reload it before saving your edits.', revision);
      workspace.revision = revision + 1; workspace.updatedAt = new Date().toISOString();
      const mutations = new Map(current?.mutations); mutations.set(body.mutationId, hash);
      workspaces.set(workspace.id, { workspace, mutations }); return { ok: true, workspace, mutation: { id: body.mutationId, revision: body.expectedRevision + 1 } };
    }
    if (action === 'listJobDocuments') {
      requireWorkspace(body.workspaceId);
      return { ok: true, documents: [...documents.values()].filter(item => item.document.workspaceId === body.workspaceId).map(item => item.document).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
    }
    if (action === 'saveJobDocument') {
      requireWorkspace(body.workspaceId); identifier(body.documentId, 'document'); identifier(body.mutationId, 'mutation');
      const file = body.file;
      if (typeof body.kind !== 'string' || !body.kind.trim() || body.kind.length > 100 || typeof body.inputFingerprint !== 'string' || !body.inputFingerprint || body.inputFingerprint.length > 200 || !Number.isInteger(body.templateVersion) || body.templateVersion < 1 || !file || typeof file.name !== 'string' || !file.name.trim() || file.name.length > 300 || file.mimeType !== 'application/pdf' || !Number.isInteger(file.size) || file.size <= 0 || file.size > 15 * 1024 * 1024 || typeof file.data !== 'string' || file.data.length > 21 * 1024 * 1024 || file.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)) fail('VALIDATION', 'Choose a PDF up to 15 MB and provide its document details.');
      const bytes = Buffer.from(file.data, 'base64');
      if (bytes.length !== file.size || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') fail('VALIDATION', 'The file size or content does not match the selected PDF.');
      const name = file.name.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200);
      if (!name) fail('VALIDATION', 'A PDF filename is required.');
      const hash = digest([body.workspaceId, body.documentId, body.kind, body.inputFingerprint, body.templateVersion, name, file.mimeType, bytes.length, bytes.toString('base64')]);
      const existing = [...documents.values()].find(item => item.document.workspaceId === body.workspaceId && (item.document.id === body.documentId || item.mutationId === body.mutationId));
      if (existing) {
        if (existing.mutationId !== body.mutationId || existing.hash !== hash) fail('MUTATION_MISMATCH', 'This PDF identifier was already used for different content.');
        return { ok: true, document: existing.document };
      }
      const document: JobDocument = { id: body.documentId, workspaceId: body.workspaceId, name, kind: body.kind, driveFileId: `local-${randomUUID()}`, inputFingerprint: body.inputFingerprint, templateVersion: body.templateVersion, createdAt: new Date().toISOString() };
      documents.set(`${body.workspaceId}:${body.documentId}`, { document, data: bytes.toString('base64'), mutationId: body.mutationId, hash });
      return { ok: true, document };
    }
    if (action === 'fetchJobDocument') {
      requireWorkspace(body.workspaceId); identifier(body.documentId, 'document');
      const found = documents.get(`${body.workspaceId}:${body.documentId}`);
      if (!found) fail('NOT_FOUND', 'PDF not found for this job.');
      return { ok: true, name: found.document.name, mimeType: 'application/pdf', data: found.data };
    }
    if (action === 'linkRequestWorkspace') {
      mutation(body); requireWorkspace(body.workspaceId);
      const request = requests.find(item => item.id === body.id);
      if (!request) fail('NOT_FOUND', 'Request not found.');
      const mutations = links.get(request.id) || new Map<string, string>();
      if (mutations.has(body.mutationId)) {
        if (mutations.get(body.mutationId) !== body.workspaceId || request.workspaceId !== body.workspaceId) fail('CONFLICT', 'This retry refers to a different job.');
        return { ok: true, request };
      }
      if (request.revision !== body.expectedRevision) fail('CONFLICT', 'This request changed in another window. Reopen it before applying your edits.', request.revision);
      request.workspaceId = body.workspaceId; request.revision += 1; request.updatedAt = new Date().toISOString();
      mutations.set(body.mutationId, body.workspaceId); links.set(request.id, mutations);
      return { ok: true, request };
    }
    if (action === 'getCustomerReference') return { ok: true, reference };
    if (action === 'replaceCustomerReference') {
      if (!Array.isArray(body.customers) || body.customers.length < 1 || body.customers.length > 5000 || typeof body.fileName !== 'string' || !body.fileName.trim() || body.fileName.length > 300) fail('bad_request', 'Upload between 1 and 5000 customer records and provide a CSV filename.');
      const seen = new Set<string>();
      const customers = body.customers.map((item: Payload) => {
        if (!item || typeof item.customerName !== 'string' || !item.customerName.trim() || item.customerName.length > 300 || typeof item.jobNumber !== 'string' || !item.jobNumber.trim() || item.jobNumber.length > 100) fail('bad_request', 'Customer name and job number are required.');
        const price = item.contractPrice;
        if (price !== null && (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 1e12 || Math.abs(price * 100 - Math.round(price * 100)) > 0.01)) fail('bad_request', 'Invalid contract price.');
        const key = item.jobNumber.trim().toUpperCase();
        if (seen.has(key)) fail('bad_request', `Duplicate job number: ${item.jobNumber}`); seen.add(key);
        const customer: Payload = { customerName: item.customerName.trim(), jobNumber: item.jobNumber.trim(), contractPrice: price };
        for (const [field, limit] of Object.entries({ jobAddress: 500, city: 100, state: 100, zip: 20 })) {
          if (item[field] !== undefined && typeof item[field] !== 'string') fail('bad_request', 'Invalid address field.');
          customer[field] = (item[field] || '').trim(); if (customer[field].length > limit) fail('bad_request', 'Address field is too long.');
        }
        return customer;
      });
      reference = { customers, fileName: body.fileName.trim(), updatedAt: new Date().toISOString(), updatedBy: 'local-preview', version: randomUUID() };
      return { ok: true, reference };
    }
    if (action === 'analyzeIntake') return { ok: false, code: 'AI_NOT_CONFIGURED', error: 'AI analysis is unavailable in the local preview. Connect the configured Apps Script backend to use DeepSeek; no AI call was made.' };
    return undefined;
  };
  return (action: string, body: Payload): Result | undefined => {
    try { const result = respond(action, body); return result === undefined ? undefined : structuredClone(result); }
    catch (error) {
      if (error instanceof LocalApiError) return { ok: false, code: error.code, error: error.message, ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }) };
      throw error;
    }
  };
}

interface CustomerRecord { id: string; revision: number; createdAt: string; updatedAt: string; name: string; phone?: string; email?: string; address?: string; cityStateZip?: string; tags?: string[]; mergedFromIds?: string[] }
interface ActivityRecord { id: string; customerId: string; workspaceId?: string; kind: string; direction: string; body: string; at: string; by?: string }
interface TaskRecord { id: string; customerId: string; workspaceId?: string; title: string; dueDate?: string; assignee?: string; status: 'open' | 'done'; revision: number; createdAt: string; completedAt?: string }

const optionalText = (input: Payload, key: string, label: string, maxLength: number): string | undefined => {
  if (input[key] === undefined) return undefined;
  if (typeof input[key] !== 'string' || (input[key] as string).length > maxLength) fail('VALIDATION', `Invalid ${label}.`);
  return input[key] as string;
};

function customerRecord(input: Payload): CustomerRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('VALIDATION', 'A customer record is required.');
  const id = identifier(input.id, 'customer');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 300) fail('VALIDATION', 'A customer name is required.');
  const customer: CustomerRecord = { id, revision: 0, createdAt: '', updatedAt: '', name: input.name.trim() };
  for (const key of ['phone', 'email', 'address', 'cityStateZip'] as const) {
    const value = optionalText(input, key, `customer ${key}`, key === 'email' ? 300 : 1000);
    if (value !== undefined) (customer as any)[key] = value.trim();
  }
  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags) || input.tags.length > 100) fail('VALIDATION', 'Customer tags must be a short list.');
    customer.tags = input.tags.map((tag: unknown) => { if (typeof tag !== 'string' || tag.length > 100) fail('VALIDATION', 'Invalid customer tag.'); return tag; });
  }
  if (input.mergedFromIds !== undefined) {
    if (!Array.isArray(input.mergedFromIds) || input.mergedFromIds.length > 1000) fail('VALIDATION', 'Merged customer list is too large.');
    const seen = new Set<string>(); const merged: string[] = [];
    for (const value of input.mergedFromIds) { const v = identifier(value, 'merged customer'); if (!seen.has(v)) { seen.add(v); merged.push(v); } }
    customer.mergedFromIds = merged;
  }
  return customer;
}

function activityRecord(input: Payload): ActivityRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('VALIDATION', 'An activity is required.');
  const id = identifier(input.id, 'activity');
  const customerId = identifier(input.customerId, 'customer');
  if (typeof input.kind !== 'string' || !input.kind.trim() || input.kind.length > 100) fail('VALIDATION', 'An activity kind is required.');
  if (!['inbound', 'outbound', 'system'].includes(input.direction)) fail('VALIDATION', 'An activity direction is required.');
  if (typeof input.body !== 'string') fail('VALIDATION', 'An activity body is required.');
  if (typeof input.at !== 'string' || !input.at || input.at.length > 300) fail('VALIDATION', 'An activity time is required.');
  const activity: ActivityRecord = { id, customerId, kind: input.kind.trim(), direction: input.direction, body: input.body.slice(0, 100000), at: input.at };
  const workspaceId = optionalText(input, 'workspaceId', 'activity workspace', 100);
  if (workspaceId !== undefined) activity.workspaceId = workspaceId;
  const by = optionalText(input, 'by', 'activity author', 300);
  if (by !== undefined) activity.by = by;
  return activity;
}

function taskRecord(input: Payload): TaskRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('VALIDATION', 'A task is required.');
  const id = identifier(input.id, 'task');
  const customerId = identifier(input.customerId, 'customer');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 1000) fail('VALIDATION', 'A task title is required.');
  if (input.status !== 'open' && input.status !== 'done') fail('VALIDATION', 'A task status must be open or done.');
  const task: TaskRecord = { id, customerId, title: input.title.trim(), status: input.status, revision: 0, createdAt: '' };
  const workspaceId = optionalText(input, 'workspaceId', 'task workspace', 100);
  if (workspaceId !== undefined) task.workspaceId = workspaceId;
  for (const key of ['dueDate', 'assignee', 'completedAt'] as const) {
    const value = optionalText(input, key, `task ${key}`, 300);
    if (value !== undefined) (task as any)[key] = value.trim();
  }
  return task;
}

/** Explicit local /__api__ fixture only. Never imported by the browser application. */
export function createCrmDevApi() {
  const customers = new Map<string, { customer: CustomerRecord; mutations: Map<string, string> }>();
  const activities: { activity: ActivityRecord; mutationId: string }[] = [];
  const tasks = new Map<string, { task: TaskRecord; mutations: Map<string, string> }>();

  const respond = (action: string, body: Payload): Result | undefined => {
    if (action === 'listCustomers') {
      const rows = [...customers.values()].map(({ customer: c }) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address, tags: c.tags, jobCount: 0, openTaskCount: 0, updatedAt: c.updatedAt }));
      rows.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      return { ok: true, customers: rows };
    }
    if (action === 'openCustomer') {
      const found = customers.get(identifier(body.customerId, 'customer'));
      if (!found) fail('NOT_FOUND', 'Customer not found.');
      return { ok: true, customer: found.customer };
    }
    if (action === 'saveCustomer') {
      mutation(body);
      const customer = customerRecord(body.customer);
      const hash = digest([body.expectedRevision, customer]);
      const current = customers.get(customer.id);
      if (current?.mutations.has(body.mutationId)) {
        if (current.mutations.get(body.mutationId) !== hash) fail('MUTATION_MISMATCH', 'This customer save identifier was already used for different data.');
        return { ok: true, customer: current.customer };
      }
      const revision = current?.customer.revision || 0;
      if (revision !== body.expectedRevision) fail('CONFLICT', 'This customer changed in another window. Reload it before saving your edits.', revision);
      const now = new Date().toISOString();
      const stored = structuredClone(customer);
      stored.revision = revision + 1; stored.updatedAt = now; if (!current) stored.createdAt = now;
      const mutations = new Map(current?.mutations); mutations.set(body.mutationId, hash);
      customers.set(stored.id, { customer: stored, mutations });
      return { ok: true, customer: stored };
    }
    if (action === 'mergeCustomers') {
      const targetId = identifier(body.targetId, 'target customer');
      const sourceId = identifier(body.sourceId, 'source customer');
      if (targetId === sourceId) fail('VALIDATION', 'Choose two different customers to merge.');
      const target = customers.get(targetId);
      if (!target) fail('NOT_FOUND', 'Customer not found.');
      const source = customers.get(sourceId);
      if (!source) fail('NOT_FOUND', 'Source customer not found.');
      for (const item of activities) if (item.activity.customerId === sourceId) item.activity.customerId = targetId;
      for (const item of tasks.values()) if (item.task.customerId === sourceId) item.task.customerId = targetId;
      const stored = structuredClone(target.customer);
      const merged = stored.mergedFromIds ? stored.mergedFromIds.slice() : [];
      if (!merged.includes(sourceId)) merged.push(sourceId);
      stored.mergedFromIds = merged;
      stored.revision += 1; stored.updatedAt = new Date().toISOString();
      customers.set(targetId, { customer: stored, mutations: new Map(target.mutations) });
      customers.delete(sourceId);
      return { ok: true, customer: stored };
    }
    if (action === 'listActivities') {
      identifier(body.customerId, 'customer');
      const rows = activities.filter(item => item.activity.customerId === body.customerId).map(item => item.activity);
      rows.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
      return { ok: true, activities: rows };
    }
    if (action === 'addActivity') {
      identifier(body.mutationId, 'mutation');
      const activity = activityRecord(body.activity);
      const hash = digest(activity);
      const existing = activities.find(item => item.mutationId === body.mutationId);
      if (existing) {
        if (digest(existing.activity) !== hash) fail('MUTATION_MISMATCH', 'This activity identifier was already used for different content.');
        return { ok: true, activity: existing.activity };
      }
      activities.push({ activity, mutationId: body.mutationId });
      return { ok: true, activity };
    }
    if (action === 'listTasks') {
      identifier(body.customerId, 'customer');
      const rows = [...tasks.values()].filter(item => item.task.customerId === body.customerId).map(item => item.task);
      rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return { ok: true, tasks: rows };
    }
    if (action === 'saveTask') {
      mutation(body);
      const task = taskRecord(body.task);
      const hash = digest([body.expectedRevision, task]);
      const current = tasks.get(task.id);
      if (current?.mutations.has(body.mutationId)) {
        if (current.mutations.get(body.mutationId) !== hash) fail('MUTATION_MISMATCH', 'This task save identifier was already used for different data.');
        return { ok: true, task: current.task };
      }
      const revision = current?.task.revision || 0;
      if (revision !== body.expectedRevision) fail('CONFLICT', 'This task changed in another window. Reload it before saving your edits.', revision);
      const now = new Date().toISOString();
      const stored = structuredClone(task);
      stored.revision = revision + 1; if (!current) stored.createdAt = now;
      if (stored.status === 'done' && !stored.completedAt) stored.completedAt = now;
      if (stored.status === 'open') delete stored.completedAt;
      const mutations = new Map(current?.mutations); mutations.set(body.mutationId, hash);
      tasks.set(stored.id, { task: stored, mutations });
      return { ok: true, task: stored };
    }
    return undefined;
  };
  return (action: string, body: Payload): Result | undefined => {
    try { const result = respond(action, body); return result === undefined ? undefined : structuredClone(result); }
    catch (error) {
      if (error instanceof LocalApiError) return { ok: false, code: error.code, error: error.message, ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }) };
      throw error;
    }
  };
}
