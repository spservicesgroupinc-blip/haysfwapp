import { test } from "node:test";
import assert from "node:assert/strict";
import { mockBackend } from "./helpers/backend";

const reference = (extra: Record<string, unknown> = {}) => ({
  customerName: "Sample Customer",
  jobNumber: "FW-100",
  contractPrice: 1234.56,
  jobAddress: "100 Main St",
  city: "Fort Wayne",
  state: "IN",
  zip: "46802",
  customerPhone: "260-555-0100",
  customerEmail: "sample@example.com",
  projectManager: "PM One",
  estimator: "Estimator One",
  status: "Active",
  carrier: "Sample Insurance",
  claim: "CLAIM-100",
  secondaryEmail: "second@example.com",
  supervisor: "Supervisor One",
  foreman: "Foreman One",
  dateInspected: "2026-10-01",
  startDate: "2026-10-02",
  finishDate: "2026-11-03",
  ...extra,
});

function upload(backend: ReturnType<typeof mockBackend>, customers = [reference()]) {
  return backend.post({ action: "replaceCustomerReference", customers, fileName: "customers.csv" });
}

test("reference CSV populates shared Jobs and deduplicated CRM with contact, claim, address and money", () => {
  const backend = mockBackend();
  const saved = upload(backend, [reference(), reference({ jobNumber: "FW-101", contractPrice: 0 })]);
  assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.reference.customers[0].carrier, "Sample Insurance");
  assert.equal(saved.reference.customers[0].claim, "CLAIM-100");
  const jobs = backend.get({ action: "listJobs" }).jobs;
  assert.equal(jobs.length, 2);
  const job = jobs[0];
  assert.match(job.id, /^csv-job-/);
  assert.equal(job.address, "100 Main St, Fort Wayne IN 46802");
  assert.equal(job.jobAddress, "100 Main St");
  assert.equal(job.city, "Fort Wayne");
  assert.equal(job.state, "IN");
  assert.equal(job.zip, "46802");
  assert.equal(job.customerPhone, "260-555-0100");
  assert.equal(job.customerEmail, "sample@example.com");
  assert.equal(job.projectManager, "PM One");
  assert.equal(job.estimator, "Estimator One");
  assert.equal(job.carrier, "Sample Insurance");
  assert.equal(job.claim, "CLAIM-100");
  assert.equal(job.secondaryEmail, "second@example.com");
  assert.equal(job.supervisor, "Supervisor One");
  assert.equal(job.foreman, "Foreman One");
  assert.equal(job.dateInspected, "2026-10-01");
  assert.equal(job.startDate, "2026-10-02");
  assert.equal(job.finishDate, "2026-11-03");
  assert.equal(job.contractAmount, "1234.56");
  assert.equal(jobs[1].contractAmount, "0.00");
  const customers = backend.post({ action: "listCustomers" }).customers;
  assert.equal(customers.length, 1);
  const customer = backend.post({ action: "openCustomer", customerId: customers[0].id }).customer;
  assert.equal(customers[0].revision, customer.revision, "fresh devices need the real revision to enrich shared customers");
  assert.equal(customers[0].createdAt, customer.createdAt);
  assert.equal(customers[0].cityStateZip, "Fort Wayne IN 46802");
  assert.equal(customer.phone, job.customerPhone);
  assert.equal(customer.email, job.customerEmail);
  assert.equal(customer.cityStateZip, "Fort Wayne IN 46802");
  assert.equal(customer.revision, 1);
});

test("reference enrichment retains job IDs and manually entered customer details and mutation receipts", () => {
  const backend = mockBackend();
  const customer = { id: "manual-customer", name: "sample CUSTOMER", phone: "260-555-9999", tags: ["VIP"] };
  const save = { action: "saveCustomer", customer, mutationId: "manual-save", expectedRevision: 0 };
  assert.equal(backend.post(save).ok, true);
  assert.equal(backend.post({ action: "importJobs", jobs: [{ id: "existing-job", jobNumber: "fw-100", customer: "Sample Customer", address: "Manual job address", estimator: "Manual estimator", active: true }] }).ok, true);
  assert.equal(upload(backend, [reference({ estimator: "", contractPrice: null })]).ok, true);
  const job = backend.get({ action: "listJobs" }).jobs[0];
  assert.equal(job.id, "existing-job");
  assert.equal(job.estimator, "Manual estimator");
  const opened = backend.post({ action: "openCustomer", customerId: customer.id }).customer;
  assert.equal(opened.phone, "260-555-9999");
  assert.equal(opened.address, "Manual job address");
  assert.equal(opened.email, "sample@example.com");
  assert.deepEqual(opened.tags, ["VIP"]);
  assert.equal(backend.post({ action: "listCustomers" }).customers.length, 1);
  const replay = backend.post(save);
  assert.equal(replay.ok, true, replay.error);
  assert.equal(replay.customer.email, "sample@example.com");
});

