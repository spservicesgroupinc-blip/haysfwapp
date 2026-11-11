import type { ChangeRequest } from "../types";

export const CUSTOMER_DOCUMENT_VERSION = 1;
// Keep this order identical to customerDocumentFingerprint_ in Code.gs.
export const DOCUMENT_JOB_KEYS = [
  "customer",
  "address",
  "jobNumber",
  "branchName",
  "branchAddress",
  "branchPhone",
  "branchContact",
  "carrier",
  "claim",
  "orderNumber",
  "date",
  "insuranceRelated",
  "originalContract",
  "previousChanges",
  "addedDays",
] as const;

export async function customerDocumentFingerprint(
  request: ChangeRequest,
  version = CUSTOMER_DOCUMENT_VERSION,
): Promise<string> {
  const input = JSON.stringify([
    version,
    ...DOCUMENT_JOB_KEYS.map((key) => request.job[key] ?? ""),
    request.finalChangeOrder?.scope ?? "",
    request.finalChangeOrder?.amount ?? "",
  ]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function invalidateCustomerDocument(
  request: ChangeRequest,
): Promise<ChangeRequest> {
  const document = request.customerDocument;
  if (!document) return request;
  if (
    document.inputFingerprint ===
      (await customerDocumentFingerprint(request, document.templateVersion)) &&
    request.attachments.some((file) => file.id === document.attachmentId)
  )
    return request;
  const { customerDocument: _, ...next } = request;
  return {
    ...next,
    attachments: request.attachments.filter(
      (file) => file.id !== document.attachmentId,
    ),
  };
}

export function customerDocumentFilename(request: ChangeRequest): string {
  const safe = (value: string) =>
    value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "")
      .slice(0, 80);
  return `change-order-${safe(request.job.jobNumber) || request.id}-${safe(request.job.orderNumber) || "CO"}.pdf`;
}
