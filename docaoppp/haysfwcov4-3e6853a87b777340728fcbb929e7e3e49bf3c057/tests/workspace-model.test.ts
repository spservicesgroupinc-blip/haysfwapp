import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWorkspace,
  workspaceFromDirectory,
  requestFromWorkspace,
  updateRecordField,
  recalculateFinancials,
} from "../src/workspaces/model";
import { createRequest } from "../src/services/requests";
import { priorChangeSummary } from "../src/services/changeOrder";
import type { JobEntry } from "../src/types";

test("CSV directory details carry location and insurance into job documents and requests", () => {
  const entry: JobEntry = {
    id: "csv-1", jobNumber: "FW-CSV-1", customer: "CSV Customer",
    address: "10 Test St, Indianapolis, IN 46201", jobAddress: "10 Test St",
    city: "Indianapolis", state: "IN", zip: "46201",
    customerPhone: "317-555-0100", customerEmail: "csv@example.test",
    projectManager: "CSV Manager", estimator: "CSV Estimator",
    carrier: "CSV Carrier", claim: "CLAIM-1", contractAmount: "0.00",
    status: "Active", active: true, updatedAt: "",
  };
  const workspace = workspaceFromDirectory(entry);
  assert.equal(workspace.record.customer.mailingAddress, "");
  assert.equal(workspace.record.customer.mailingCityStateZip, "");
  assert.equal(workspace.record.customer.lossAddress, entry.address);
  assert.equal(workspace.record.insurance.carrier, entry.carrier);
  assert.equal(workspace.record.insurance.claimNumber, entry.claim);
  const request = requestFromWorkspace(workspace);
  assert.equal(request.job.carrier, "CSV Carrier");
  assert.equal(request.job.claim, "CLAIM-1");
  assert.equal(request.job.originalContract, "0.00");
});

test("job workspaces keep RCV separate from the original contract and preserve explicit zero", () => {
  const workspace = createWorkspace();
  workspace.record.financials.totalApprovedRcv = 5000;
  workspace.originalContract = "0.00";
  workspace.previousChanges = "-25.19";
  const request = requestFromWorkspace(workspace);
  assert.equal(request.workspaceId, workspace.id);
  assert.equal(request.job.originalContract, "0.00");
  assert.equal(request.job.previousChanges, "-25.19");
  assert.equal(request.finalChangeOrder, undefined);
  assert.equal(workspace.record.financials.totalApprovedRcv, 5000);
});

test("a new request continues from every earlier change order on the job", () => {
  const workspace = createWorkspace();
  workspace.previousChanges = "-20.05";
  const first = createRequest();
  first.job.orderNumber = "CO-01";
  first.job.previousChanges = "-20.05";
  first.finalChangeOrder = { scope: "First", amount: "+100.00" };
  const second = createRequest();
  second.job.orderNumber = "CO-02";
  second.job.previousChanges = "79.95";
  second.finalChangeOrder = { scope: "Second", amount: "+50.00" };
  const request = requestFromWorkspace(
    workspace,
    undefined,
    priorChangeSummary([first, second], workspace.previousChanges),
  );
  assert.equal(request.job.previousChanges, "129.95");
  assert.equal(request.job.orderNumber, "CO-03");
  assert.equal(request.finalChangeOrder, undefined);
});

test("prefilling new requests never rewrites an existing snapshot or estimator corrections", () => {
  const workspace = createWorkspace();
  workspace.record.customer.customerName = "Updated job name";
  const existing = createRequest();
  existing.job.customer = "Snapshot";
  existing.finalChangeOrder = { scope: "Corrected scope", amount: "-100.19" };
  assert.deepEqual(requestFromWorkspace(workspace, existing), existing);
});

test("replacing a directory row ID does not change a saved workspace identity", () => {
  const entry = {
    id: "directory-1",
    jobNumber: "F-26-1",
    customer: "Name",
    address: "Address",
    projectManager: "PM",
    estimator: "Estimator",
    status: "Active",
    customerPhone: "555",
    customerEmail: "email@example.test",
    contractAmount: "123.45",
    active: true,
    updatedAt: "",
  };
  const workspace = workspaceFromDirectory(entry);
  assert.notEqual(workspace.id, entry.id);
  assert.equal(workspace.originalContract, "123.45");
  assert.equal(workspace.record.financials.totalApprovedRcv, "");
  assert.equal(requestFromWorkspace(workspace).job.customerPhone, "555");
});

test("PDF field edits reject unrelated paths and preserve checkbox and numeric values", () => {
  const workspace = createWorkspace();
  assert.throws(() =>
    updateRecordField(workspace.record, "__proto__.polluted", "yes"),
  );
  const changed = updateRecordField(
    workspace.record,
    "financials.totalApprovedRcv",
    "0",
  );
  assert.equal(changed.financials.totalApprovedRcv, 0);
  assert.equal(workspace.record.financials.totalApprovedRcv, "");
});

test("agreement payments split approved RCV while net claim subtracts the deductible", () => {
  const workspace = createWorkspace();
  workspace.record.financials.totalApprovedRcv = 10000.03;
  workspace.record.financials.deductible = 1000;
  const financials = recalculateFinancials(workspace.record).financials;
  assert.equal(financials.netClaimValue, 9000.03);
  assert.equal(financials.downPayment, 5000.02);
  assert.equal(financials.midProgressPayment, 2500.01);
  assert.equal(financials.balancePayment, 2500);
  workspace.record.financials.totalApprovedRcv = "";
  assert.equal(
    recalculateFinancials(workspace.record).financials.downPayment,
    0,
  );
});
