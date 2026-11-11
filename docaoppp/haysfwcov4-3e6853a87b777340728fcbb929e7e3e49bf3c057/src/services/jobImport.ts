import { newId, type JobEntry } from "../types";
import { customerCsvColumns, parseCsvContractPrice, parseCsvDate, parseCsvRows } from "./customerCsv";

export interface JobImportResult {
  jobs: JobEntry[];
  warnings: string[];
  totalRows: number;
}

export function parseJobReport(csvText: string): JobImportResult {
  const warnings: string[] = [];
  const rows = parseCsvRows(csvText);
  if (!rows.length) return { jobs: [], warnings: ["The CSV file is empty."], totalRows: 0 };
  const headers = rows.shift()!;
  const columns = customerCsvColumns(headers);
  if (columns.jobNumber < 0 && columns.customerName < 0) {
    return { jobs: [], warnings: ["Could not find Job Number or Customer columns in CSV header."], totalRows: rows.length };
  }
  const jobs: JobEntry[] = [];
  const now = new Date().toISOString();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const rowNumber = index + 2;
    if (row.length !== headers.length) throw new Error(`Row ${rowNumber}: column count does not match the header.`);
    const value = (field: keyof typeof columns) => row[columns[field]] ?? "";
    const jobNumber = value("jobNumber"), customer = value("customerName");
    if (!jobNumber && !customer) continue;
    const street = value("jobAddress"), city = value("city"), state = value("state"), zip = value("zip");
    const cityStateZip = [city, state, zip].filter(Boolean).join(" ");
    const status = value("status") || "Active";
    const amount = parseCsvContractPrice(value("contractPrice"), rowNumber);
    jobs.push({
      id: newId(), jobNumber, customer,
      address: [street, cityStateZip].filter(Boolean).join(", "),
      jobAddress: street, city, state, zip,
      projectManager: value("projectManager"), estimator: value("estimator"), status,
      foreman: value("foreman"), supervisor: value("supervisor"), secondaryEmail: value("secondaryEmail"),
      customerPhone: value("customerPhone"), customerEmail: value("customerEmail"),
      carrier: value("carrier"), claim: value("claim"),
      dateInspected: parseCsvDate(value("dateInspected"), rowNumber), startDate: parseCsvDate(value("startDate"), rowNumber), finishDate: parseCsvDate(value("finishDate"), rowNumber),
      contractAmount: amount === null ? "" : amount.toFixed(2),
      active: !["closed", "cancelled", "canceled", "inactive", "archived"].includes(status.toLowerCase()),
      updatedAt: now,
    });
  }
  return { jobs, warnings, totalRows: rows.length };
}
