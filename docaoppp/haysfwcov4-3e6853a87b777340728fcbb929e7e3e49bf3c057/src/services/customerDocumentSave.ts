import { newId, type ChangeRequest, type RequestAttachment } from "../types";
import { saveRequest, uploadAttachment } from "./storage";
import {
  CUSTOMER_DOCUMENT_VERSION,
  customerDocumentFingerprint,
  customerDocumentFilename,
  invalidateCustomerDocument,
} from "./customerDocument";

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}

/** Frozen save transaction: retries reuse bytes, attachment IDs and mutation IDs. */
export function createCustomerDocumentSave(
  draft: ChangeRequest,
  expectedRevision: number,
  generated?: { bytes: Uint8Array; fingerprint: string },
): () => Promise<ChangeRequest> {
  const frozen = structuredClone(draft);
  // PDF.js may transfer buffers; keep an independent copy for every retry.
  const document = generated
    ? { ...generated, bytes: generated.bytes.slice() }
    : undefined;
  const saveId = newId(),
    attachmentId = newId(),
    uploadId = newId();
  let uploaded: RequestAttachment | undefined;
  let payload: ChangeRequest | undefined;
  return async () => {
    if (!payload) {
      let next = await invalidateCustomerDocument(frozen);
      if (document) {
        if (document.bytes.length > 15 * 1024 * 1024)
          throw new Error("The generated PDF exceeds the 15 MB upload limit.");
        if (document.fingerprint !== (await customerDocumentFingerprint(next)))
          throw new Error(
            "The PDF no longer matches the draft. Generate it again.",
          );
        if (
          !next.customerDocument ||
          next.customerDocument.templateVersion !== CUSTOMER_DOCUMENT_VERSION
        ) {
          uploaded ??= await uploadAttachment(
            frozen.id,
            {
              name: customerDocumentFilename(frozen),
              mimeType: "application/pdf",
              size: document.bytes.length,
              kind: "document",
              data: base64(document.bytes),
            },
            attachmentId,
            uploadId,
          );
          next = {
            ...next,
            attachments: [
              ...next.attachments.filter(
                (file) => file.id !== frozen.customerDocument?.attachmentId,
              ),
              uploaded,
            ],
            customerDocument: {
              attachmentId: uploaded.id,
              inputFingerprint: document.fingerprint,
              templateVersion: CUSTOMER_DOCUMENT_VERSION,
            },
          };
        }
      }
      payload = next;
    }
    return saveRequest(payload, expectedRevision, saveId);
  };
}
