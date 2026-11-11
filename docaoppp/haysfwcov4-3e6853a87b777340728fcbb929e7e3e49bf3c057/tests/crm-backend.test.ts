import { test } from "node:test";
import assert from "node:assert/strict";
import { mockBackend } from "./helpers/backend";

type Backend = ReturnType<typeof mockBackend>;

function customer(id = "customer-1", extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, revision: 0, createdAt: "", updatedAt: "", name: "Sample Customer", ...extra };
}

function saveCustomer(backend: Backend, value = customer(), mutationId = "customer-save-1", expectedRevision = 0) {
  return backend.post({ action: "saveCustomer", customer: value, mutationId, expectedRevision });
}

function activity(customerId = "customer-1", id = "activity-1", at = "2026-10-01T12:00:00.000Z") {
  return { id, customerId, kind: "note", direction: "outbound", body: "Called customer", at };
}

function addActivity(backend: Backend, value = activity(), mutationId = "activity-1") {
  return backend.post({ action: "addActivity", activity: value, mutationId });
}

function task(customerId = "customer-1", id = "task-1", extra: Record<string, unknown> = {}) {
  return { id, customerId, title: "Follow up", status: "open", revision: 0, createdAt: "", ...extra };
}

function saveTask(backend: Backend, value = task(), mutationId = "task-1", expectedRevision = 0) {
  return backend.post({ action: "saveTask", task: value, mutationId, expectedRevision });
}

function workspace(id = "workspace-crm"): Record<string, any> {
  return {
    id, revision: 0, updatedAt: "", originalContract: "1000.00", previousChanges: "0.00",
    record: {
      id: "JOB-CRM-1", recordId: "record-crm-1", dateCreated: "2026-10-22", schemaVersion: 1,
      branch: { name: "Fort Wayne" }, customer: { customerName: "CRM Customer" },
      insurance: { carrier: "" }, financials: { totalApprovedRcv: 1000.01 },
      team: { estimator: "" }, mortgage: { hasMortgage: false },
      changeOrder: { changeAmount: "" }, productionNotes: { scopeSummary: "" },
      checklist: { isSelfPay: false },
    },
  };
}

test("customers create, list, open and update", () => {
  const backend = mockBackend();
  assert.deepEqual(backend.post({ action: "listCustomers" }).customers, []);
  const created = saveCustomer(backend);
  assert.equal(created.ok, true, created.error);
  assert.equal(created.customer.revision, 1);
  assert.ok(created.customer.createdAt);
  assert.ok(created.customer.updatedAt);
  assert.equal(backend.post({ action: "openCustomer", customerId: "customer-1" }).customer.name, "Sample Customer");
  const listed = backend.post({ action: "listCustomers" });
  assert.equal(listed.customers.length, 1);
  assert.equal(listed.customers[0].jobCount, 0);
  assert.equal(listed.customers[0].openTaskCount, 0);
  const updated = saveCustomer(backend, { ...created.customer, name: "Renamed" }, "customer-save-2", 1);
  assert.equal(updated.ok, true, updated.error);
  assert.equal(updated.customer.revision, 2);
  assert.equal(updated.customer.name, "Renamed");
});

test("saveCustomer rejects stale revisions", () => {
  const backend = mockBackend();
  assert.equal(saveCustomer(backend).ok, true);
  const stale = saveCustomer(backend, customer(), "customer-save-2", 0);
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "CONFLICT");
  assert.equal(stale.currentRevision, 1);
});

test("saveCustomer retries are idempotent and reject changed payloads", () => {
  const backend = mockBackend();
  const value = customer();
  const first = saveCustomer(backend, value, "customer-save-1");
  assert.equal(first.ok, true, first.error);
  const replay = saveCustomer(backend, value, "customer-save-1");
  assert.deepEqual(replay.customer, first.customer);
  assert.equal(backend.post({ action: "listCustomers" }).customers.length, 1);
  const changed = { ...value, name: "Different" };
  assert.equal(saveCustomer(backend, changed, "customer-save-1").code, "MUTATION_MISMATCH");
  assert.equal(backend.post({ action: "openCustomer", customerId: "customer-1" }).customer.name, "Sample Customer");
});

test("mergeCustomers reassigns activities and tasks and removes the source", () => {
  const backend = mockBackend();
  saveCustomer(backend, customer("customer-a", { name: "A" }), "save-a");
  saveCustomer(backend, customer("customer-b", { name: "B" }), "save-b");
  assert.equal(addActivity(backend, activity("customer-a", "activity-a"), "activity-a").ok, true);
  assert.equal(addActivity(backend, activity("customer-b", "activity-b"), "activity-b").ok, true);
  assert.equal(saveTask(backend, task("customer-a", "task-a"), "task-a").ok, true);
  assert.equal(saveTask(backend, task("customer-b", "task-b"), "task-b").ok, true);
  const merged = backend.post({ action: "mergeCustomers", targetId: "customer-a", sourceId: "customer-b" });
  assert.equal(merged.ok, true, merged.error);
  assert.equal(merged.customer.id, "customer-a");
  assert.ok(merged.customer.mergedFromIds.includes("customer-b"));
  const activities = backend.post({ action: "listActivities", customerId: "customer-a" }).activities;
  assert.equal(activities.length, 2);
  assert.ok(activities.every((a: any) => a.customerId === "customer-a"));
  assert.equal(backend.post({ action: "listActivities", customerId: "customer-b" }).activities.length, 0);
  const tasks = backend.post({ action: "listTasks", customerId: "customer-a" }).tasks;
  assert.equal(tasks.length, 2);
  assert.ok(tasks.every((t: any) => t.customerId === "customer-a"));
  assert.equal(backend.post({ action: "openCustomer", customerId: "customer-b" }).ok, false);
  const summaries = backend.post({ action: "listCustomers" }).customers;
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].revision, merged.customer.revision);
  assert.deepEqual(summaries[0].mergedFromIds, ["customer-b"]);
});

