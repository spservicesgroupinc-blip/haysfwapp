import { test } from "node:test";
import assert from "node:assert/strict";
import { mockBackend } from "./helpers/backend";

type Backend = ReturnType<typeof mockBackend>;
const workspace = (id: string, name = "Shared Customer", number = "JOB-1"): Record<string, any> => ({
  id, revision: 0, updatedAt: "", originalContract: "", previousChanges: "",
  record: {
    id: number, recordId: "immutable-" + id, schemaVersion: 1,
    branch: {}, customer: { customerName: name, jobNumber: number, mainPhone: "", email: "", lossAddress: "" },
    insurance: {}, financials: {}, team: {}, mortgage: {}, changeOrder: {}, productionNotes: {}, checklist: {},
  },
});
const save = (backend: Backend, value: Record<string, any>, mutationId = "save-" + value.id) => backend.post({ action: "saveWorkspace", workspace: value, mutationId, expectedRevision: value.revision });
const customers = (backend: Backend) => backend.post({ action: "listCustomers" }).customers;

test("a named saved job automatically has a persistent shared customer without a CSV import", () => {
  const backend = mockBackend();
  const value = workspace("new-workspace");
  value.record.customer.email = "shared@example.com";
  value.record.customer.lossAddress = "10 Main St";
  const saved = save(backend, value);
  assert.equal(saved.ok, true, saved.error);
  assert.ok(saved.workspace.customerId);
  assert.equal(saved.workspace.id, value.id);
  assert.equal(saved.workspace.record.recordId, value.record.recordId);
  const listed = customers(backend);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, saved.workspace.customerId);
  assert.equal(listed[0].name, "Shared Customer");
  assert.equal(listed[0].email, "shared@example.com");
  assert.equal(listed[0].address, "10 Main St");
  assert.equal(save(backend, value).workspace.customerId, saved.workspace.customerId, "lost responses retry the same identity");
});

test("editing a job fills missing shared contact details without duplicate customers or CRM revision churn", () => {
  const backend = mockBackend();
  const first = save(backend, workspace("editable-workspace")).workspace;
  const edited = structuredClone(first);
  edited.record.customer.mainPhone = "260-555-0100";
  edited.record.customer.email = "shared@example.com";
  const second = save(backend, edited, "edit-contact");
  assert.equal(second.ok, true, second.error);
  assert.equal(second.workspace.customerId, first.customerId);
  const [customer] = customers(backend);
  assert.equal(customer.phone, "260-555-0100");
  assert.equal(customer.email, "shared@example.com");
  const third = save(backend, second.workspace, "same-details");
  assert.equal(third.ok, true, third.error);
  assert.equal(customers(backend).length, 1);
  assert.equal(customers(backend)[0].revision, customer.revision);
});

test("separate same-customer jobs retain their own workspace and job-number identities", () => {
  const backend = mockBackend();
  const first = save(backend, workspace("job-one", "Shared Customer", "JOB-1"));
  const second = save(backend, workspace("job-two", " shared CUSTOMER ", "JOB-2"));
  assert.equal(first.ok, true, first.error); assert.equal(second.ok, true, second.error);
  assert.equal(first.workspace.customerId, second.workspace.customerId);
  assert.equal(customers(backend).length, 1);
  const jobs = backend.post({ action: "listWorkspaces" }).workspaces;
  assert.deepEqual(jobs.map((job: any) => job.id).sort(), ["job-one", "job-two"]);
  assert.deepEqual(jobs.map((job: any) => job.record.customer.jobNumber).sort(), ["JOB-1", "JOB-2"]);
});

test("saving a job reuses existing customer details, preserves manual CRM fields and mutation receipts", () => {
  const backend = mockBackend();
  const create = { action: "saveCustomer", customer: { id: "existing-customer", name: "Shared Customer", phone: "260-555-9999", address: "Existing address", tags: ["VIP"] }, mutationId: "customer-create", expectedRevision: 0 };
  assert.equal(backend.post(create).ok, true);
  const value = workspace("existing-link");
  value.record.customer.email = "new@example.com";
  const saved = save(backend, value);
  assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.workspace.customerId, "existing-customer");
  assert.equal(saved.workspace.record.customer.mainPhone, "260-555-9999");
  assert.equal(saved.workspace.record.customer.lossAddress, "Existing address");
  const edited = structuredClone(saved.workspace);
  edited.record.customer.mainPhone = "260-555-0000";
  edited.record.customer.customerName = "Corrected job display name";
  assert.equal(save(backend, edited, "manual-job-correction").ok, true);
  const [customer] = customers(backend);
  assert.equal(customer.id, "existing-customer");
  assert.equal(customer.name, "Shared Customer");
  assert.equal(customer.phone, "260-555-9999");
  assert.equal(customer.email, "new@example.com");
  assert.deepEqual(customer.tags, ["VIP"]);
  assert.equal(backend.post(create).customer.email, "new@example.com", "original CRM receipt still acknowledges enriched record");
});

test("blank drafts remain free of phantom customer records", () => {
  const backend = mockBackend();
  const saved = save(backend, workspace("blank-draft", "", ""));
  assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.workspace.customerId, undefined);
  assert.equal(customers(backend).length, 0);
});