test("old stored references migrate on directory/customer reads once without nested locks", () => {
  const backend = mockBackend();
  backend.post({ action: "getCustomerReference" });
  // Create a legacy snapshot directly: it predates the directory sync receipts.
  // The reference tab is replaceable; the migration only writes Jobs/Customers.
  const initial = upload(backend);
  assert.equal(initial.ok, true, initial.error);
  backend.sheets.delete("Jobs");
  backend.sheets.delete("Customers");
  backend.props.delete("CUSTOMER_REFERENCE_VERSION");
  backend.props.delete("CUSTOMER_DIRECTORY_SYNC_VERSION");
  const customers = backend.post({ action: "listCustomers" });
  assert.equal(customers.ok, true, customers.error);
  assert.equal(customers.customers.length, 1);
  assert.equal(backend.get({ action: "bootstrap" }).jobs.length, 1);
  const id = customers.customers[0].id;
  const first = backend.post({ action: "openCustomer", customerId: id }).customer;
  assert.equal(upload(backend).ok, true);
  const second = backend.post({ action: "openCustomer", customerId: id }).customer;
  assert.equal(second.revision, first.revision, "unchanged CSV never churns CRM revisions");
  assert.equal(backend.get({ action: "listJobs" }).jobs.length, 1);
});

test("replacement deactivates missing CSV-owned jobs while preserving unrelated jobs and CRM records", () => {
  const backend = mockBackend();
  backend.post({ action: "importJobs", jobs: [{ id: "manual-job", jobNumber: "MANUAL-1", customer: "Manual Customer", active: true }] });
  assert.equal(upload(backend).ok, true);
  const originalId = backend.get({ action: "listJobs" }).jobs.find((job: any) => job.jobNumber === "FW-100").id;
  assert.equal(upload(backend, [reference({ jobNumber: "FW-200", customerName: "Another Customer" })]).ok, true);
  let jobs = backend.get({ action: "listJobs" }).jobs;
  assert.equal(jobs.find((job: any) => job.id === originalId).active, false);
  assert.equal(jobs.find((job: any) => job.id === "manual-job").active, true);
  assert.equal(backend.post({ action: "listCustomers" }).customers.length, 3);
  assert.equal(upload(backend).ok, true);
  jobs = backend.get({ action: "listJobs" }).jobs;
  assert.equal(jobs.find((job: any) => job.jobNumber === "FW-100").id, originalId);
  assert.equal(jobs.find((job: any) => job.id === originalId).active, true);
});

test("invalid reference contact fields do not change any shared directory", () => {
  const backend = mockBackend();
  assert.equal(upload(backend).ok, true);
  const before = backend.get({ action: "bootstrap" });
  for (const extra of [{ customerPhone: 123 }, { claim: "x".repeat(301) }, { customerEmail: ["bad"] }]) {
    assert.equal(upload(backend, [reference(extra)]).ok, false);
    assert.deepEqual(backend.get({ action: "bootstrap" }), before);
  }
});

test("job report imports persist rich directory fields and populate shared customers too", () => {
  const backend = mockBackend();
  const job = { id: "report-job", jobNumber: "R-1", customer: "Report Customer", address: "Combined address", jobAddress: "Street", city: "City", state: "IN", zip: "46000", carrier: "Carrier", claim: "Claim", active: true };
  assert.equal(backend.post({ action: "importJobs", jobs: [job] }).ok, true);
  const listed = backend.get({ action: "listJobs" }).jobs[0];
  assert.equal(listed.claim, "Claim");
  assert.equal(listed.jobAddress, "Street");
  assert.equal(listed.city, "City");
  assert.equal(backend.post({ action: "listCustomers" }).customers[0].name, "Report Customer");
});
