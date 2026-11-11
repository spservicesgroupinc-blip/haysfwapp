export interface CustomerReference {
  customerName: string;
  jobNumber: string;
  contractPrice: number | null;
  jobAddress: string;
  city: string;
  state: string;
  zip: string;
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

/** RFC 4180 fields: quoted commas/newlines/escaped quotes must stay in their column. */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closed = false;
  const pushField = () => { row.push(field.trim()); field = ''; closed = false; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === ',') pushField();
    else if (char === '\r' || char === '\n') {
      pushField(); rows.push(row); row = [];
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else if (char === '"' && !field.trim() && !closed) { field = ''; quoted = true; }
    else if (char === '"' || (closed && char.trim())) throw new Error('Malformed CSV: unexpected character after a quoted field.');
    else field += char;
  }
  if (quoted) throw new Error('Malformed CSV: a quoted field is not closed.');
  if (field || row.length || closed) { pushField(); rows.push(row); }
  return rows.filter(cells => cells.some(cell => cell !== ''));
}

export function parseCustomerCsv(text: string): { customers: CustomerReference[]; priceColumn: string } {
  if (new TextEncoder().encode(text).length > MAX_CUSTOMER_CSV_BYTES) throw new Error('CSV must be 10 MB or smaller.');
  const rows = csvRows(text.replace(/^\uFEFF/, ''));
  const headers = rows.shift() ?? [];
  const normalized = headers.map(header => header.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const column = (aliases: string[]) => {
    const key = aliases.find(alias => normalized.includes(alias));
    if (!key) return -1;
    if (normalized.filter(header => header === key).length > 1) throw new Error('CSV contains duplicate required column headers.');
    return normalized.indexOf(key);
  };
  const name = column(['customername', 'customer']);
  const job = column(['jobnumber', 'jobno', 'job']);
  const price = column(['contractprice', 'contractamount', 'contractsum', 'estimateamount']);
  const address = column(['jobaddress', 'lossaddress', 'propertyaddress', 'address']);
  const city = column(['losscity', 'city']);
  const state = column(['lossstate', 'state']);
  const zip = column(['losszip', 'zipcode', 'zip', 'postalcode']);
  if ([name, job, price].some(index => index < 0)) throw new Error('CSV needs Customer (or Customer Name), Job Number, and Contract Price (or Estimate Amount) columns.');
  if (!rows.length) throw new Error('CSV contains no customers. The shared list has not been changed.');
  if (rows.length > MAX_CUSTOMERS) throw new Error(`CSV may contain at most ${MAX_CUSTOMERS.toLocaleString()} customers.`);
  const seen = new Set<string>();
  const customers = rows.map((cells, index) => {
    const rowNumber = index + 2;
    if (cells.length !== headers.length) throw new Error(`Row ${rowNumber}: column count does not match the header.`);
    const customerName = cells[name], jobNumber = cells[job];
    if (!customerName || !jobNumber) throw new Error(`Row ${rowNumber}: customer name and job number are required.`);
    if (customerName.length > 300 || jobNumber.length > 100) throw new Error(`Row ${rowNumber}: customer name or job number is too long.`);
    const key = jobNumber.toUpperCase();
    if (seen.has(key)) throw new Error(`Row ${rowNumber}: duplicate job number ${jobNumber}.`);
    seen.add(key);
    const money = cells[price];
    if (money && !/^\$?\s*(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(money)) throw new Error(`Row ${rowNumber}: invalid contract price.`);
    const amount = money ? Number(money.replace(/[$,\s]/g, '')) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount > 1e12)) throw new Error(`Row ${rowNumber}: invalid contract price.`);
    const location = { jobAddress: cells[address] ?? '', city: cells[city] ?? '', state: cells[state] ?? '', zip: cells[zip] ?? '' };
    if (location.jobAddress.length > 500 || location.city.length > 100 || location.state.length > 100 || location.zip.length > 20) throw new Error(`Row ${rowNumber}: address field is too long.`);
    return { customerName, jobNumber, contractPrice: amount, ...location };
  });
  if (new TextEncoder().encode(JSON.stringify(customers)).length > MAX_CUSTOMER_LIST_BYTES) throw new Error('Customer list exceeds the supported 100 KB size. Upload a smaller customer list.');
  return { customers, priceColumn: headers[price] };
}

