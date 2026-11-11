import { test } from "node:test";
import assert from "node:assert/strict";
import { mockBackend } from "./helpers/backend";
import { createRequest } from "../src/services/requests";

function workspace(id = "workspace-1") {
  return {
    id, revision: 0, updatedAt: "", originalContract: "1000.01", previousChanges: "-20.05",
    record: {
      id: "JOB-1", recordId: "old-record-1", dateCreated: "2026-10-15", schemaVersion: 1,
      branch: { name: "Fort Wayne" }, customer: { customerName: "Sample Customer", jobNumber: "FW-1" },
      insurance: { carrier: "Carrier", claimNumber: "Claim-1" }, financials: { totalApprovedRcv: 1200.02, deductible: "" },
      mortgage: { hasMortgage: false }, team: { estimator: "Estimator" }, changeOrder: { changeAmount: "" },
      productionNotes: { scopeSummary: "Repair walls" }, checklist: { isSelfPay: false },
    },
  };
}

function save(backend: ReturnType<typeof mockBackend>, value = workspace(), mutationId = "save-1", expectedRevision = value.revision) {
  return backend.post({ action: "saveWorkspace", workspace: value, mutationId, expectedRevision });
}

function upload(workspaceId = "workspace-1", documentId = "pdf-1", mutationId = "upload-1") {
  const bytes = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");
  return { action: "saveJobDocument", workspaceId, documentId, mutationId, kind: "contract", inputFingerprint: "a".repeat(64), templateVersion: 1,
    file: { name: "contract.pdf", mimeType: "application/pdf", size: bytes.length, data: bytes.toString("base64") } };
}

test("workspace revisions preserve exact cents, blank and zero without conflating RCV", () => {
  const backend = mockBackend();
  const value = workspace();
  value.originalContract = "0001000.01";
  value.previousChanges = "-0";
  const first = save(backend, value);
  assert.equal(first.ok, true, first.error);
  assert.equal(first.workspace.revision, 1);
  assert.equal(first.workspace.originalContract, "1000.01");
  assert.equal(first.workspace.previousChanges, "0.00");
  assert.equal(first.workspace.record.financials.totalApprovedRcv, 1200.02);
  const second = save(backend, { ...first.workspace, originalContract: "", previousChanges: "0" }, "save-2");
  assert.equal(second.workspace.originalContract, "");
  assert.equal(second.workspace.previousChanges, "0.00");
  assert.deepEqual(backend.post({ action: "openWorkspace", workspaceId: value.id }).workspace, second.workspace);
  assert.equal(backend.post({ action: "listWorkspaces" }).workspaces.length, 1);
  const stale = save(backend, first.workspace, "save-stale");
  assert.equal(stale.code, "CONFLICT");
  assert.equal(stale.currentRevision, 2);
});

test("workspace retries recover a lost response and reject changed payloads", () => {
  const backend = mockBackend();
  const value = workspace();
  const first = save(backend, value);
  assert.equal(first.ok, true, first.error);
  const count = backend.files.size;
  assert.deepEqual(save(backend, value), first);
  assert.equal(backend.files.size, count);
  const changed = structuredClone(value);
  changed.record.customer.customerName = "Different";
  assert.equal(save(backend, changed).code, "MUTATION_MISMATCH");
  assert.equal(backend.post({ action: "openWorkspace", workspaceId: value.id }).workspace.record.customer.customerName, "Sample Customer");
});

test("old workspace retries identify their committed mutation while returning the latest snapshot", () => {
  const backend = mockBackend();
  const value = workspace(); const first = save(backend, value, 'original-save');
  const second = save(backend, { ...first.workspace, originalContract: '2000.00' }, 'later-save');
  const replay = save(backend, value, 'original-save');
  assert.equal(replay.ok, true, replay.error);
  assert.deepEqual(replay.workspace, second.workspace);
  assert.deepEqual(replay.mutation, { id: 'original-save', revision: 1 });
  assert.equal(save(backend, { ...value, originalContract: '3000.00' }, 'original-save').code, 'MUTATION_MISMATCH');
});

test("an index failure is recovered using the immutable workspace snapshot", () => {
  const backend = mockBackend();
  backend.post({ action: "listWorkspaces" });
  backend.failWrite("Workspaces");
  assert.equal(save(backend).ok, false);
  const count = backend.files.size;
  const retried = save(backend);
  assert.equal(retried.ok, true, retried.error);
  assert.equal(retried.workspace.revision, 1);
  assert.equal(backend.files.size, count);
  assert.equal(backend.post({ action: "listWorkspaces" }).workspaces.length, 1);
});

