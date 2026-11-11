/**
 * Migration from the haysdocuments-2 document generator into the combined app.
 *
 * The generator kept remote/cache job copies, device drafts and an offline
 * outbox. Each is read here exactly once: a repeatable import that matches only
 * unique job numbers, preserves saved corrections and original Drive files,
 * and never turns approved RCV into the original contract.
 */
import { createEmptyJob, ensureRecordDefaults, type RestorationJobData } from '../documents/types/jobData';
import { createWorkspace, normalizeJobNumber, recalculateFinancials } from '../workspaces/model';
import { moneyCents } from './contract';
import type { Workspace } from '../workspaces/types';

export const EXPORT_SOURCE = 'haysdocuments-2' as const;
export const EXPORT_VERSION = 1 as const;

export interface ExportedJobEntry {
  recordId: string;
  origin: 'remote' | 'device';
  syncState?: string;
  record: RestorationJobData;
  [key: string]: unknown;
}

export interface ExportedDraftEntry {
  id?: unknown;
  recordId?: string;
  job: RestorationJobData;
  savedAt?: unknown;
  [key: string]: unknown;
}

export interface ExportedPendingEntry {
  id?: unknown;
  type?: string;
  recordId?: string;
  job?: RestorationJobData;
  createdAt?: unknown;
  attempts?: unknown;
  [key: string]: unknown;
}

export interface ParsedWorkspaceExport {
  version: typeof EXPORT_VERSION;
  source: typeof EXPORT_SOURCE;
  exportedAt: string;
  jobs: ExportedJobEntry[];
  drafts: ExportedDraftEntry[];
  pending: ExportedPendingEntry[];
}

export type MigrationVariant = 'remote' | 'device' | 'draft' | 'pending-save' | 'pending-delete';

export interface MigrationPlanItem {
  source: typeof EXPORT_SOURCE;
  exportedAt: string;
  variant: MigrationVariant;
  sourceRecordId: string;
  record?: RestorationJobData;
  /** Saved workspace id, 'new' for a fresh copy, 'skip' for a repeat import, '' when a person must choose. */
  targetId: string;
  /** Saved workspace ids a duplicate job number could match; a person picks one. */
  candidates: string[];
  note: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJobRecord(value: unknown): value is RestorationJobData {
  if (!isPlainObject(value) || !isPlainObject(value.customer) || !isPlainObject(value.financials)) return false;
  const defaults = createEmptyJob();
  const numeric = new Set(['totalApprovedRcv', 'deductible', 'roughEstimateAmount', 'depreciationAmount', 'originalContractSum', 'netPreviousChanges', 'changeAmount', 'addedDays']);
  for (const section of ['customer', 'financials', 'insurance', 'team', 'branch', 'mortgage', 'productionNotes', 'changeOrder', 'checklist'] as const) {
    if (value[section] === undefined) continue; // Old records may predate a section.
    if (!isPlainObject(value[section])) return false;
    for (const [key, field] of Object.entries(value[section])) {
      const expected = (defaults[section] as unknown as Record<string, unknown>)[key];
      if (expected === undefined) continue;
      if (numeric.has(key)) {
        if (field !== '' && (typeof field !== 'number' || !Number.isFinite(field))) return false;
      } else if (typeof field !== typeof expected || typeof field === 'number' && !Number.isFinite(field)) return false;
    }
  }
  return true;
}

function stableHash(text: string): string {
  // Independent 32-bit lanes provide a stable identity without a server call.
  const lanes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let i = 0; i < text.length; i += 1) {
    for (let lane = 0; lane < lanes.length; lane += 1) lanes[lane] = Math.imul(lanes[lane] ^ (text.charCodeAt(i) + lane), 16777619 + lane * 2) >>> 0;
  }
  return lanes.map(lane => lane.toString(16).padStart(8, '0')).join('') + text.length.toString(36);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function assertSafeKeys(value: unknown): void {
  if (Array.isArray(value)) value.forEach(assertSafeKeys);
  else if (isPlainObject(value)) for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('The export contains an unsafe field name.');
    assertSafeKeys(child);
  }
}

