import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyJob } from '../src/documents/types/jobData';
import { createWorkspace } from '../src/workspaces/model';
import {
  parseWorkspaceExport,
  planWorkspaceMigration,
  prepareWorkspaceImport,
} from '../src/services/workspaceMigration';

function record(recordId = 'legacy-1', jobNumber = 'FW-123') {
  const job = createEmptyJob();
  job.recordId = recordId;
  job.customer.jobNumber = jobNumber;
  job.customer.customerName = 'Source customer';
  job.updatedAt = '2026-10-13T12:00:00.000Z';
  return job;
}

function backup(jobs: unknown[] = [{ recordId: 'legacy-1', origin: 'remote', record: record() }], drafts: unknown[] = [], pending: unknown[] = []) {
  return { version: 1, source: 'haysdocuments-2', exportedAt: '2026-10-15T12:00:00.000Z', jobs, drafts, pending };
}

test('migration rejects malformed JSON, unsupported versions, and invalid job payloads', () => {
  assert.throws(() => parseWorkspaceExport('{'), /JSON/);
  assert.throws(() => parseWorkspaceExport({ ...backup(), version: 2 }), /version/i);
  assert.throws(() => parseWorkspaceExport({ ...backup(), source: 'other-app' }), /document generator/i);
  assert.throws(() => parseWorkspaceExport({ ...backup(), drafts: {} }), /drafts/i);
  assert.throws(() => parseWorkspaceExport(backup([{ recordId: 'broken', record: [] }])), /record/i);
  assert.throws(() => parseWorkspaceExport(backup([{ recordId: 'a', record: { ...record(), recordId: 'b' } }])), /identity/i);
});

test('only a unique nonblank normalized job number selects an existing workspace', () => {
  const existing = createWorkspace(record('target', ' fw-123 '));
  const result = planWorkspaceMigration(parseWorkspaceExport(backup()), [existing]);
  assert.equal(result[0].targetId, existing.id);

  const duplicate = createWorkspace(record('target-2', 'FW-123'));
  const ambiguous = planWorkspaceMigration(parseWorkspaceExport(backup()), [existing, duplicate]);
  assert.equal(ambiguous[0].targetId, '');
  assert.equal(ambiguous[0].candidates.length, 2);
  assert.throws(() => prepareWorkspaceImport(ambiguous[0], [existing, duplicate], ''), /choose/i);

  const blank = planWorkspaceMigration(parseWorkspaceExport(backup([{ recordId: 'blank', record: record('blank', '') }])), [createWorkspace(record('target', ''))]);
  assert.equal(blank[0].targetId, 'new');
});

test('duplicate source job numbers also require an explicit choice', () => {
  const existing = createWorkspace(record('target'));
  const source = backup([
    { recordId: 'one', record: record('one') },
    { recordId: 'two', record: record('two') },
  ]);
  assert.deepEqual(planWorkspaceMigration(parseWorkspaceExport(source), [existing]).map(item => item.targetId), ['', '']);
});

test('a selected match fills blanks and preserves corrections, explicit zero, false, and cents', () => {
  const saved = createWorkspace(record('target'));
  saved.record.customer.customerName = 'Estimator correction';
  saved.record.customer.email = '';
  saved.record.financials.totalApprovedRcv = 0;
  saved.record.mortgage.hasMortgage = false;
  saved.originalContract = '998.17';
  saved.previousChanges = '-5.01';
  const source = record();
  source.customer.email = 'customer@example.com';
  source.financials.totalApprovedRcv = 1200.05;
  source.mortgage.hasMortgage = true;
  source.changeOrder.originalContractSum = 1100.11;
  source.changeOrder.netPreviousChanges = -10.13;
  const item = planWorkspaceMigration(parseWorkspaceExport(backup([{ recordId: 'legacy-1', record: source }])), [saved])[0];
  const imported = prepareWorkspaceImport(item, [saved], saved.id);
  assert.equal(imported.workspace!.record.customer.customerName, 'Estimator correction');
  assert.equal(imported.workspace!.record.customer.email, 'customer@example.com');
  assert.equal(imported.workspace!.record.financials.totalApprovedRcv, 0);
  assert.equal(imported.workspace!.record.mortgage.hasMortgage, false);
  assert.equal(imported.workspace!.originalContract, '998.17');
  assert.equal(imported.workspace!.previousChanges, '-5.01');
  assert.ok(imported.conflicts.includes('customer.customerName'));
  assert.equal(imported.workspace!.sourceRecordId, 'legacy-1');
  assert.equal(saved.record.customer.email, '');
});