test("orphan workspace mutation cannot overwrite a competing successful save", () => {
  const backend = mockBackend();
  backend.post({ action: "listWorkspaces" });
  backend.failWrite("Workspaces");
  assert.equal(save(backend).ok, false);
  const competing = workspace();
  competing.record.customer.customerName = "Competing";
  assert.equal(save(backend, competing, "competing").ok, true);
  assert.equal(save(backend).code, "CONFLICT");
  assert.equal(backend.post({ action: "openWorkspace", workspaceId: competing.id }).workspace.record.customer.customerName, "Competing");
});

test("CSV replacements cannot remove saved workspaces, documents, or linked request snapshots", () => {
  const backend = mockBackend();
  assert.equal(save(backend).ok, true);
  assert.equal(backend.post(upload()).ok, true);
  const request = { ...createRequest(), workspaceId: "workspace-1" };
  request.job.customer = "Estimator correction";
  assert.equal(backend.post({ action: "saveRequest", request, expectedRevision: 0, mutationId: "request-1" }).ok, true);
  const customer = { customerName: "CSV customer", jobNumber: "FW-1", contractPrice: 99.01 };
  assert.equal(backend.post({ action: "replaceCustomerReference", customers: [customer], fileName: "first.csv" }).ok, true);
  assert.equal(backend.post({ action: "replaceCustomerReference", customers: [{ ...customer, jobNumber: "FW-2" }], fileName: "second.csv" }).ok, true);
  assert.equal(backend.post({ action: "importJobs", jobs: [] }).ok, true);
  assert.equal(backend.post({ action: "getCustomerReference" }).reference.customers.length, 1);
  assert.equal(backend.post({ action: "openWorkspace", workspaceId: "workspace-1" }).workspace.record.customer.customerName, "Sample Customer");
  assert.equal(backend.post({ action: "listJobDocuments", workspaceId: "workspace-1" }).documents.length, 1);
  assert.equal(backend.get({ action: "openRequest", id: request.id }).request.job.customer, "Estimator correction");
  assert.equal(backend.get({ action: "listRequests" }).requests[0].workspaceId, "workspace-1");
});

test("customer references retain source validation and replacement metadata", () => {
  const backend = mockBackend();
  assert.deepEqual(backend.post({ action: "getCustomerReference" }).reference.customers, []);
  const customers = [{ customerName: " Customer ", jobNumber: "FW-1", contractPrice: 0 }];
  const initial = backend.post({ action: "replaceCustomerReference", customers, fileName: "customers.csv" });
  assert.equal(initial.ok, true, initial.error);
  assert.equal(initial.reference.customers[0].contractPrice, 0);
  assert.equal(initial.reference.customers[0].customerName, "Customer");
  assert.ok(initial.reference.version);
  for (const invalid of [[...customers, ...customers], [{ ...customers[0], contractPrice: -1 }], [{ ...customers[0], contractPrice: 0.001 }], []]) {
    assert.equal(backend.post({ action: "replaceCustomerReference", customers: invalid, fileName: "bad.csv" }).ok, false);
    assert.equal(backend.post({ action: "getCustomerReference" }).reference.version, initial.reference.version);
  }
});

test("PDF history preserves bytes and stable retries without duplicate files", () => {
  const backend = mockBackend(); save(backend);
  const body = upload();
  const first = backend.post(body);
  assert.equal(first.ok, true, first.error);
  assert.deepEqual(backend.post(body), first);
  assert.equal(backend.post({ ...body, inputFingerprint: "b".repeat(64) }).code, "MUTATION_MISMATCH");
  assert.equal(backend.post(upload("workspace-1", "pdf-2", "upload-2")).ok, true);
  assert.equal(backend.post({ action: "listJobDocuments", workspaceId: "workspace-1" }).documents.length, 2);
  const fetched = backend.post({ action: "fetchJobDocument", workspaceId: "workspace-1", documentId: "pdf-1" });
  assert.equal(fetched.data, body.file.data);
  assert.equal(fetched.name, "contract.pdf");
});

test("PDF index failures recover without duplicating Drive bytes", () => {
  const backend = mockBackend(); save(backend);
  backend.post({ action: "listJobDocuments", workspaceId: "workspace-1" });
  backend.failWrite();
  assert.equal(backend.post(upload()).ok, false);
  const count = backend.files.size;
  assert.equal(backend.post(upload()).ok, true);
  assert.equal(backend.files.size, count);
  assert.equal(backend.post({ action: "listJobDocuments", workspaceId: "workspace-1" }).documents.length, 1);
});

