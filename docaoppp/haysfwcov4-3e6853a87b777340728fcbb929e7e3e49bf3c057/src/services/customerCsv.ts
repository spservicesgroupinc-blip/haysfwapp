/** Column names supported by both shared customer and job directory uploads. */
export const CUSTOMER_CSV_COLUMNS = {
  customerName: ["customername", "customer", "insured", "insuredname", "name"],
  jobNumber: ["jobnumber", "jobno", "jobnum", "job", "filenumber"],
  // Sales is authoritative when an export also contains a preliminary estimate.
  contractPrice: ["totalcontractsales", "contractsales", "contractprice", "contractamount", "contractsum", "estimateamount", "amount", "price"],
  jobAddress: ["jobaddress", "lossaddress", "propertyaddress", "address", "streetaddress"],
  city: ["losscity", "city"],
  state: ["lossstate", "state"],
  zip: ["losszip", "zipcode", "zip", "postalcode"],
  customerPhone: ["customermainphone", "customerphone", "phone", "contactphone", "insuredphone", "phonenumber", "mobilephone"],
  customerEmail: ["customeremail", "email", "contactemail", "insuredemail", "emailaddress"],
  secondaryEmail: ["secondaryemail", "alternateemail"],
  projectManager: ["projectmanager", "pm", "foreperson", "foreman"],
  foreman: ["foreperson", "foreman"],
  supervisor: ["supervisor"],
  estimator: ["estimator", "estimatorname"],
  status: ["jobstatus", "status"],
  carrier: ["insurancecarrier", "carrier", "insurancecompany", "insurer"],
  claim: ["claimnumber", "claimno", "claimnum", "claim"],
  dateInspected: ["dateinspected", "inspectiondate"],
  startDate: ["datestarted", "startdate", "datestart"],
  finishDate: ["datetargetcompletion", "targetcompletiondate", "finishdate", "completiondate"],
} as const;

export function customerCsvColumns(headers: string[]): Record<keyof typeof CUSTOMER_CSV_COLUMNS, number> {
  const normalized = headers.map(header => header.toLowerCase().replace(/[^a-z0-9]/g, ""));
  return Object.fromEntries(Object.entries(CUSTOMER_CSV_COLUMNS).map(([field, aliases]) => {
    const key = aliases.find(alias => normalized.includes(alias));
    if (key && normalized.filter(header => header === key).length > 1) throw new Error("CSV contains duplicate column headers.");
    return [field, key ? normalized.indexOf(key) : -1];
  })) as Record<keyof typeof CUSTOMER_CSV_COLUMNS, number>;
}

/** RFC 4180 fields: quoted commas/newlines/escaped quotes stay in their column. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closed = false;
  const pushField = () => { row.push(field.trim()); field = ""; closed = false; };
  text = text.replace(/^\uFEFF/, "");
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
    } else if (char === '"' && !field.trim() && !closed) { field = ""; quoted = true; }
    else if (char === '"' || (closed && char.trim())) throw new Error("Malformed CSV: unexpected character after a quoted field.");
    else field += char;
  }
  if (quoted) throw new Error("Malformed CSV: a quoted field is not closed.");
  if (field || row.length || closed) { pushField(); rows.push(row); }
  return rows.filter(cells => cells.some(cell => cell !== ""));
}

/** Blank means unknown; zero remains a known contract amount. */
export function parseCsvContractPrice(raw: string, rowNumber: number): number | null {
  if (!raw) return null;
  if (!/^\$?\s*(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) throw new Error(`Row ${rowNumber}: invalid contract price.`);
  const amount = Number(raw.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(amount) || amount > 1e12) throw new Error(`Row ${rowNumber}: invalid contract price.`);
  return amount;
}

/** Dash reports use US dates; format explicitly so a timezone never moves a date. */
export function parseCsvDate(raw: string, rowNumber: number): string {
  if (!raw) return "";
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)?$/i.exec(raw);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(raw);
  const year = Number(us?.[3] ?? iso?.[1]);
  const month = Number(us?.[1] ?? iso?.[2]);
  const day = Number(us?.[2] ?? iso?.[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if ((!us && !iso) || year < 1000 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error(`Row ${rowNumber}: invalid date ${raw}.`);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