/** Exact decimal dollars from a generator value; blanks and unknowns stay blank. */
function normalizeMoney(value: unknown): string {
  if (value === '' || value === null || value === undefined) return '';
  const cents = moneyCents(String(value).trim());
  if (cents === null) return '';
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${(absolute / 100n).toString()}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

/** Parses and validates a generator export (JSON text or already-parsed object). */
export function parseWorkspaceExport(input: unknown): ParsedWorkspaceExport {
  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      throw new Error('The export file is not valid JSON.');
    }
  }
  if (!isPlainObject(value)) throw new Error('The export file is not valid JSON.');
  assertSafeKeys(value);
  if (value.version !== EXPORT_VERSION) throw new Error('This export uses an unsupported version.');
  if (value.source !== EXPORT_SOURCE) throw new Error('This file was not exported by the document generator.');
  if (!Array.isArray(value.jobs)) throw new Error('The export is missing its jobs list.');
  if (!Array.isArray(value.drafts)) throw new Error('The export is missing its drafts list.');
  if (!Array.isArray(value.pending)) throw new Error('The export is missing its pending actions list.');

  const jobs: ExportedJobEntry[] = value.jobs.map((entry, index) => {
    if (!isPlainObject(entry) || typeof entry.recordId !== 'string' || !entry.recordId.trim()) {
      throw new Error(`Job ${index + 1} in the export is missing its identifier.`);
    }
    if (!isJobRecord(entry.record)) throw new Error(`Job ${index + 1} has a missing or invalid record.`);
    if (entry.record.recordId !== entry.recordId) throw new Error(`Job ${index + 1} record does not match its exported identity.`);
    return entry as ExportedJobEntry;
  });

  const drafts: ExportedDraftEntry[] = value.drafts.map((entry, index) => {
    if (!isPlainObject(entry) || !isJobRecord(entry.job)) throw new Error(`Draft ${index + 1} in the export has a missing or invalid record.`);
    const recordId = typeof entry.recordId === 'string' && entry.recordId ? entry.recordId : entry.job.recordId;
    if (recordId && entry.job.recordId && entry.job.recordId !== recordId) throw new Error(`Draft ${index + 1} record does not match its exported identity.`);
    return entry as ExportedDraftEntry;
  });

  const pending: ExportedPendingEntry[] = value.pending.map((entry, index) => {
    if (!isPlainObject(entry)) throw new Error(`Pending action ${index + 1} in the export is invalid.`);
    const job = entry.type === 'draft' && isPlainObject(entry.draft) ? entry.draft.job : entry.job;
    if (entry.type !== 'delete' && !isJobRecord(job)) throw new Error(`Pending action ${index + 1} has a missing or invalid record.`);
    if (!['save', 'draft', 'delete'].includes(String(entry.type))) throw new Error(`Pending action ${index + 1} has an unsupported type.`);
    return { ...entry, ...(job ? { job } : {}) } as ExportedPendingEntry;
  });

  return {
    version: EXPORT_VERSION,
    source: EXPORT_SOURCE,
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : '',
    jobs,
    drafts,
    pending,
  };
}

function jobNumber(record: RestorationJobData | undefined): string {
  if (!record || typeof record.customer?.jobNumber !== 'string') return '';
  return normalizeJobNumber(record.customer.jobNumber);
}

interface SourceItem {
  variant: MigrationVariant;
  sourceRecordId: string;
  record?: RestorationJobData;
}

