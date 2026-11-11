import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkspace } from "../src/workspaces/model";
import { fillWorkspaceFromDirectory, matchingDirectoryEntry } from "../src/documents/services/directoryAutofill";
import type { JobEntry } from "../src/types";

const entry: JobEntry = {
  id: "directory-1",
  jobNumber: "FW-100",
  customer: "Alex Customer",
  address: "18 Lake St, Fort Wayne, IN 46802",
  projectManager: "Pat Manager",
  estimator: "Taylor Estimator",
  status: "Active",
  customerPhone: "260-555-0133",
  customerEmail: "alex@example.com",
  contractAmount: "12400.50",
  active: true,
  updatedAt: "2026-10-22T12:00:00Z",
};

test("matching detects a job number automatically even with a corrected customer name", () => {
  const workspace = createWorkspace();
  workspace.record.customer.jobNumber = " fw-100 ";
  workspace.record.customer.customerName = "Reviewed customer name";
  assert.equal(matchingDirectoryEntry(workspace, [entry]), entry);
  const merged = fillWorkspaceFromDirectory(workspace, entry);
  assert.equal(merged.record.customer.mainPhone, entry.customerPhone);
  assert.equal(merged.record.customer.customerName, "Reviewed customer name");
  assert.equal(fillWorkspaceFromDirectory(merged, entry), merged);
});

test("a unique name matches automatically but multiple customer jobs stay separate", () => {
  const workspace = createWorkspace();
  workspace.record.customer.customerName = "  Alex   Customer ";
  assert.equal(matchingDirectoryEntry(workspace, [entry]), entry);
  const other = { ...entry, id: "other", jobNumber: "FW-200", address: "200 Other St" };
  assert.equal(matchingDirectoryEntry(workspace, [entry, other]), undefined);
  workspace.record.customer.lossAddress = other.address;
  assert.equal(matchingDirectoryEntry(workspace, [entry, other]), other);
  workspace.record.customer.jobNumber = "FW-300";
  assert.equal(matchingDirectoryEntry(workspace, [entry, other]), undefined);
});

test("an explicit directory pick fills blank saved job fields and preserves manual edits", () => {
  const workspace = createWorkspace();
  workspace.record.customer.jobNumber = "fw-100";
  workspace.record.customer.customerName = "Alex corrected name";
  workspace.record.customer.email = "reviewed@example.com";
  workspace.record.team.projectManager = "Reviewed PM";
  workspace.record.team.estimator = "";
  workspace.originalContract = "0";
  const next = fillWorkspaceFromDirectory(workspace, entry);
  assert.equal(next.record.customer.customerName, "Alex corrected name");
  assert.equal(next.record.customer.lossAddress, entry.address);
  assert.equal(next.record.customer.mainPhone, entry.customerPhone);
  assert.equal(next.record.customer.email, "reviewed@example.com");
  assert.equal(next.record.team.projectManager, "Reviewed PM");
  assert.equal(next.record.team.estimator, entry.estimator);
  assert.equal(next.originalContract, "0");
  assert.equal(next.record.changeOrder.originalContractSum, 0);
  assert.equal(workspace.record.customer.mainPhone, "");
});

test("directory fills document contract blanks from the saved contract and preserves document corrections", () => {
  const workspace = createWorkspace();
  workspace.originalContract = "321.09";
  const next = fillWorkspaceFromDirectory(workspace, entry);
  assert.equal(next.record.changeOrder.originalContractSum, 321.09);
  next.record.changeOrder.originalContractSum = 500;
  assert.equal(fillWorkspaceFromDirectory(next, entry).record.changeOrder.originalContractSum, 500);
});

test("a different job cannot silently fill an existing job's blanks", () => {
  const workspace = createWorkspace();
  workspace.record.customer.jobNumber = "FW-200";
  assert.throws(
    () => fillWorkspaceFromDirectory(workspace, entry),
    /different job number/,
  );
});

test("a matching customer contact can link and fill a job without replacing its number", () => {
  const workspace = createWorkspace();
  workspace.record.customer.jobNumber = "FW-200";
  workspace.record.customer.customerName = "Alex Customer";
  const next = fillWorkspaceFromDirectory(workspace, {
    ...entry,
    id: "customer:alex",
    jobNumber: "",
    contractAmount: "",
  });
  assert.equal(next.customerId, "alex");
  assert.equal(next.record.customer.jobNumber, "FW-200");
  assert.equal(next.record.customer.mainPhone, entry.customerPhone);
  assert.equal(next.originalContract, "");
});

test("a customer with a different name cannot be applied without an exact job match", () => {
  const workspace = createWorkspace();
  workspace.record.customer.customerName = "Another Customer";
  assert.throws(
    () => fillWorkspaceFromDirectory(workspace, entry),
    /different customer/,
  );
});

test("CSV team and schedule fields fill blanks without copying default team values", () => {
  const workspace = createWorkspace();
  workspace.record.team.supervisor = "";
  workspace.record.team.foreman = "Reviewed Foreman";
  workspace.record.insurance.dateInspected = "";
  workspace.record.checklist.finishDate = "2026-12-31";
  const next = fillWorkspaceFromDirectory(workspace, {
    ...entry,
    supervisor: "CSV Supervisor",
    foreman: "CSV Foreman",
    dateInspected: "2026-10-12",
    startDate: "2026-11-01",
    finishDate: "2026-12-01",
  });
  assert.equal(next.record.team.supervisor, "CSV Supervisor");
  assert.equal(next.record.team.foreman, "Reviewed Foreman");
  assert.equal(next.record.insurance.dateInspected, "2026-10-12");
  assert.equal(next.record.checklist.startDate, "2026-11-01");
  assert.equal(next.record.checklist.finishDate, "2026-12-31");
});
