import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequest, createRequestedChange } from "../src/services/requests";
import { formatDashNote } from "../src/services/dashNote";

test("Dash note includes answers, customer details, full scope text and attachment names", () => {
  const request = createRequest();
  request.requestType = "insurance_supplement";
  request.customerCredits = true;
  request.knownChangeAmount = "-250.19";
  Object.assign(request.job, {
    customer: "José Customer",
    customerPhone: "555-0100",
    customerEmail: "customer@example.com",
    jobNumber: "FW-001",
    address: "123 Sample Street",
    projectManager: "Sample PM",
    originalContract: "100.10",
    previousChanges: "-0.10",
  });
  request.requestedChanges = [
    {
      ...createRequestedChange(),
      room: "Kitchen",
      action: "remove",
      description: "First line\nSecond line",
      reason: "Customer credit",
      measurements: "12 SF",
      materials: "Tile",
      scheduleImpact: "One day",
    },
  ];
  request.attachments = [
    {
      id: "a1",
      name: "quote.pdf",
      kind: "document",
      mimeType: "application/pdf",
      size: 9,
      driveFileId: "d1",
    },
  ];
  const text = formatDashNote(request);
  for (const expected of [
    "Insurance supplement",
    "Customer credits: Yes",
    "Known change amount: -$250.19",
    "José Customer",
    "555-0100",
    "customer@example.com",
    "FW-001",
    "123 Sample Street",
    "Sample PM",
    "$100.00",
    "Kitchen",
    "remove",
    "First line\nSecond line",
    "Customer credit",
    "12 SF",
    "Tile",
    "One day",
    "quote.pdf",
  ])
    assert.ok(text.includes(expected), expected);
});

test("legacy answers are not inferred and explicit unchecked customer credits means No", () => {
  const request = createRequest();
  delete request.customerCredits;
  assert.ok(formatDashNote(request).includes("Request type: Not provided"));
  assert.ok(formatDashNote(request).includes("Customer credits: Not provided"));
  request.customerCredits = false;
  request.requestType = "change_order";
  assert.ok(formatDashNote(request).includes("Customer credits: No"));
  assert.ok(formatDashNote(request).includes("Request type: Change order"));
});
