import type { ChangeRequest } from "../types";
import { contractAmounts } from "./contract";
import { signedAmountLabel, finalContractTotal } from "./changeOrder";

export function requestTypeLabel(type: ChangeRequest["requestType"]): string {
  return type === "change_order"
    ? "Change order"
    : type === "insurance_supplement"
      ? "Insurance supplement"
      : "Not provided";
}

export function customerCreditsLabel(
  value: ChangeRequest["customerCredits"],
): string {
  return value === undefined ? "Not provided" : value ? "Yes" : "No";
}

/** Plain text for Dash; shared by the unsent form and estimator's saved request. */
export function formatDashNote(
  request: ChangeRequest,
  attachmentNames = request.attachments.map((file) => file.name),
): string {
  const lines = [
    "CHANGE REQUEST",
    `Request type: ${requestTypeLabel(request.requestType)}`,
    `Customer credits: ${customerCreditsLabel(request.customerCredits)}`,
    "",
    "CUSTOMER / JOB",
  ];
  const field = (label: string, value: string | undefined) =>
    lines.push(`${label}: ${value?.trim() ? value : "Not provided"}`);
  const job = request.job;
  if (request.knownChangeAmount)
    field("Known change amount", signedAmountLabel(request.knownChangeAmount));
  field("Customer", job.customer);
  field("Customer phone", job.customerPhone);
  field("Customer email", job.customerEmail);
  field("Job number", job.jobNumber);
  field("Property address", job.address);
  field("Project manager", job.projectManager);
  for (const [label, value] of [
    ["Change-order number", job.orderNumber],
    ["Insurance carrier", job.carrier],
    ["Claim number", job.claim],
  ]) {
    if (value?.trim()) field(label, value);
  }
  const amounts = contractAmounts(job);
  field("Original contract", amounts.original);
  field("Previous authorized changes", amounts.previous);
  field("Total contract price", amounts.total);
  field("Estimate line numbers", request.lineNumbers);
  for (const [label, value] of [
    ["Change-order date", job.date],
    ["Added days", job.addedDays],
    ["Branch name", job.branchName],
    ["Branch address", job.branchAddress],
    ["Branch phone", job.branchPhone],
    ["Contractor representative", job.branchContact],
  ])
    if (value?.trim()) field(label!, value);
  if (typeof job.insuranceRelated === "boolean")
    field("Insurance-related work", job.insuranceRelated ? "Yes" : "No");
  lines.push("", "SUBMITTED TEXT");
  if (!request.requestedChanges.length)
    lines.push("No written description provided.");
  request.requestedChanges.forEach((change, index) => {
    if (index) lines.push("");
    lines.push(
      `Change ${index + 1}${change.room ? ` - ${change.room}` : ""} (${change.action})`,
    );
    lines.push(change.description || "No description provided.");
    for (const [label, value] of [
      ["Reason", change.reason],
      ["Measurements", change.measurements],
      ["Materials", change.materials],
      ["Schedule impact", change.scheduleImpact],
    ]) {
      if (value?.trim()) field(label, value);
    }
  });
  if (request.informationQuestion?.trim()) {
    lines.push("", "INFORMATION REQUEST", request.informationQuestion);
  }
  if (request.finalChangeOrder) {
    lines.push("", "CUSTOMER CHANGE ORDER");
    field("Final customer scope", request.finalChangeOrder.scope);
    field(
      "Final change amount",
      signedAmountLabel(request.finalChangeOrder.amount),
    );
    field("New contract total", finalContractTotal(request));
  }
  lines.push("", "ATTACHMENTS");
  lines.push(
    ...(attachmentNames.length ? attachmentNames : ["No attachments."]),
  );
  return lines.join("\n");
}