test("activities append, dedupe on retry, and sort newest first", () => {
  const backend = mockBackend();
  saveCustomer(backend);
  assert.equal(addActivity(backend, activity("customer-1", "activity-old", "2026-01-01T00:00:00.000Z"), "m-old").ok, true);
  assert.equal(addActivity(backend, activity("customer-1", "activity-new", "2026-02-01T00:00:00.000Z"), "m-new").ok, true);
  const replay = addActivity(backend, activity("customer-1", "activity-old", "2026-01-01T00:00:00.000Z"), "m-old");
  assert.equal(replay.ok, true, replay.error);
  assert.equal(replay.activity.id, "activity-old");
  assert.equal(addActivity(backend, activity("customer-1", "activity-other", "2026-01-01T00:00:00.000Z"), "m-old").code, "MUTATION_MISMATCH");
  const activities = backend.post({ action: "listActivities", customerId: "customer-1" }).activities;
  assert.equal(activities.length, 2);
  assert.equal(activities[0].id, "activity-new");
  assert.equal(activities[1].id, "activity-old");
});

test("tasks create, update and toggle completion with concurrency", () => {
  const backend = mockBackend();
  saveCustomer(backend);
  const created = saveTask(backend, task("customer-1", "task-1"), "task-1");
  assert.equal(created.ok, true, created.error);
  assert.equal(created.task.revision, 1);
  assert.equal(created.task.status, "open");
  const updated = saveTask(backend, { ...task("customer-1", "task-1", { title: "Revised title" }), revision: 1 }, "task-2", 1);
  assert.equal(updated.ok, true, updated.error);
  assert.equal(updated.task.revision, 2);
  assert.equal(updated.task.title, "Revised title");
  const doneBody = { ...task("customer-1", "task-1", { title: "Revised title", status: "done" }), revision: 2 };
  const done = saveTask(backend, doneBody, "task-3", 2);
  assert.equal(done.ok, true, done.error);
  assert.equal(done.task.status, "done");
  assert.ok(done.task.completedAt);
  const reopened = saveTask(backend, { ...task("customer-1", "task-1", { title: "Revised title", status: "open" }), revision: 3 }, "task-4", 3);
  assert.equal(reopened.ok, true, reopened.error);
  assert.equal(reopened.task.status, "open");
  assert.equal(reopened.task.completedAt, undefined);
  const stale = saveTask(backend, { ...task("customer-1", "task-1", { title: "Stale" }), revision: 2 }, "task-stale", 2);
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "CONFLICT");
  assert.equal(stale.currentRevision, 4);
  // A lost-response replay of an already-committed mutation is acknowledged
  // idempotently and returns the latest committed task without duplicating it.
  const replay = saveTask(backend, doneBody, "task-3", 2);
  assert.equal(replay.ok, true, replay.error);
  assert.equal(backend.post({ action: "listTasks", customerId: "customer-1" }).tasks.length, 1);
  assert.equal(replay.task.status, "open");
});

test("workspace stage and customerId round-trip through saveWorkspace", () => {
  const backend = mockBackend();
  const value = workspace();
  value.stage = "in_progress";
  value.customerId = "customer-1";
  const saved = backend.post({ action: "saveWorkspace", workspace: value, mutationId: "save-1", expectedRevision: 0 });
  assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.workspace.stage, "in_progress");
  assert.equal(saved.workspace.customerId, "customer-1");
  const opened = backend.post({ action: "openWorkspace", workspaceId: "workspace-crm" }).workspace;
  assert.equal(opened.stage, "in_progress");
  assert.equal(opened.customerId, "customer-1");
  assert.equal(backend.post({ action: "saveWorkspace", workspace: { ...workspace(), stage: "bogus" }, mutationId: "save-2", expectedRevision: 0 }).code, "VALIDATION");
  assert.equal(backend.post({ action: "saveWorkspace", workspace: { ...workspace(), customerId: "x".repeat(101) }, mutationId: "save-3", expectedRevision: 0 }).code, "VALIDATION");
  assert.equal(backend.post({ action: "saveWorkspace", workspace: workspace("workspace-plain"), mutationId: "save-4", expectedRevision: 0 }).ok, true);
});