test('migration does not turn approved RCV into the original contract and respects explicit blank/zero', () => {
  const source = record();
  source.financials.totalApprovedRcv = 12345.67;
  source.changeOrder.originalContractSum = '';
  source.changeOrder.netPreviousChanges = '';
  const item = planWorkspaceMigration(parseWorkspaceExport(backup([{ recordId: 'legacy-1', record: source }])), [])[0];
  const first = prepareWorkspaceImport(item, [], 'new').workspace!;
  assert.equal(first.originalContract, '');
  assert.equal(first.previousChanges, '');
  source.changeOrder.originalContractSum = 0;
  source.changeOrder.netPreviousChanges = -0.01;
  const second = prepareWorkspaceImport(planWorkspaceMigration(parseWorkspaceExport(backup([{ recordId: 'legacy-1', record: source }])), [])[0], [], 'new').workspace!;
  assert.equal(second.originalContract, '0.00');
  assert.equal(second.previousChanges, '-0.01');
});

test('repeating an import is a no-op after a saved job was edited and identifiers survive retry', () => {
  const parsed = parseWorkspaceExport(backup());
  const item = planWorkspaceMigration(parsed, [])[0];
  const first = prepareWorkspaceImport(item, [], 'new').workspace!;
  assert.equal(first.id, prepareWorkspaceImport(item, [], 'new').workspace!.id);
  first.revision = 8;
  first.updatedAt = '2026-10-16T12:00:00.000Z';
  first.record.customer.customerName = 'Newer edit';
  const repeated = planWorkspaceMigration(parsed, [first])[0];
  assert.equal(repeated.targetId, 'skip');
  assert.equal(prepareWorkspaceImport(repeated, [first], 'new').workspace, null);
  assert.equal(first.record.customer.customerName, 'Newer edit');
});

test('updated source data becomes a separate review copy instead of replacing an earlier import', () => {
  const firstItem = planWorkspaceMigration(parseWorkspaceExport(backup()), [])[0];
  const first = prepareWorkspaceImport(firstItem, [], 'new').workspace!;
  first.record.customer.customerName = 'Newer target edit';
  const updated = record();
  updated.customer.customerName = 'New source edit';
  const next = planWorkspaceMigration(parseWorkspaceExport(backup([{ recordId: 'legacy-1', record: updated }])), [first])[0];
  assert.equal(next.targetId, 'new');
  const copy = prepareWorkspaceImport(next, [first], 'new').workspace!;
  assert.notEqual(copy.id, first.id);
  assert.equal(copy.sourceRecordId, first.sourceRecordId);
  assert.equal(first.record.customer.customerName, 'Newer target edit');
  assert.throws(() => prepareWorkspaceImport(next, [first], first.id), /review copy/i);
});

