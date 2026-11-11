import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequest } from "../src/services/requests";
import {
  customerDocumentFingerprint,
  invalidateCustomerDocument,
} from "../src/services/customerDocument";

test("document fingerprints track printed fields but exclude internal request details", async () => {
  const request = createRequest();
  const original = await customerDocumentFingerprint(request);
  request.informationQuestion = "Internal estimator question";
  request.knownChangeAmount = "+40.00";
  assert.equal(await customerDocumentFingerprint(request), original);
  request.job.originalContract = "100.01";
  assert.notEqual(await customerDocumentFingerprint(request), original);
});

test("editing printed inputs unlinks a stale customer PDF and preserves source attachments", async () => {
  const saved = createRequest();
  saved.attachments = [
    {
      id: "source",
      kind: "photo",
      name: "photo.jpg",
      mimeType: "image/jpeg",
      size: 1,
      driveFileId: "f1",
    },
    {
      id: "pdf",
      kind: "document",
      name: "change-order.pdf",
      mimeType: "application/pdf",
      size: 1,
      driveFileId: "f2",
    },
  ];
  saved.customerDocument = {
    attachmentId: "pdf",
    inputFingerprint: await customerDocumentFingerprint(saved),
    templateVersion: 1,
  };
  const edited = structuredClone(saved);
  edited.job.customer = "Corrected customer";
  const result = await invalidateCustomerDocument(edited);
  assert.equal(result.customerDocument, undefined);
  assert.deepEqual(
    result.attachments.map((file) => file.id),
    ["source"],
  );
  assert.equal(saved.attachments.length, 2);
});
