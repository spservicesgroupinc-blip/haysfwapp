import { test } from "node:test";
import assert from "node:assert/strict";
import { mockBackend } from "./helpers/backend";
import { createRequest } from "../src/services/requests";
import { createWorkspace } from "../src/workspaces/model";

test("linking a request preserves completed status, snapshot, corrections, and stable retries", () => {
  const backend = mockBackend();
  const workspace = createWorkspace();
  assert.equal(
    backend.post({
      action: "saveWorkspace",
      workspace,
      expectedRevision: 0,
      mutationId: "workspace-save",
    }).ok,
    true,
  );
  const request = createRequest();
  request.job.customer = "Historical customer";
  request.finalChangeOrder = { scope: "Estimator correction", amount: "-0.19" };
  let saved = backend.post({
    action: "saveRequest",
    request,
    expectedRevision: 0,
    mutationId: "request-save",
  }).request;
  saved = backend.post({
    action: "claimRequest",
    id: saved.id,
    estimatorName: "QA",
    expectedRevision: saved.revision,
    mutationId: "claim",
  }).request;
  // Request completion has its own required customer PDF gate; linking itself must also
  // preserve every workflow state, including a legacy completed snapshot.
  const index = backend.sheets.get("Requests");
  index.rows[1][4] = "completed";
  const before = JSON.parse(
    backend.files.get(index.rows[1][13]).getBlob().getDataAsString(),
  );
  before.request.status = "completed";
  backend.files.get(index.rows[1][13]).getBlob = () => ({
    getDataAsString: () => JSON.stringify(before),
  });
  const body = {
    action: "linkRequestWorkspace",
    id: saved.id,
    workspaceId: workspace.id,
    expectedRevision: saved.revision,
    mutationId: "request-link",
  };
  const result = backend.post(body);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.request.status, "completed");
  assert.deepEqual(result.request.job, saved.job);
  assert.deepEqual(result.request.finalChangeOrder, saved.finalChangeOrder);
  assert.equal(result.request.workspaceId, workspace.id);
  const retry = backend.post(body);
  assert.equal(retry.request.revision, result.request.revision);
  assert.equal(backend.post({ ...body, workspaceId: "missing" }).ok, false);
  assert.equal(
    backend.post({ ...body, mutationId: "another-link", expectedRevision: 0 })
      .code,
    "CONFLICT",
  );
});
