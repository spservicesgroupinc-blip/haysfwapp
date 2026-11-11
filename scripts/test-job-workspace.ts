import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contractTotals, changeOrderJob, isOverdue, moneyToCents } from '../src/services/jobWorkspaceModel';
import { createEmptyJob } from '../src/types/jobData';
import type { WorkspaceEntity } from '../src/types/jobWorkspace';

const entity = (kind: WorkspaceEntity['kind'], data: Record<string, unknown>, id = 'one'): WorkspaceEntity =>
  ({ id, recordId: 'job', kind, data, revision: 1, updatedAt: '2026-11-11T12:00:00Z', updatedBy: 'test@example.com' });

test('contract totals count approved signed deltas and keep pending exposure separate', () => {
  const totals = contractTotals([
    entity('contract', { originalCents: 1000000, openingCents: -10000, reviewed: true }),
    entity('changeOrder', { status: 'Approved', amountCents: 100000, changeType: 'increase' }, 'a'),
    entity('changeOrder', { status: 'Approved', amountCents: 50000, changeType: 'decrease' }, 'b'),
    entity('changeOrder', { status: 'Submitted', amountCents: 20000, changeType: 'increase' }, 'c'),
    entity('changeOrder', { status: 'Voided', amountCents: 900000, changeType: 'increase' }, 'd'),
    entity('changeOrder', { status: 'Rejected', amountCents: 900000, changeType: 'increase' }, 'e'),
  ]);
  assert.deepEqual(totals, { reviewed: true, originalCents: 1000000, approvedCents: 40000, currentCents: 1040000, pendingCents: 20000, projectedCents: 1060000 });
});

test('missing baseline is unverified and blank money is not zero', () => {
  assert.equal(contractTotals([]).reviewed, false);
  assert.throws(() => moneyToCents(''));
  assert.equal(moneyToCents('123.45'), 12345);
  assert.throws(() => moneyToCents('1.001'));
  assert.throws(() => moneyToCents('Infinity'));
});

test('approved PDF uses its frozen contract snapshot', () => {
  const order = entity('changeOrder', { number: 'CO-02', status: 'Approved', amountCents: 25000, changeType: 'decrease',
    originalCents: 1000000, previousCents: 50000, scopeDescription: 'Credit', addedDays: 0 });
  const job = changeOrderJob(createEmptyJob(), order, [entity('contract', { originalCents: 2000000, openingCents: 0, reviewed: true })]);
  assert.equal(job.changeOrder.originalContractSum, 10000);
  assert.equal(job.changeOrder.netPreviousChanges, 500);
  assert.equal(job.changeOrder.changeAmount, 250);
});

test('overdue uses local calendar date and excludes closed work', () => {
  const now = new Date(2026, 10, 11, 12);
  assert.equal(isOverdue({ dueDate: '2026-11-10', status: 'Open' }, now), true);
  assert.equal(isOverdue({ dueDate: '2026-11-11', status: 'Open' }, now), false);
  assert.equal(isOverdue({ dueDate: '2026-11-10', status: 'Done' }, now), false);
});
