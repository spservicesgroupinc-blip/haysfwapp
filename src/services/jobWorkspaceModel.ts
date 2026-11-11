import type { RestorationJobData } from '../types/jobData';
import type { WorkspaceEntity } from '../types/jobWorkspace';

export function moneyToCents(value: string): number {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value.trim())) throw new Error('Enter a dollar amount with up to two decimal places.');
  const cents = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > 1e14) throw new Error('Amount is too large.');
  return cents;
}
export const dollars = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export function signedChange(data: Record<string, any>): number {
  return data.changeType === 'increase' ? data.amountCents : data.changeType === 'decrease' ? -data.amountCents : 0;
}
export function financialRevision(entities: WorkspaceEntity[]): string {
  return entities.filter(e => e.kind === 'contract' || (e.kind === 'changeOrder' && e.data.status === 'Approved'))
    .map(e => `${e.kind}:${e.id}:${e.revision}`).sort().join('|');
}
export function contractTotals(entities: WorkspaceEntity[]) {
  const baseline = entities.find(e => e.kind === 'contract')?.data;
  const orders = entities.filter(e => e.kind === 'changeOrder');
  const originalCents = baseline?.originalCents ?? 0;
  const approvedCents = (baseline?.openingCents ?? 0) + orders.filter(e => e.data.status === 'Approved').reduce((sum, e) => sum + signedChange(e.data), 0);
  const pendingCents = orders.filter(e => ['Draft', 'Submitted'].includes(e.data.status)).reduce((sum, e) => sum + signedChange(e.data), 0);
  return { reviewed: baseline?.reviewed === true, originalCents, approvedCents, currentCents: originalCents + approvedCents,
    pendingCents, projectedCents: originalCents + approvedCents + pendingCents };
}
export function isOverdue(data: Record<string, any>, now = new Date()): boolean {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return !!data.dueDate && data.dueDate < today && !['Done', 'Cancelled'].includes(data.status);
}
export function changeOrderJob(job: RestorationJobData, order: WorkspaceEntity, entities: WorkspaceEntity[]): RestorationJobData {
  const d = order.data;
  const totals = contractTotals(entities);
  const frozen = d.status === 'Approved' || d.status === 'Voided';
  return { ...job, changeOrderHistory: [], changeOrder: {
    changeOrderNumber: d.number, changeOrderDate: d.date, isInsuranceRelated: d.isInsuranceRelated,
    scopeDescription: d.scopeDescription, originalContractSum: (frozen ? d.originalCents : totals.originalCents) / 100,
    netPreviousChanges: (frozen ? d.previousCents : totals.approvedCents) / 100,
    changeAmount: d.amountCents / 100, changeType: d.changeType, addedDays: d.addedDays,
  } };
}
