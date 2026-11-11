import { test } from "node:test";
import assert from "node:assert/strict";
import { sharedJobDirectory } from "../src/services/sharedJobDirectory";
import type { JobEntry } from "../src/types";

const job = (overrides: Partial<JobEntry> = {}): JobEntry => ({
  id: "job-1", customer: "Customer", jobNumber: "FW-1", address: "10 Main St",
  customerPhone: "555", customerEmail: "", contractAmount: "100.00",
  projectManager: "PM", estimator: "", status: "Active", active: true, updatedAt: "",
  ...overrides,
});

test("shared CSV values enrich the same job without duplicate options or blank erasure", () => {
  const rows = sharedJobDirectory([job()], [job({ id: "reference:FW-1", jobNumber: "fw-1", customerPhone: "", customerEmail: "csv@example.test", contractAmount: "0.00" })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "job-1");
  assert.equal(rows[0].customerPhone, "555");
  assert.equal(rows[0].customerEmail, "csv@example.test");
  assert.equal(rows[0].contractAmount, "0.00");
});

test("replacement removes stale cached reference rows and preserves unrelated directory jobs", () => {
  const rows = sharedJobDirectory([job(), job({ id: "reference:OLD", jobNumber: "OLD" }), job({ id: "csv-job-01234567890123456789012345678901", jobNumber: "OLD-BACKEND" })], [job({ id: "reference:NEW", jobNumber: "NEW" })]);
  assert.deepEqual(rows.map(row => row.jobNumber), ["FW-1", "NEW"]);
});
