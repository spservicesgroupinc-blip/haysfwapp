import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequest } from "../src/services/requests";
import {
  signedMoneyCents,
  signedAmountValue,
  finalContractTotal,
  finalDocumentError,
  pricingInputError,
  customerDocumentDraft,
  priorChangeSummary,
  priorChangesForJob,
} from "../src/services/changeOrder";
import { formatDashNote } from "../src/services/dashNote";
import { createRequestedChange } from "../src/services/requests";

test("document preparation inherits scope entries and job information, with no submitted price", () => {
  const request = createRequest();
  request.estimatorName = "Jamie Estimator";
  request.job.originalContract = "1000.00";
  request.lineNumbers = "+12, -34";
  request.requestedChanges = [
    {
      ...createRequestedChange(),
      room: "Kitchen",
      description: "Replace insulation",
      measurements: "12 square feet",
      materials: "R-13",
      scheduleImpact: "2 days",
    },
    {
      ...createRequestedChange(),
      action: "remove",
      room: "Bedroom",
      description: "Credit unused trim",
    },
  ];
  const draft = customerDocumentDraft(request);
  assert.equal(draft.finalChangeOrder!.amount, "");
  for (const text of [
    "Change 1 - Kitchen (add)",
    "Replace insulation",
    "12 square feet",
    "R-13",
    "2 days",
    "Change 2 - Bedroom (remove)",
    "Credit unused trim",
  ])
    assert.ok(draft.finalChangeOrder!.scope.includes(text));
  assert.equal(draft.lineNumbers, request.lineNumbers);
  assert.equal(draft.job.branchContact, "Jamie Estimator");
  assert.equal(draft.job.originalContract, "1000.00");
  assert.equal(request.finalChangeOrder, undefined);
  request.requestedChanges = [
    {
      ...createRequestedChange(),
      room: "Kitchen",
      action: "remove",
      description: "Unused trim",
    },
  ];
  assert.ok(
    customerDocumentDraft(request).finalChangeOrder!.scope.includes(
      "Kitchen - remove work",
    ),
  );
});

test("preparation carries the submitted amount into the estimator price and totals it", () => {
  const request = createRequest();
  request.job.originalContract = "1000.00";
  request.knownChangeAmount = "+1250.19";
  const draft = customerDocumentDraft(request);
  assert.equal(draft.finalChangeOrder!.amount, "+1250.19");
  assert.equal(finalContractTotal(draft), "$2,250.19");

  request.knownChangeAmount = "-250";
  assert.equal(customerDocumentDraft(request).finalChangeOrder!.amount, "-250.00");
  assert.equal(finalContractTotal(customerDocumentDraft(request)), "$750.00");

  // An estimator's saved correction always wins over the submitted amount.
  request.finalChangeOrder = { scope: "Estimator price", amount: "-125.50" };
  assert.equal(
    customerDocumentDraft(request).finalChangeOrder!.amount,
    "-125.50",
  );
  assert.equal(finalContractTotal(customerDocumentDraft(request)), "$874.50");

  // Absent or malformed submitted amounts never invent a price.
  request.finalChangeOrder = undefined;
  delete request.knownChangeAmount;
  assert.equal(customerDocumentDraft(request).finalChangeOrder!.amount, "");
  request.knownChangeAmount = "not-a-number";
  assert.equal(customerDocumentDraft(request).finalChangeOrder!.amount, "");

  for (const [input, expected] of [
    ["+1250.19", "+1250.19"],
    ["-250", "-250.00"],
    ["0", "+0.00"],
    ["12.5", "+12.50"],
    ["", ""],
    ["1e3", ""],
    ["$12", ""],
  ] as const)
    assert.equal(signedAmountValue(input), expected, input);
});

