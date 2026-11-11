import { createRecordId, todayIso, type ChangeOrderData, type RestorationJobData } from '../types/jobData';

// Do all additions in integer cents, including the accumulated previous orders.
function cents(value: number | ''): number {
  if (value === '') return 0;
  if (!Number.isFinite(value)) throw new Error('Change order amounts must be finite numbers.');
  const result = Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(result)) throw new Error('Change order amount is too large.');
  return result;
}

function deltaCents(order: ChangeOrderData): number {
  const amount = Math.abs(cents(order.changeAmount));
  if (amount === 0) return 0;
  return order.changeType === 'increase' ? amount : order.changeType === 'decrease' ? -amount : 0;
}

export function calculateChangeOrder(job: RestorationJobData) {
  const history = job.changeOrderHistory ?? [];
  const first = history[0];
  const original = cents(first ? first.originalContractSum : job.changeOrder.originalContractSum === ''
    ? job.financials.totalApprovedRcv : job.changeOrder.originalContractSum);
  // For migrated jobs, this is the opening balance of orders made outside the app.
  const previous = first
    ? cents(first.netPreviousChanges) + history.reduce((sum, order) => sum + deltaCents(order), 0)
    : cents(job.changeOrder.netPreviousChanges);
  const adjustment = deltaCents(job.changeOrder);
  const prior = original + previous;
  const total = prior + adjustment;
  if (![previous, prior, total].every(Number.isSafeInteger)) throw new Error('Change order total is too large.');
  return { original: original / 100, previous: previous / 100, prior: prior / 100,
    adjustment: adjustment / 100, total: total / 100, amount: Math.abs(adjustment) / 100 };
}

/** Freeze this order's balances and prepare the next sequential draft exactly once. */
export function recordChangeOrder(job: RestorationJobData): RestorationJobData {
  const order = job.changeOrder;
  const history = job.changeOrderHistory ?? [];
  const number = order.changeOrderNumber.trim();
  if (!number) throw new Error('Enter a change order number.');
  if (history.some(item => item.changeOrderNumber.trim().toLowerCase() === number.toLowerCase())) {
    throw new Error('That change order number is already recorded. Use the next number.');
  }
  if (!order.scopeDescription.trim()) throw new Error('Describe the scope of this change order.');
  if (!order.changeOrderDate) throw new Error('Enter the change order date.');
  if (!history.length && order.originalContractSum === '' && job.financials.totalApprovedRcv === '') {
    throw new Error('Enter the original contract sum before recording an order.');
  }
  if (!['increase', 'decrease', 'unchanged'].includes(order.changeType)) throw new Error('Choose the contract adjustment.');
  if (order.changeType !== 'unchanged' && (order.changeAmount === '' || order.changeAmount < 0)) {
    throw new Error('Enter a non-negative change amount; choose Increase or Decrease for its direction.');
  }
  if (order.addedDays !== '' && (!Number.isSafeInteger(order.addedDays) || order.addedDays < 0)) {
    throw new Error('Added working days must be a non-negative whole number.');
  }
  const totals = calculateChangeOrder(job);
  if (totals.original < 0 || totals.total < 0) throw new Error('The contract sum cannot be negative.');
  const recorded = { ...order, changeOrderNumber: number, originalContractSum: totals.original,
    netPreviousChanges: totals.previous, changeAmount: totals.amount,
    id: createRecordId(), recordedAt: new Date().toISOString() };
  const sequenceNumbers = [...history, recorded].map(item => Number(item.changeOrderNumber.match(/(\d+)$/)?.[1] ?? 0));
  if (!sequenceNumbers.every(Number.isSafeInteger) || Math.max(...sequenceNumbers) >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Use a smaller change order number.');
  }
  const nextNumber = Math.max(...sequenceNumbers) + 1;
  return { ...job, changeOrderHistory: [...history, recorded], changeOrder: {
    ...order, changeOrderNumber: `CO-${String(nextNumber).padStart(2, '0')}`, changeOrderDate: todayIso(),
    originalContractSum: totals.original, netPreviousChanges: (cents(totals.previous) + cents(totals.adjustment)) / 100,
    changeAmount: '', changeType: 'increase', scopeDescription: '', addedDays: '',
  } };
}