test('remote/cache equivalents are deduplicated while draft and pending variants and file references remain', () => {
  const job = { ...record(), documents: [{ fileId: 'existing-drive-file', webViewLink: 'https://drive.google.com/file/d/existing-drive-file/view' }] };
  const draft = record();
  draft.productionNotes.scopeSummary = 'Unsaved draft scope';
  const pending = record();
  pending.customer.mobilePhone = '260-555-0111';
  const parsed = parseWorkspaceExport(backup([
    { recordId: 'legacy-1', origin: 'remote', record: job },
    { recordId: 'legacy-1', origin: 'device', record: job, syncState: 'synced' },
  ], [{ id: 'current:owner', recordId: 'legacy-1', job: draft, savedAt: 123 }], [
    { id: 4, type: 'save', recordId: 'legacy-1', job: pending, createdAt: 456, attempts: 2 },
    { id: 5, type: 'delete', recordId: 'legacy-1', createdAt: 789, attempts: 0 },
  ]));
  const plans = planWorkspaceMigration(parsed, []);
  assert.equal(plans.length, 4);
  const imported = plans.map(item => prepareWorkspaceImport(item, [], item.targetId).workspace!);
  assert.equal(new Set(imported.map(workspace => workspace.id)).size, 4);
  assert.equal(imported[0].sourceRecordId, 'legacy-1');
  assert.match(JSON.stringify(imported[0].migration!.original), /existing-drive-file/);
  assert.equal(Object.hasOwn(imported[0].record, 'documents'), false);
  assert.equal(imported[1].record.productionNotes.scopeSummary, 'Unsaved draft scope');
  assert.equal(imported[2].record.customer.mobilePhone, '260-555-0111');
  assert.equal(imported[3].migration!.variant, 'pending-delete');
  assert.match(plans[3].note, /delet/i);
});

test('synced device records survive without a server copy and changed cache variants are retained', () => {
  const source = record();
  const changed = record();
  changed.customer.customerName = 'Device correction';
  const localOnly = planWorkspaceMigration(parseWorkspaceExport(backup([
    { recordId: source.recordId, origin: 'device', syncState: 'synced', record: source },
  ])), []);
  assert.equal(localOnly.length, 1);
  const variants = planWorkspaceMigration(parseWorkspaceExport(backup([
    { recordId: source.recordId, origin: 'remote', record: source },
    { recordId: source.recordId, origin: 'device', syncState: 'synced', record: changed },
  ])), []);
  assert.equal(variants.length, 2);
  assert.deepEqual(variants.map(item => item.targetId), ['new', 'new']);
});

test('same data in a later export remains idempotent for blank and duplicate job numbers', () => {
  const input = backup([{ recordId: 'legacy-1', record: record('legacy-1', '') }]);
  const first = planWorkspaceMigration(parseWorkspaceExport(input), [])[0];
  const imported = prepareWorkspaceImport(first, [], 'new').workspace!;
  const later = { ...input, exportedAt: '2026-10-17T00:00:00.000Z' };
  assert.equal(planWorkspaceMigration(parseWorkspaceExport(later), [imported])[0].targetId, 'skip');
  assert.equal(prepareWorkspaceImport(planWorkspaceMigration(parseWorkspaceExport(later), [])[0], [], 'new').workspace!.id, imported.id);
});

test('pending draft operations preserve their draft payload and skip is an explicit per-row choice', () => {
  const source = record();
  source.productionNotes.scopeSummary = 'Queued draft';
  const item = planWorkspaceMigration(parseWorkspaceExport(backup([], [], [
    { id: 1, type: 'draft', recordId: source.recordId, draft: { id: 'current', job: source } },
  ])), [])[0];
  assert.equal(item.record!.productionNotes.scopeSummary, 'Queued draft');
  assert.equal(prepareWorkspaceImport(item, [], 'skip').workspace, null);
});

test('malformed pending saves and prototype keys are refused', () => {
  assert.throws(() => parseWorkspaceExport(backup([], [], [{ type: 'save', recordId: 'x', job: 'bad' }])), /pending|record/i);
  const unsafe = JSON.stringify(backup()).replace('"customerName":"Source customer"', '"customerName":"Source customer","__proto__":{"polluted":"yes"}');
  assert.throws(() => parseWorkspaceExport(unsafe), /unsafe/i);
  const malformed = { ...record(), customer: { ...record().customer, customerName: { invalid: true } } };
  assert.throws(() => parseWorkspaceExport(backup([{ recordId: 'legacy-1', record: malformed }])), /record/i);
});

