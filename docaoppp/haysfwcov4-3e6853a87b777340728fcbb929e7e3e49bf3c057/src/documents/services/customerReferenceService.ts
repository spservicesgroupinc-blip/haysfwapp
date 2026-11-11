import { workspaceApi } from '../../services/workspaceApi';
import type { CustomerReference, CustomerReferenceSnapshot } from './customerReference';

export const CUSTOMER_REFERENCE_CHANGED = 'hays:customer-reference-changed';
export const CUSTOMER_REFERENCE_CACHE_KEY = 'hays_customer_reference_v1';
let mutationEpoch = 0;
let latestReplacement: CustomerReferenceSnapshot | null = null;

function validSnapshot(value: unknown): value is CustomerReferenceSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as CustomerReferenceSnapshot;
  if (!Array.isArray(snapshot.customers) || !['updatedAt', 'updatedBy', 'fileName', 'version'].every(field => typeof (snapshot as unknown as Record<string, unknown>)[field] === 'string')) return false;
  return snapshot.customers.every(customer => customer &&
    typeof customer.customerName === 'string' && !!customer.customerName.trim() &&
    typeof customer.jobNumber === 'string' && !!customer.jobNumber.trim() &&
    (customer.contractPrice === null || (typeof customer.contractPrice === 'number' && Number.isFinite(customer.contractPrice) && customer.contractPrice >= 0)) &&
    ['jobAddress', 'city', 'state', 'zip', 'customerPhone', 'customerEmail', 'secondaryEmail', 'projectManager', 'foreman', 'supervisor', 'estimator', 'status', 'carrier', 'claim', 'dateInspected', 'startDate', 'finishDate']
      .every(field => (customer as unknown as Record<string, unknown>)[field] === undefined || typeof (customer as unknown as Record<string, unknown>)[field] === 'string'));
}

function cacheReference(snapshot: CustomerReferenceSnapshot): void {
  try { localStorage.setItem(CUSTOMER_REFERENCE_CACHE_KEY, JSON.stringify(snapshot)); }
  catch { /* A full/disabled device cache must not turn a confirmed cloud save into a failure. */ }
}

export function getCachedCustomerReference(): CustomerReferenceSnapshot | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CUSTOMER_REFERENCE_CACHE_KEY) ?? 'null');
    return validSnapshot(value) ? value : null;
  } catch { return null; }
}

async function referenceRequest(action: string, payload: Record<string, unknown> = {}): Promise<CustomerReferenceSnapshot> {
  const startedAtEpoch = mutationEpoch;
  try {
    const result = await workspaceApi<{ reference: CustomerReferenceSnapshot }>(action, payload);
    const reference = result?.reference;
    if (!validSnapshot(reference)) {
      throw new Error('The database returned an invalid customer reference.');
    }
    if (action === 'replaceCustomerReference') {
      mutationEpoch++;
      latestReplacement = reference;
    } else if (startedAtEpoch !== mutationEpoch && latestReplacement) {
      // A refresh started before this import was confirmed; preserve its newer values.
      return latestReplacement;
    }
    cacheReference(reference);
    return reference;
  } catch (error) {
    if (error instanceof Error && 'code' in error && ['unknown_action', 'DEPLOYMENT_REQUIRED'].includes(String(error.code))) {
      throw new Error('Customer database support needs the latest Apps Script deployment. The shared list has not been changed.');
    }
    throw error;
  }
}

/** Refresh and cache the customer database shared by job and customer pickers. */
export const getCustomerReference = () => referenceRequest('getCustomerReference');
export async function replaceCustomerReference(customers: CustomerReference[], fileName: string): Promise<CustomerReferenceSnapshot> {
  const reference = await referenceRequest('replaceCustomerReference', { customers, fileName });
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CUSTOMER_REFERENCE_CHANGED, { detail: reference }));
  return reference;
}