test("later change orders roll up every earlier final price and submitted amount", async () => {
  const baseline = "-20.05";
  const first = createRequest();
  first.createdAt = "2026-01-01T00:00:00.000Z";
  first.job.jobNumber = "F-26-1";
  first.job.previousChanges = baseline;
  first.job.orderNumber = "CO-01";
  first.finalChangeOrder = { scope: "First", amount: "+100.00" };
  const second = createRequest();
  second.createdAt = "2026-02-01T00:00:00.000Z";
  second.job.jobNumber = "F-26-1";
  second.job.previousChanges = "79.95";
  second.job.orderNumber = "CO-02";
  second.knownChangeAmount = "+50.00";

  const summary = priorChangeSummary([first, second], baseline);
  assert.equal(summary.previousChanges, "129.95");
  assert.equal(summary.nextOrderNumber, "CO-03");
  assert.equal(summary.pricedCount, 2);

  // The estimator's saved price wins over the PM's submitted amount.
  first.finalChangeOrder = { scope: "First", amount: "-25.00" };
  assert.equal(priorChangeSummary([first], baseline).previousChanges, "-45.05");

  // Invalid earlier prices are skipped rather than zeroed.
  first.finalChangeOrder = { scope: "First", amount: "1e3" };
  delete first.knownChangeAmount;
  assert.equal(
    priorChangeSummary([first], baseline).previousChanges,
    "-20.05",
  );

  const loaded = await priorChangesForJob(
    [
      { id: first.id, job: first.job },
      { id: second.id, job: second.job },
      { id: "other-job", job: { ...second.job, jobNumber: "F-26-2" } },
    ],
    " f-26-1 ",
    async (id) => {
      if (id === first.id) return first;
      if (id === second.id) return second;
      throw new Error("not found");
    },
  );
  assert.equal(loaded!.previousChanges, "29.95");
  assert.equal(loaded!.nextOrderNumber, "CO-03");
});

test("preparation preserves estimator corrections and does not invent a price", () => {
  const request = createRequest();
  request.requestedChanges = [
    { ...createRequestedChange(), description: "Submitted scope" },
  ];
  request.job.branchContact = "Branch Manager";
  request.finalChangeOrder = {
    scope: "Estimator revised scope",
    amount: "0.00",
  };
  const draft = customerDocumentDraft(request);
  assert.deepEqual(draft.finalChangeOrder, request.finalChangeOrder);
  assert.equal(draft.job.branchContact, "Branch Manager");
  request.finalChangeOrder = { scope: "Estimator revised scope", amount: "" };
  assert.deepEqual(customerDocumentDraft(request).finalChangeOrder, {
    scope: "Estimator revised scope",
    amount: "",
  });
});

test("signed changes preserve exact cents, credits, and explicit zero", () => {
  const request = createRequest();
  request.job.originalContract = "1000.01";
  request.job.previousChanges = "20.09";
  request.finalChangeOrder = { scope: "Replace insulation", amount: "+30.10" };
  assert.equal(finalContractTotal(request), "$1,050.20");
  request.finalChangeOrder.amount = "-250.20";
  assert.equal(finalContractTotal(request), "$769.90");
  request.finalChangeOrder.amount = "0";
  assert.equal(finalContractTotal(request), "$1,020.10");
  request.finalChangeOrder.amount = "";
  assert.equal(finalContractTotal(request), "Unavailable");
  for (const value of ["+-12", "--12", "+1.234", "1e3", "$12", "1,000"])
    assert.equal(signedMoneyCents(value), null, value);
});

test("signed line references validate and copy without approving the price", () => {
  const request = createRequest();
  request.lineNumbers = "+12, -34\n+56";
  assert.equal(pricingInputError(request), "");
  const note = formatDashNote(request);
  assert.ok(note.includes("Estimate line numbers: +12, -34\n+56"));
  assert.equal(finalContractTotal(request), "Unavailable");
  for (const value of ["12", "-0", "+1.5", "++12", "+12,"])
    assert.ok(pricingInputError({ lineNumbers: value }), value);
});

test("customer documents require saved scope, explicit final price and valid contract details", () => {
  const request = createRequest();
  assert.ok(finalDocumentError(request));
  Object.assign(request.job, {
    customer: "Customer",
    address: "123 Street",
    jobNumber: "F-1",
    originalContract: "100.01",
    previousChanges: "",
    addedDays: "0",
  });
  request.finalChangeOrder = { scope: "Agreed scope", amount: "0.00" };
  assert.equal(finalDocumentError(request), "");
  request.job.date = "2026-02-30";
  assert.match(finalDocumentError(request), /valid change-order date/);
  request.job.date = "2026-10-11";
  request.job.addedDays = "2.5";
  assert.match(finalDocumentError(request), /whole number/);
});