/** Remote/cache copies collapse to one entry; synced device copies are cache equivalents. */
function planItems(parsed: ParsedWorkspaceExport): SourceItem[] {
  const items: SourceItem[] = [];
  const byRecordId = new Map<string, ExportedJobEntry[]>();
  for (const entry of parsed.jobs) {
    const list = byRecordId.get(entry.recordId) ?? [];
    list.push(entry);
    byRecordId.set(entry.recordId, list);
  }
  for (const [recordId, entries] of byRecordId) {
    const remote = entries.find((entry) => entry.origin === 'remote');
    const kept: ExportedJobEntry[] = [];
    for (const entry of remote ? [remote, ...entries.filter(entry => entry !== remote)] : entries) {
      if (!kept.some(other => deepEqual(other.record, entry.record))) kept.push(entry);
    }
    for (const entry of kept) {
      items.push({ variant: entry.origin === 'device' ? 'device' : 'remote', sourceRecordId: recordId, record: entry.record });
    }
  }
  for (const draft of parsed.drafts) {
    const sourceRecordId = typeof draft.recordId === 'string' && draft.recordId ? draft.recordId : draft.job.recordId;
    if (!sourceRecordId) throw new Error('A draft in the export is missing its identifier.');
    items.push({ variant: 'draft', sourceRecordId, record: draft.job });
  }
  for (const entry of parsed.pending) {
    const sourceRecordId = typeof entry.recordId === 'string' && entry.recordId ? entry.recordId : entry.job?.recordId;
    if (!sourceRecordId) throw new Error('A pending action in the export is missing its identifier.');
    if (entry.type === 'delete') items.push({ variant: 'pending-delete', sourceRecordId });
    else if (entry.job) items.push({ variant: 'pending-save', sourceRecordId, record: entry.job });
    else throw new Error(`Pending action ${String(entry.id ?? '')} has no job payload.`);
  }
  return items;
}

/**
 * Plans each exported item against the saved workspaces. Matching is automatic
 * only for a unique nonblank job number; every ambiguity waits for a person.
 */
export function planWorkspaceMigration(parsed: ParsedWorkspaceExport, existing: Workspace[]): MigrationPlanItem[] {
  const items = planItems(parsed);
  // Only saved job entries compete for a job number; drafts and pending
  // variants are separate copies of the same record and never make a job
  // number ambiguous.
  const byNumber = new Map<string, SourceItem[]>();
  for (const item of items) {
    if (item.variant !== 'remote' && item.variant !== 'device') continue;
    const number = jobNumber(item.record);
    if (!number) continue;
    const list = byNumber.get(number) ?? [];
    list.push(item);
    byNumber.set(number, list);
  }

  return items.map((item) => {
    const number = jobNumber(item.record);
    const previous = existing.filter(workspace => workspace.migration?.source === EXPORT_SOURCE
      && workspace.sourceRecordId === item.sourceRecordId && workspace.migration.variant === item.variant);
    if (previous.some(workspace => deepEqual(item.record ?? null, workspace.migration?.original))) {
      return { source: EXPORT_SOURCE, exportedAt: parsed.exportedAt, ...item, targetId: 'skip', candidates: [], note: 'This version was already imported. Saved edits are kept.' };
    }
    if (item.variant === 'pending-delete') {
      return { source: EXPORT_SOURCE, exportedAt: parsed.exportedAt, variant: item.variant, sourceRecordId: item.sourceRecordId, targetId: 'new', candidates: [], note: 'A deletion was pending on the source device. The job was kept for review.' };
    }
    const record = item.record!;
    const sourceTwins = (byNumber.get(number) ?? []).filter((twin) => twin.sourceRecordId !== item.sourceRecordId);
    const candidates = number
      ? existing.filter((workspace) => jobNumber(workspace.record) === number)
      : [];

    if (previous.length > 0 || item.variant === 'draft' || item.variant === 'pending-save'
      || (item.variant === 'device' && items.some(other => other.sourceRecordId === item.sourceRecordId && other.variant === 'remote'))) {
      return { source: EXPORT_SOURCE, exportedAt: parsed.exportedAt, ...item, targetId: 'new', candidates: [], note: 'Preserved as a separate review copy so saved corrections remain intact.' };
    }

    if (sourceTwins.length > 0) {
      return { source: EXPORT_SOURCE, exportedAt: parsed.exportedAt, variant: item.variant, sourceRecordId: item.sourceRecordId, record, targetId: '', candidates: candidates.map((workspace) => workspace.id), note: 'More than one exported job uses this job number. Choose which saved job each one matches.' };
    }
    if (candidates.length === 0) {
      return { source: EXPORT_SOURCE, exportedAt: parsed.exportedAt, variant: item.variant, sourceRecordId: item.sourceRecordId, record, targetId: 'new', candidates: [], note: '' };
    }
    if (candidates.length === 1) {
      const match = candidates[0];
      if (match.sourceRecordId === item.sourceRecordId) {
        const unchanged = deepEqual(record, match.migration?.original);
        if (unchanged) return { source: EXPORT_SOURCE, exportedAt: parsed.exportedAt, variant: item.variant, sourceRecordId: item.sourceRecordId, record, targetId: 'skip', candidates: [match.id], note: 'This job was already imported from the same export.' };
        return { source: EXPORT_SOURCE, exportedAt: parsed.exportedAt, variant: item.variant, sourceRecordId: item.sourceRecordId, record, targetId: 'new', candidates: [match.id], note: 'The saved job and the export both changed. The updated export becomes a separate copy for review.' };
      }
      return { source: EXPORT_SOURCE, exportedAt: parsed.exportedAt, variant: item.variant, sourceRecordId: item.sourceRecordId, record, targetId: match.id, candidates: [match.id], note: 'Matched by job number.' };
    }
    return { source: EXPORT_SOURCE, exportedAt: parsed.exportedAt, variant: item.variant, sourceRecordId: item.sourceRecordId, record, targetId: '', candidates: candidates.map((workspace) => workspace.id), note: 'More than one saved job uses this job number. Choose which one this export matches.' };
  });
}

