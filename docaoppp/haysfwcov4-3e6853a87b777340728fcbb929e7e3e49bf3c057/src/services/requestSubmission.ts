import { newId, type ChangeRequest, type RequestAttachment } from "../types";
import { saveRequest, sendRequestEmail, uploadAttachment } from "./storage";

type UploadFile = Parameters<typeof uploadAttachment>[1];

/** Each attachment is prepared only after the shell has returned home. */
export interface SubmissionAttachment {
  prepare: () => Promise<UploadFile>;
}

/** Retain confirmed steps and retry identities while the form is unmounted. */
export function createRequestSubmission(
  request: ChangeRequest,
  attachments: SubmissionAttachment[],
  recipient: string,
): () => Promise<string> {
  const saveMutation = newId();
  const attachMutation = newId();
  const uploads = attachments.map((file) => ({
    ...file,
    attachmentId: newId(),
    mutationId: newId(),
    prepared: null as UploadFile | null,
    uploaded: null as RequestAttachment | null,
  }));
  let saved: ChangeRequest | null = null;
  let linked: ChangeRequest | null = null;

  return async () => {
    saved ??= await saveRequest(request, request.revision, saveMutation);
    for (const file of uploads) {
      file.prepared ??= await file.prepare();
      file.uploaded ??= await uploadAttachment(
        saved.id,
        file.prepared,
        file.attachmentId,
        file.mutationId,
      );
    }
    linked ??= uploads.length
      ? await saveRequest(
          { ...saved, attachments: uploads.map((file) => file.uploaded!) },
          saved.revision,
          attachMutation,
        )
      : saved;
    let emailNotice = "";
    if (recipient) {
      try {
        await sendRequestEmail(linked.id, recipient, undefined, linked);
        emailNotice = ` & emailed to ${recipient}`;
      } catch (error) {
        emailNotice = ` (email failed: ${error instanceof Error ? error.message : "could not deliver"})`;
      }
    }
    return `Sent to estimating${emailNotice}: ${request.job.customer}${request.job.jobNumber ? ` · job ${request.job.jobNumber}` : ""}.`;
  };
}
