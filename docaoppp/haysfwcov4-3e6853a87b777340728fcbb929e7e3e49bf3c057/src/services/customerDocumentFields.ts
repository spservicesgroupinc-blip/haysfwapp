import type { ChangeRequest, JobDetails } from "../types";

export type DocumentFieldKey =
  | `job.${keyof JobDetails}`
  | "finalChangeOrder.scope"
  | "finalChangeOrder.amount";
export interface DocumentField {
  key: DocumentFieldKey;
  label: string;
  kind: "text" | "date" | "money" | "amount" | "multiline" | "days" | "boolean";
}
export const CUSTOMER_DOCUMENT_FIELDS: DocumentField[] = [
  { key: "job.customer", label: "Customer name", kind: "text" },
  { key: "job.address", label: "Property address", kind: "text" },
  { key: "job.jobNumber", label: "Job number", kind: "text" },
  { key: "job.orderNumber", label: "Change-order number", kind: "text" },
  { key: "job.date", label: "Change-order date", kind: "date" },
  {
    key: "job.originalContract",
    label: "Original contract amount",
    kind: "money",
  },
  {
    key: "job.previousChanges",
    label: "Previous authorized changes",
    kind: "money",
  },
  {
    key: "finalChangeOrder.amount",
    label: "Final change amount",
    kind: "amount",
  },
  {
    key: "finalChangeOrder.scope",
    label: "Final customer scope",
    kind: "multiline",
  },
  { key: "job.addedDays", label: "Added days", kind: "days" },
  {
    key: "job.insuranceRelated",
    label: "Insurance-related work",
    kind: "boolean",
  },
  { key: "job.carrier", label: "Insurance carrier", kind: "text" },
  { key: "job.claim", label: "Claim number", kind: "text" },
  { key: "job.branchName", label: "Branch name", kind: "text" },
  { key: "job.branchAddress", label: "Branch address", kind: "text" },
  { key: "job.branchPhone", label: "Branch phone", kind: "text" },
  {
    key: "job.branchContact",
    label: "Contractor representative",
    kind: "text",
  },
];

export function documentFieldValue(
  request: ChangeRequest,
  key: DocumentFieldKey,
): string | boolean {
  if (key === "finalChangeOrder.scope")
    return request.finalChangeOrder?.scope ?? "";
  if (key === "finalChangeOrder.amount")
    return request.finalChangeOrder?.amount ?? "";
  return request.job[key.slice(4) as keyof JobDetails] ?? "";
}

export function updateDocumentField(
  request: ChangeRequest,
  key: DocumentFieldKey,
  value: string | boolean,
): ChangeRequest {
  if (key === "finalChangeOrder.scope" || key === "finalChangeOrder.amount") {
    return {
      ...request,
      finalChangeOrder: {
        scope: request.finalChangeOrder?.scope ?? "",
        amount: request.finalChangeOrder?.amount ?? "",
        [key.split(".")[1]]: String(value),
      },
    };
  }
  const job = { ...request.job, [key.slice(4)]: value };
  const next = { ...request, job };
  if (key === "job.jobNumber" && value !== request.job.jobNumber)
    delete next.jobDirectoryId;
  return next;
}
