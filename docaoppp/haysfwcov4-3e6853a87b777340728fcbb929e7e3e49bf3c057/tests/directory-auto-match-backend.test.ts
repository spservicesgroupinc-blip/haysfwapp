import { test } from "node:test";
import assert from "node:assert/strict";
import { mockBackend } from "./helpers/backend";

type Backend = ReturnType<typeof mockBackend>;
const workspace = (id: string, extra: Record<string, any> = {}): Record<string, any> => ({
  id, revision: 0, updatedAt: "", originalContract: "", previousChanges: "0.00",
  record: {
    id: "record-id-" + id, recordId: "immutable-" + id, dateCreated: "2026-10-23", schemaVersion: 1,
    branch: {}, customer: { customerName: "Sample Customer", jobNumber: "FW-100" },
    insurance: {}, financials: { totalApprovedRcv: "" }, team: {}, mortgage: {},
    changeOrder: { originalContractSum: "" }, productionNotes: {}, checklist: {},
  },
  ...extra,
});
const reference = (extra: Record<string, any> = {}) => ({
  customerName: "Sample Customer", jobNumber: "FW-100", contractPrice: 1234.56,
  jobAddress: "100 Main St", city: "Fort Wayne", state: "IN", zip: "46802",
  customerPhone: "260-555-0100", customerEmail: "sample@example.com", projectManager: "CSV PM",
  estimator: "CSV Estimator", supervisor: "CSV Supervisor", foreman: "CSV Foreman",
  carrier: "CSV Carrier", claim: "CSV-CLAIM", dateInspected: "2026-10-01", startDate: "2026-10-02", finishDate: "2026-11-01",
  ...extra,
});
const upload = (backend: Backend, customers = [reference()]) => backend.post({ action: "replaceCustomerReference", customers, fileName: "customers.csv" });
const save = (backend: Backend, value: Record<string, any>, mutationId = "save-" + value.id) => backend.post({ action: "saveWorkspace", workspace: value, mutationId, expectedRevision: value.revision });
const open = (backend: Backend, id: string) => backend.post({ action: "openWorkspace", workspaceId: id }).workspace;

test("CSV automatically fills saved matching jobs while preserving corrections, approved RCV and retry receipts", () => {
  const backend = mockBackend();
  const value = workspace("saved-job");
  value.record.customer.customerName = "Manual corrected customer";
  value.record.customer.email = "manual@example.com";
  value.record.insurance.carrier = "Manual carrier";
  value.record.financials.totalApprovedRcv = 77.25;
  value.record.team.estimator = "Manual estimator";
  assert.equal(save(backend, value).ok, true);
  const firstFile = backend.sheets.get("Workspaces").rows[1][3];
  assert.equal(upload(backend).ok, true);
  const result = open(backend, value.id);
  assert.equal(result.id, value.id);
  assert.equal(result.record.recordId, value.record.recordId);
  assert.equal(result.revision, 2);
  assert.equal(result.record.customer.customerName, "Manual corrected customer");
  assert.equal(result.record.customer.email, "manual@example.com");
  assert.equal(result.record.customer.mainPhone, "260-555-0100");
  assert.equal(result.record.customer.lossAddress, "100 Main St, Fort Wayne IN 46802");
  assert.equal(result.record.customer.mailingAddress, "100 Main St");
  assert.equal(result.record.customer.mailingCityStateZip, "Fort Wayne IN 46802");
  assert.equal(result.record.insurance.carrier, "Manual carrier");
  assert.equal(result.record.insurance.claimNumber, "CSV-CLAIM");
  assert.equal(result.record.insurance.dateInspected, "2026-10-01");
  assert.equal(result.record.team.estimator, "Manual estimator");
  assert.equal(result.record.team.projectManager, "CSV PM");
  assert.equal(result.record.team.foreman, "CSV Foreman");
  assert.equal(result.record.checklist.startDate, "2026-10-02");
  assert.equal(result.originalContract, "1234.56");
  assert.equal(result.previousChanges, "0.00");
  assert.equal(result.record.changeOrder.originalContractSum, 1234.56);
  assert.equal(result.record.financials.totalApprovedRcv, 77.25, "CSV contract is not an approved insurance RCV");
  assert.ok(result.customerId);
  assert.equal(backend.sheets.get("Workspaces").rows[1][4], firstFile);
  const replay = save(backend, value);
  assert.equal(replay.ok, true, replay.error);
  assert.deepEqual(replay.workspace, result, "old offline save replay returns enriched current workspace");
  assert.equal(upload(backend).ok, true);
  assert.deepEqual(open(backend, value.id), result, "identical data does not churn revisions or timestamps");
});