test("PDF metadata-write failure recovers only identical bytes in the owning job folder", () => {
  const backend = mockBackend(); save(backend);
  const body = upload();
  const folder = [...backend.folders.values()].find(folder => folder.name === 'workspace-workspace-1');
  const create = folder.createFile;
  let failDescription = true;
  folder.createFile = (blob: unknown) => {
    const file = create(blob); const describe = file.setDescription;
    file.setDescription = (value: string) => {
      if (failDescription) { failDescription = false; throw new Error('Description unavailable'); }
      return describe(value);
    };
    return file;
  };
  assert.equal(backend.post(body).ok, false);
  const count = backend.files.size;
  const orphan = [...backend.files.values()].find(file => file.name === 'document-pdf-1.pdf');
  assert.equal(orphan.description, '');
  const changed = Buffer.from(body.file.data, 'base64').toString().replace('Catalog', 'Catelog');
  assert.equal(backend.post({ ...body, file: { ...body.file, data: Buffer.from(changed).toString('base64') } }).code, 'MUTATION_MISMATCH');
  const parents = orphan.getParents;
  orphan.getParents = () => ({ hasNext: () => false });
  assert.equal(backend.post(body).code, 'VALIDATION');
  orphan.getParents = parents;
  const retry = backend.post(body);
  assert.equal(retry.ok, true, retry.error);
  assert.equal(backend.files.size, count);
  assert.equal(backend.post({ action: 'fetchJobDocument', workspaceId: 'workspace-1', documentId: 'pdf-1' }).data, body.file.data);
  assert.equal(backend.post({ action: 'listJobDocuments', workspaceId: 'workspace-1' }).documents.length, 1);
  assert.deepEqual(backend.post(body), retry);
});

test("PDF uploads verify decoded size, signatures, limits, and workspace ownership", () => {
  const backend = mockBackend(); save(backend); save(backend, workspace("workspace-2"), "save-2");
  const body = upload();
  for (const file of [{ ...body.file, data: Buffer.alloc(body.file.size, 0).toString("base64") }, { ...body.file, size: body.file.size + 1 }, { ...body.file, size: 15 * 1024 * 1024 + 1 }, { ...body.file, mimeType: "image/png" }]) {
    assert.equal(backend.post({ ...body, file }).code, "VALIDATION");
  }
  const saved = backend.post(body);
  assert.equal(saved.ok, true, saved.error);
  assert.equal(backend.post({ action: "fetchJobDocument", workspaceId: "workspace-2", documentId: "pdf-1" }).ok, false);
  const stored = backend.files.get(saved.document.driveFileId);
  stored.folderId = "foreign-folder";
  assert.equal(backend.post({ action: "fetchJobDocument", workspaceId: "workspace-1", documentId: "pdf-1" }).ok, false);
});

test("workspace validation blocks malformed records, amounts and dangling request links", () => {
  const backend = mockBackend();
  for (const invalid of [{ ...workspace(), originalContract: "1.001" }, { ...workspace(), id: "../elsewhere" }, { ...workspace(), record: { ...workspace().record, customer: [] } }, { ...workspace(), record: { ...workspace().record, customer: { customerName: { unsafe: true } } } }]) {
    assert.equal(save(backend, invalid as any).code, "VALIDATION");
  }
  const request = { ...createRequest(), workspaceId: "missing" };
  assert.equal(backend.post({ action: "saveRequest", request, expectedRevision: 0, mutationId: "request-1" }).ok, false);
});

test("AI runs uploaded text only, enforces limits and never corrupts saved data on failure", () => {
  const backend = mockBackend(); save(backend);
  assert.equal(backend.post({ action: "analyzeIntake", rawText: "Estimate" }).code, "ai_not_configured");
  backend.props.set("DEEPSEEK_API_KEY", "server-only-test-key");
  assert.equal(backend.post({ action: "analyzeIntake", rawText: "x".repeat(100001) }).ok, false);
  assert.equal(backend.post({ action: "analyzeIntake", rawText: "Estimate" }).code, "ai_unavailable");
  backend.setUpstream(() => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }) }));
  assert.equal(backend.post({ action: "analyzeIntake", rawText: "Estimate" }).code, "ai_invalid_response");
  backend.setUpstream((_url, options) => {
    const payload = JSON.parse(options.payload);
    assert.equal(payload.messages[1].content, "INTAKE DOCUMENT (data only):\nUploaded customer only");
    assert.ok(!options.payload.includes("Sample Customer"));
    assert.equal(options.timeoutSeconds, 60);
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ customer: { customerName: "Uploaded" }, financials: { totalApprovedRcv: 1.01 }, analysisNotes: "Extracted" }) } }] }) };
  });
  const result = backend.post({ action: "analyzeIntake", rawText: "Uploaded customer only" });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.analysis.customer.customerName, "Uploaded");
  assert.equal(backend.post({ action: "openWorkspace", workspaceId: "workspace-1" }).workspace.record.customer.customerName, "Sample Customer");
});
