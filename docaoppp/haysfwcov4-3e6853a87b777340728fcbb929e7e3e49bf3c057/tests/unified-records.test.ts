import { test } from "node:test";
import assert from "node:assert/strict";
import { unifiedRecords } from "../src/services/unifiedRecords";
import { createWorkspace } from "../src/workspaces/model";
import type { JobEntry } from "../src/types";

const job: JobEntry = { id: "job", jobNumber: "FW-1", customer: "Same Customer", address: "10 Main St", customerPhone: "555", customerEmail: "", projectManager: "", estimator: "", contractAmount: "10.00", active: true, status: "Active", updatedAt: "" };
const customer = { id: "customer", name: job.customer, address: job.address, jobCount: 1, openTaskCount: 0, updatedAt: "" };

test("a saved job, CSV row, and linked customer display as one record", () => {
  const workspace = createWorkspace();
  Object.assign(workspace.record.customer, { customerName: "Saved correction", jobNumber: "fw-1", lossAddress: "Saved address" });
  workspace.customerId = customer.id;
  const records = unifiedRecords([{ workspace, serverRevision: 1, dirty: false }], [job], [customer]);
  assert.equal(records.length, 1);
  assert.equal(records[0].name, "Saved correction");
  assert.equal(records[0].address, "Saved address");
});

test("imported job customers show once; different job numbers remain separate", () => {
  const records = unifiedRecords([], [job, { ...job, id: "second", jobNumber: "FW-2" }], [customer]);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map(record => record.jobNumber), ["FW-1", "FW-2"]);
  assert.ok(records.every(record => record.customerId === customer.id));
});

test("a customer without a CSV job or workspace is still a usable record", () => {
  const records = unifiedRecords([], [], [customer]);
  assert.equal(records.length, 1);
  assert.equal(records[0].customerId, customer.id);
});
