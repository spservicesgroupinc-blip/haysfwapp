import { callAuthenticatedAppsScript, DatabaseError } from './appsScriptService';
import type { CustomerReference, CustomerReferenceSnapshot } from './customerReference';

async function referenceRequest(action: string, payload: Record<string, unknown> = {}): Promise<CustomerReferenceSnapshot> {
  try {
    const result = await callAuthenticatedAppsScript<CustomerReferenceSnapshot>(action, payload);
    if (!result || !Array.isArray(result.customers) || typeof result.updatedAt !== 'string') {
      throw new DatabaseError('The database returned an invalid customer reference.', 'bad_response');
    }
    return result;
  } catch (error) {
    if (error instanceof DatabaseError && error.code === 'unknown_action') {
      throw new DatabaseError('Customer CSV support needs the latest Apps Script Code.gs deployed as a new version. The shared list has not been changed.', 'unknown_action');
    }
    throw error;
  }
}

/** Always fetch from the shared backend so another device's replacement is used. */
export const getCustomerReference = () => referenceRequest('getCustomerReference');
export const replaceCustomerReference = (customers: CustomerReference[], fileName: string) =>
  referenceRequest('replaceCustomerReference', { customers, fileName });