test("new workspace saves after import automatically fill without a second migration or revision", () => {
  const backend = mockBackend();
  assert.equal(upload(backend).ok, true);
  const value = workspace("new-job");
  const first = save(backend, value);
  assert.equal(first.ok, true, first.error);
  assert.equal(first.workspace.revision, 1);
  assert.equal(first.workspace.record.customer.mainPhone, "260-555-0100");
  assert.equal(first.workspace.record.insurance.claimNumber, "CSV-CLAIM");
  assert.equal(first.workspace.originalContract, "1234.56");
  assert.deepEqual(save(backend, value), first);
});

test("CSV enrichment uses the reviewed job contract for blank document sums, including zero", () => {
  for (const amount of ["0.00", "321.09"]) {
    const backend = mockBackend();
    assert.equal(upload(backend).ok, true);
    const value = workspace("reviewed-contract", { originalContract: amount });
    const first = save(backend, value);
    assert.equal(first.ok, true, first.error);
    assert.equal(first.workspace.originalContract, amount);
    assert.equal(first.workspace.record.changeOrder.originalContractSum, Number(amount));
    assert.equal(open(backend, value.id).record.changeOrder.originalContractSum, Number(amount));
  }
});

test("numberless saved jobs require a unique match and use corroboration to resolve multiple jobs", () => {
  const backend = mockBackend();
  const unique = workspace("unique"); unique.record.customer = { customerName: "Unique Customer", jobNumber: "" };
  const ambiguous = workspace("ambiguous"); ambiguous.record.customer.jobNumber = "";
  const corroborated = workspace("corroborated"); corroborated.record.customer = { customerName: "Sample Customer", jobNumber: "", email: "second@example.com" };
  for (const value of [unique, ambiguous, corroborated]) assert.equal(save(backend, value).ok, true);
  assert.equal(upload(backend, [reference(), reference({ jobNumber: "FW-101", customerEmail: "second@example.com", customerPhone: "260-555-0101" }), reference({ customerName: "Unique Customer", jobNumber: "UNIQUE-1" })]).ok, true);
  assert.equal(open(backend, "unique").record.customer.jobNumber, "UNIQUE-1");
  assert.equal(open(backend, "ambiguous").record.customer.jobNumber, "");
  assert.equal(open(backend, "ambiguous").revision, 1);
  assert.equal(open(backend, "corroborated").record.customer.jobNumber, "FW-101");
});

test("verified duplicate customers automatically combine histories, job links and mutation receipts", () => {
  const backend = mockBackend();
  const a = { id: "manual-a", name: "Sample Customer", email: "sample@example.com", tags: ["VIP"] };
  const b = { id: "manual-b", name: " sample CUSTOMER ", email: "sample@example.com", phone: "260-555-0100", tags: ["Follow up"] };
  const saveA = { action: "saveCustomer", customer: a, mutationId: "customer-a", expectedRevision: 0 };
  const saveB = { action: "saveCustomer", customer: b, mutationId: "customer-b", expectedRevision: 0 };
  assert.equal(backend.post(saveA).ok, true); assert.equal(backend.post(saveB).ok, true);
  const value = workspace("duplicate-linked", { customerId: "manual-b" });
  assert.equal(save(backend, value).ok, true);
  const activity = { id: "note-b", customerId: "manual-b", kind: "note", direction: "system", body: "Historical customer note", at: "2026-10-22T00:00:00.000Z" };
  const add = { action: "addActivity", activity, mutationId: "note-b" };
  assert.equal(backend.post(add).ok, true);
  assert.equal(upload(backend).ok, true);
  const customers = backend.post({ action: "listCustomers" }).customers;
  assert.equal(customers.length, 1);
  const canonical = customers[0];
  assert.equal(canonical.id, "manual-a");
  assert.deepEqual(canonical.tags.sort(), ["Follow up", "VIP"]);
  assert.deepEqual(canonical.mergedFromIds, ["manual-b"]);
  assert.equal(open(backend, value.id).customerId, canonical.id);
  assert.equal(backend.post({ action: "listActivities", customerId: canonical.id }).activities[0].body, activity.body);
  assert.equal(backend.post(saveB).customer.id, canonical.id, "retired customer save retries acknowledge canonical record");
  assert.equal(backend.post(add).ok, true, "lost activity-response retries survive automatic reassignment");
  assert.equal(backend.post({ ...saveB, mutationId: "new-stale-edit" }).code, "CONFLICT", "stale devices cannot resurrect a merged customer");
});

test("same-name customers with conflicting populated contacts remain distinct automatically", () => {
  const backend = mockBackend();
  for (const [id, email] of [["same-a", "a@example.com"], ["same-b", "b@example.com"]]) {
    assert.equal(backend.post({ action: "saveCustomer", customer: { id, name: "Sample Customer", phone: "260-555-0100", email }, mutationId: id, expectedRevision: 0 }).ok, true);
  }
  assert.equal(upload(backend).ok, true);
  assert.equal(backend.post({ action: "listCustomers" }).customers.length, 2);
});
