import assert from 'node:assert/strict';
import vm from 'node:vm';
import { test } from 'node:test';
import { loadAppsScriptSource } from './appsscript-source';

function setup() {
  const sheets = new Map<string, any>();
  const ss = { getSheetByName: (name: string) => sheets.get(name), insertSheet: (name: string) => {
    const rows: any[][] = [];
    const sheet = { rows, appendRow: (row: any[]) => rows.push(row), getDataRange: () => ({ getValues: () => rows.map(r => [...r]) }) };
    sheets.set(name, sheet); return sheet;
  } };
  const context = vm.createContext({ console, SpreadsheetApp: { flush() {} }, PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) } });
  vm.runInContext(loadAppsScriptSource(), context);
  context.getSpreadsheet_ = () => ss;
  context.getJob_ = (_user: any, recordId: string) => {
    if (recordId !== 'job') throw context.appError_('not_found', 'Missing job');
    return { customer: { jobNumber: 'TEST' } };
  };
  context.workspaceStaff_ = () => [{ email: 'staff@example.com', name: 'Staff' }];
  const user = { email: 'staff@example.com', role: 'editor' };
  let sequence = 0;
  const mutate = (kind: string, id: string, data: any, revision = 0, operationId = `op-${++sequence}`) =>
    context.mutateJobWorkspace_(user, { operationId, recordId: 'job', kind, id, expectedRevision: revision, data,
      financialRevision: context.workspaceFinancialRevision_(context.workspaceEntities_('job')) });
  return { context, user, mutate, sheets };
}
const work = { title: 'Call customer', category: 'Issue', status: 'Open', priority: 'High', assignee: 'staff@example.com', dueDate: '2026-11-12', description: '' };
const change = { number: 'CO-01', date: '2026-11-11', scopeDescription: 'Upgrade', status: 'Draft', amountCents: 25000, changeType: 'increase', addedDays: 2, isInsuranceRelated: false };

test('workspace mutation is revision checked, replay safe and payload guarded', () => {
  const { mutate, sheets } = setup();
  const created = mutate('workItem', 'task-1', work, 0, 'intent-1');
  assert.equal(created.revision, 1);
  assert.equal(mutate('workItem', 'task-1', work, 0, 'intent-1').revision, 1);
  assert.equal(sheets.get('WorkItems').rows.length, 2);
  assert.throws(() => mutate('workItem', 'task-1', { ...work, title: 'Different' }, 0, 'intent-1'), /reused/);
  mutate('workItem', 'task-1', { ...work, status: 'Done' }, 1);
  assert.throws(() => mutate('workItem', 'task-1', { ...work, status: 'Blocked' }, 1), /changed/);
});
test('viewer writes, invalid assignment, dates, and cross-job links are rejected', () => {
  const { context, mutate } = setup();
  assert.throws(() => context.mutateJobWorkspace_({ role: 'viewer' }, {}), /permission/);
  assert.throws(() => mutate('workItem', 'a', { ...work, assignee: 'outsider@example.com' }), /active staff/);
  assert.throws(() => mutate('workItem', 'a', { ...work, dueDate: '2026-02-31' }), /date/);
  assert.throws(() => mutate('comment', 'a', { parentId: 'unknown', body: 'Comment' }), /work item/);
  assert.throws(() => mutate('workItem', 'a', { ...work, changeOrderId: 'unknown' }), /change order/);
});
test('approval requires reviewed baseline and freezes PDF totals; void requires reason', () => {
  const { mutate } = setup();
  mutate('changeOrder', 'co-1', change);
  assert.throws(() => mutate('changeOrder', 'co-1', { ...change, status: 'Approved' }, 1), /review/);
  mutate('contract', 'contract', { originalCents: 1000000, openingCents: -5000, reviewed: true });
  const approved = mutate('changeOrder', 'co-1', { ...change, status: 'Approved' }, 1);
  assert.equal(approved.data.originalCents, 1000000);
  assert.equal(approved.data.previousCents, -5000);
  assert.equal(approved.data.approvedBy, 'staff@example.com');
  assert.throws(() => mutate('changeOrder', 'co-1', { ...change, status: 'Draft' }, 2), /read-only/);
  assert.throws(() => mutate('changeOrder', 'co-1', { ...approved.data, status: 'Voided' }, 2), /reason/);
  const voided = mutate('changeOrder', 'co-1', { ...approved.data, status: 'Voided', voidReason: 'Wrong scope' }, 2);
  assert.equal(voided.data.previousCents, -5000);
});
test('pagination returns independent latest entities and complete unique activity', () => {
  const { context, user, mutate } = setup();
  mutate('workItem', 'a', work);
  mutate('workItem', 'a', { ...work, status: 'Done' }, 1);
  mutate('workItem', 'b', { ...work, title: 'Second task' });
  const page = context.getJobWorkspace_(user, { recordId: 'job', page: 1, pageSize: 1 });
  assert.equal(page.entities.length, 1);
  assert.equal(page.totalEntities, 2);
  assert.equal(page.totalActivity, 3);
  assert.equal(context.getJobWorkspace_(user, { recordId: 'job', page: 2, pageSize: 1 }).entities.length, 1);
});

test('a changed contract position blocks approval even when the order itself is unchanged', () => {
  const { context, user, mutate } = setup();
  mutate('contract', 'contract', { originalCents: 1000000, openingCents: 0, reviewed: true });
  mutate('changeOrder', 'co-1', change);
  const stalePosition = context.workspaceFinancialRevision_(context.workspaceEntities_('job'));
  mutate('contract', 'contract', { originalCents: 1200000, openingCents: 0, reviewed: true, reason: 'Correct original contract' }, 1);
  assert.throws(() => context.mutateJobWorkspace_(user, { operationId: 'stale-approval', recordId: 'job', kind: 'changeOrder', id: 'co-1', expectedRevision: 1,
    financialRevision: stalePosition, data: { ...change, status: 'Approved' } }), /contract position changed/);
});

test('approved decisions replay safely after a lost response and cannot be silently revised', () => {
  const { context, user, mutate } = setup();
  mutate('contract', 'contract', { originalCents: 1000000, openingCents: 0, reviewed: true });
  const request = { operationId: 'approve-once', recordId: 'job', kind: 'changeOrder', id: 'co-1', expectedRevision: 0,
    financialRevision: context.workspaceFinancialRevision_(context.workspaceEntities_('job')), data: { ...change, status: 'Approved' } };
  const approved = context.mutateJobWorkspace_(user, request);
  assert.equal(context.mutateJobWorkspace_(user, request).revision, approved.revision);
  assert.equal(context.workspaceEntities_('job').filter((e: any) => e.kind === 'changeOrder').length, 1);
});

test('voiding an earlier increase cannot leave later approved credits below zero', () => {
  const { mutate } = setup();
  mutate('contract', 'contract', { originalCents: 0, openingCents: 0, reviewed: true });
  const first = mutate('changeOrder', 'increase', { ...change, status: 'Approved' });
  mutate('changeOrder', 'credit', { ...change, number: 'CO-02', changeType: 'decrease', status: 'Approved' });
  assert.throws(() => mutate('changeOrder', 'increase', { ...first.data, status: 'Voided', voidReason: 'Incorrect order' }, 1), /negative/);
});