/** Fields derived from RCV/contract math are recomputed after a merge instead of copied. */
const DERIVED_FINANCIALS = new Set(['netClaimValue', 'downPayment', 'midProgressPayment', 'balancePayment']);

function blank(value: unknown): boolean {
  return value === '' || value === null || value === undefined;
}

/** Fills blanks from the source, keeps explicit values (0 and false count), and lists conflicts. */
function fillBlanks(target: Record<string, unknown>, source: Record<string, unknown>, path: string, conflicts: string[]): void {
  for (const key of Object.keys(source)) {
    if (key === 'recordId' || key === 'id' || key === 'updatedAt' || key === 'schemaVersion' || key === 'dateCreated') continue;
    const full = path ? `${path}.${key}` : key;
    if (full === 'financials.netClaimValue' || DERIVED_FINANCIALS.has(full.replace(/^financials\./, '')) && full.startsWith('financials.')) continue;
    const sourceValue = source[key];
    const targetValue = target[key];
    if (isPlainObject(sourceValue)) {
      if (isPlainObject(targetValue)) {
        fillBlanks(targetValue, sourceValue, full, conflicts);
      } else if (blank(targetValue)) {
        target[key] = structuredClone(sourceValue);
      }
    } else if (Array.isArray(sourceValue)) {
      if (blank(targetValue)) target[key] = structuredClone(sourceValue);
      else if (deepEqual(targetValue, sourceValue) === false) conflicts.push(full);
    } else if (blank(targetValue) && !blank(sourceValue)) {
      target[key] = sourceValue;
    } else if (!blank(targetValue) && !blank(sourceValue) && targetValue !== sourceValue) {
      conflicts.push(full);
    }
  }
}

function migrationContext(item: MigrationPlanItem): { source: string; sourceRecordId: string; variant: string; sourceKey: string; importedAt: string; original: unknown } {
  return {
    source: item.source,
    sourceRecordId: item.sourceRecordId,
    variant: item.variant,
    sourceKey: stableHash(canonical([item.source, item.variant, item.sourceRecordId, item.record ?? null])),
    importedAt: new Date().toISOString(),
    original: item.record === undefined ? null : structuredClone(item.record),
  };
}

