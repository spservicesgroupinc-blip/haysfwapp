import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCustomerCsv } from "../src/documents/services/customerReference";
import { parseJobReport } from "../src/services/jobImport";
import { customerReferencesToJobs, jobsToCustomerReferences } from "../src/services/customerReferenceJobs";
import { workspaceFromDirectory, requestFromWorkspace } from "../src/workspaces/model";
import { contractAmounts } from "../src/services/contract";

const csv = '\uFEFFCustomer Name,Job Number,Contract Price,Property Address,City,State,ZIP Code,Phone,Email,Project Manager,Estimator,Job Status,Insurance Carrier,Claim Number\r\n"Smith, Jane",FW-123,"$1,234.50",10 Main St,Fort Wayne,IN,46802,260-555-0123,jane@example.com,Alex,Sam,Active,Acme,CL-12';

test("Total Contract Sales wins over estimates and carries through both imports into request totals", () => {
  const salesCsv = csv.replace("Contract Price", "Estimate Amount,Total Contract Sales").replace('"$1,234.50"', '999.99,"$1,234.50"');
  const parsed = parseCustomerCsv(salesCsv);
  assert.equal(parsed.priceColumn, "Total Contract Sales");
  assert.equal(parsed.customers[0].contractPrice, 1234.50);
  const report = parseJobReport(salesCsv);
  for (const job of [customerReferencesToJobs(parsed.customers)[0], report.jobs[0], customerReferencesToJobs(jobsToCustomerReferences(report.jobs))[0]]) {
    const workspace = workspaceFromDirectory(job);
    const request = requestFromWorkspace(workspace);
    assert.equal(job.contractAmount, "1234.50");
    assert.equal(workspace.originalContract, "1234.50");
    assert.equal(workspace.record.changeOrder.originalContractSum, 1234.50);
    assert.equal(workspace.record.financials.totalApprovedRcv, "");
    assert.equal(request.job.originalContract, "1234.50");
    assert.equal(request.job.customerPhone, "260-555-0123");
    assert.equal(request.job.customerEmail, "jane@example.com");
    assert.equal(request.job.projectManager, "Alex");
    assert.equal(request.job.branchContact, "Sam");
    assert.equal(request.job.carrier, "Acme");
    assert.equal(request.job.claim, "CL-12");
    assert.equal(contractAmounts(request.job).total, "$1,234.50");
  }
});

test("explicit sales columns preserve unknown and zero instead of substituting an estimate", () => {
  for (const [raw, expected] of [["", null], ["0", 0]] as const) {
    const input = `Customer,Job Number,Contract Price,Estimate Amount,Total Contract Sales\nJane,FW-1,888.88,999.99,${raw}`;
    assert.equal(parseCustomerCsv(input).customers[0].contractPrice, expected);
    assert.equal(parseJobReport(input).jobs[0].contractAmount, expected === null ? "" : "0.00");
  }
  for (const header of ["Total Contract Sales ($)", "Contract Sales"]) {
    assert.equal(parseCustomerCsv(`Customer,Job Number,${header}\nJane,FW-1,123.45`).customers[0].contractPrice, 123.45);
  }
});

test("both uploads retain contact, assignment, claim, and structured address columns", () => {
  const reference = parseCustomerCsv(csv).customers[0];
  const job = parseJobReport(csv).jobs[0];
  assert.equal(reference.customerPhone, "260-555-0123");
  assert.equal(reference.customerEmail, "jane@example.com");
  assert.equal(reference.projectManager, "Alex");
  assert.equal(reference.estimator, "Sam");
  assert.equal(reference.status, "Active");
  assert.equal(reference.carrier, "Acme");
  assert.equal(reference.claim, "CL-12");
  assert.equal(reference.zip, "46802");
  assert.equal(job.contractAmount, "1234.50");
  assert.equal(job.customerPhone, reference.customerPhone);
  assert.equal(job.carrier, reference.carrier);
  assert.equal(job.claim, reference.claim);
  assert.equal(job.address, "10 Main St, Fort Wayne IN 46802");
  assert.equal(job.jobAddress, "10 Main St");
  assert.equal(job.city, "Fort Wayne");
});

test("customer uploads can supply jobs without a price column and retain zero amounts", () => {
  assert.equal(parseCustomerCsv("Insured,File Number,Address\nJane,FW-1,10 Main St").customers[0].contractPrice, null);
  assert.equal(parseCustomerCsv("Customer,Job Number,Estimate Amount\nJane,FW-1,0").customers[0].contractPrice, 0);
});

test("both uploads reject malformed CSV and invalid currency instead of silently shifting data", () => {
  for (const parse of [parseCustomerCsv, parseJobReport]) {
    assert.throws(() => parse('Customer,Job Number,Contract Price\n"Jane,FW-1,100'), /quoted field/i);
    assert.throws(() => parse('Customer,Job Number,Contract Price\nJane,FW-1,100abc'), /contract price/i);
  }
});

test("shared customer import rejects duplicate job numbers without replacing the list", () => {
  assert.throws(() => parseCustomerCsv("Customer,Job Number\nJane, fw-1 \nJoe,FW-1"), /duplicate job number/i);
});

test("Dash contacts, foreperson, supervisor, and dates fill both shared imports", () => {
  const csv = 'Customer,Job Number,Customer Main Phone,Secondary Email,ForePerson,Supervisor,Date Inspected,Date Started,Date Target Completion\nJane,FW-1,260-555-0123,jane2@example.com,Alex,Sam,12/30/2025 17:03:41,2/6/2026 10:46:54,10/31/2026';
  const reference = parseCustomerCsv(csv).customers[0];
  const job = parseJobReport(csv).jobs[0];
  for (const row of [reference, job]) {
    assert.equal(row.customerPhone, '260-555-0123');
    assert.equal(row.secondaryEmail, 'jane2@example.com');
    assert.equal(row.projectManager, 'Alex');
    assert.equal(row.foreman, 'Alex');
    assert.equal(row.supervisor, 'Sam');
    assert.equal(row.dateInspected, '2025-12-30');
    assert.equal(row.startDate, '2026-02-06');
    assert.equal(row.finishDate, '2026-10-31');
  }
  assert.throws(() => parseCustomerCsv(csv.replace('10/31/2026', '2/30/2026')), /invalid date/);
});
