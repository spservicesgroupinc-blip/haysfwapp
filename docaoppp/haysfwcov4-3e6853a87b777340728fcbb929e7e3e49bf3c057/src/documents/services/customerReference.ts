import { customerCsvColumns, parseCsvContractPrice, parseCsvDate, parseCsvRows } from '../../services/customerCsv';

export interface CustomerReference {
  customerName: string;
  jobNumber: string;
  contractPrice: number | null;
  jobAddress: string;
  city: string;
  state: string;
  zip: string;
  customerPhone?: string;
  customerEmail?: string;
  secondaryEmail?: string;
  projectManager?: string;
  foreman?: string;
  supervisor?: string;
  estimator?: string;
  status?: string;
  carrier?: string;
  claim?: string;
  dateInspected?: string;
  startDate?: string;
  finishDate?: string;
}

export interface CustomerReferenceSnapshot {
  customers: CustomerReference[];
  fileName: string;
  updatedAt: string;
  updatedBy: string;
  version: string;
}

export const MAX_CUSTOMERS = 5000;
export const MAX_CUSTOMER_CSV_BYTES = 10 * 1024 * 1024;
// UTF-8 bytes conservatively bound the saved list, including non-Latin customer names.
export const MAX_CUSTOMER_LIST_BYTES = 100000;

export function parseCustomerCsv(text: string): { customers: CustomerReference[]; priceColumn: string } {
  if (new TextEncoder().encode(text).length > MAX_CUSTOMER_CSV_BYTES) throw new Error('CSV must be 10 MB or smaller.');
  const rows = parseCsvRows(text);
  const headers = rows.shift() ?? [];
  const columns = customerCsvColumns(headers);
  if ([columns.customerName, columns.jobNumber].some(index => index < 0)) throw new Error('CSV needs Customer (or Customer Name) and Job Number columns.');
  if (!rows.length) throw new Error('CSV contains no customers. The shared list has not been changed.');
  if (rows.length > MAX_CUSTOMERS) throw new Error(`CSV may contain at most ${MAX_CUSTOMERS.toLocaleString()} customers.`);
  const seen = new Set<string>();
  const customers = rows.map((cells, index) => {
    const rowNumber = index + 2;
    if (cells.length !== headers.length) throw new Error(`Row ${rowNumber}: column count does not match the header.`);
    const value = (field: keyof typeof columns) => cells[columns[field]] ?? '';
    const customerName = value('customerName'), jobNumber = value('jobNumber');
    if (!customerName || !jobNumber) throw new Error(`Row ${rowNumber}: customer name and job number are required.`);
    if (customerName.length > 300 || jobNumber.length > 100) throw new Error(`Row ${rowNumber}: customer name or job number is too long.`);
    const key = jobNumber.toUpperCase();
    if (seen.has(key)) throw new Error(`Row ${rowNumber}: duplicate job number ${jobNumber}.`);
    seen.add(key);
    const amount = parseCsvContractPrice(value('contractPrice'), rowNumber);
    const location = { jobAddress: value('jobAddress'), city: value('city'), state: value('state'), zip: value('zip') };
    if (location.jobAddress.length > 500 || location.city.length > 100 || location.state.length > 100 || location.zip.length > 20) throw new Error(`Row ${rowNumber}: address field is too long.`);
    const details: Partial<CustomerReference> = {};
    for (const field of ['customerPhone', 'customerEmail', 'secondaryEmail', 'projectManager', 'foreman', 'supervisor', 'estimator', 'status', 'carrier', 'claim'] as const) {
      const detail = value(field);
      if (detail.length > (field === 'customerPhone' || field === 'status' ? 100 : 300)) throw new Error(`Row ${rowNumber}: ${field} is too long.`);
      if (detail) details[field] = detail;
    }
    for (const field of ['dateInspected', 'startDate', 'finishDate'] as const) {
      const date = parseCsvDate(value(field), rowNumber);
      if (date) details[field] = date;
    }
    return { customerName, jobNumber, contractPrice: amount, ...location, ...details };
  });
  if (new TextEncoder().encode(JSON.stringify(customers)).length > MAX_CUSTOMER_LIST_BYTES) throw new Error('Customer list exceeds the supported 100 KB size. Upload a smaller customer list.');
  return { customers, priceColumn: headers[columns.contractPrice] ?? '' };
}