/** Legacy extensions stay intact in migration.original; the live record follows the new backend contract. */
function importRecord(source: RestorationJobData, withDefaults = true): RestorationJobData {
  const normalized = withDefaults ? ensureRecordDefaults(structuredClone(source)) : structuredClone(source);
  const result: Record<string, unknown> = {};
  for (const key of ['recordId', 'id', 'dateCreated', 'updatedAt', 'schemaVersion'] as const) {
    if (normalized[key] !== undefined) result[key] = normalized[key];
  }
  for (const section of ['customer', 'financials', 'insurance', 'team', 'branch', 'mortgage', 'productionNotes', 'changeOrder', 'checklist'] as const) {
    if (normalized[section]) result[section] = Object.fromEntries(Object.entries(normalized[section]).filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value)));
  }
  return result as unknown as RestorationJobData;
}

/**
 * Produces the workspace an item imports into. Never mutates existing
 * workspaces, never loses explicit zeros or estimator corrections, and keeps
 * the import idempotent (the same export retries into the same new workspace).
 */
export function prepareWorkspaceImport(
  item: MigrationPlanItem,
  existing: Workspace[],
  targetId: string,
): { workspace: Workspace | null; conflicts: string[] } {
  if (item.targetId === 'skip' || targetId === 'skip') return { workspace: null, conflicts: [] };
  if (targetId === '') throw new Error('Choose the saved job this export should merge into.');
  const match = targetId === 'new' ? undefined : existing.find((workspace) => workspace.id === targetId);
  if (targetId !== 'new' && !match) throw new Error('Choose the saved job this export should merge into.');
  if (match && match.sourceRecordId === item.sourceRecordId && !deepEqual(item.record, match.migration?.original)) {
    throw new Error('The saved job and this export both changed. Import the updated export as a separate review copy instead of merging it.');
  }

  if (targetId === 'new') {
    const record = item.record ? importRecord(item.record) : createEmptyJob();
    if (!item.record) {
      record.customer.jobNumber = '';
      record.customer.jobName = `Pending source deletion: ${item.sourceRecordId}`;
    }
    const context = migrationContext(item);
    const prior = existing.find(workspace => workspace.id === `ws-${context.sourceKey}` || workspace.migration?.sourceKey === context.sourceKey);
    if (prior) {
      if (prior.migration?.sourceRecordId === item.sourceRecordId && prior.migration.variant === item.variant
        && deepEqual(prior.migration.original, item.record ?? null)) return { workspace: null, conflicts: [] };
      throw new Error('This import identity conflicts with a saved job. Existing data was kept.');
    }
    const workspace = createWorkspace(record);
    workspace.id = `ws-${context.sourceKey}`;
    workspace.record.recordId = workspace.id;
    workspace.originalContract = item.record ? normalizeMoney(item.record.changeOrder?.originalContractSum) : '';
    workspace.previousChanges = item.record ? normalizeMoney(item.record.changeOrder?.netPreviousChanges) : '';
    workspace.sourceRecordId = item.sourceRecordId;
    workspace.migration = context;
    return { workspace, conflicts: [] };
  }

  const merged: Workspace = structuredClone(match!);
  const conflicts: string[] = [];
  if (item.record) {
    fillBlanks(merged.record as unknown as Record<string, unknown>, importRecord(item.record, false) as unknown as Record<string, unknown>, '', conflicts);
    merged.record = recalculateFinancials(merged.record);
  }
  merged.record.recordId = merged.id;
  const contract = item.record ? normalizeMoney(item.record.changeOrder?.originalContractSum) : '';
  const changes = item.record ? normalizeMoney(item.record.changeOrder?.netPreviousChanges) : '';
  if (blank(merged.originalContract) && !blank(contract)) merged.originalContract = contract;
  else if (!blank(merged.originalContract) && !blank(contract) && merged.originalContract !== contract) conflicts.push('originalContract');
  if (blank(merged.previousChanges) && !blank(changes)) merged.previousChanges = changes;
  else if (!blank(merged.previousChanges) && !blank(changes) && merged.previousChanges !== changes) conflicts.push('previousChanges');
  merged.sourceRecordId = item.sourceRecordId;
  merged.migration = migrationContext(item);
  return { workspace: merged, conflicts };
}
