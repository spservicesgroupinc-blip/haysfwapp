import { newId, type ChangeRequest } from "../types";
import { API_URL, blobToBase64, saveRequest, sendRequestEmail, uploadAttachment } from "./storage";
import { preparePhotoForUpload } from "./photoUpload";
import { readDraft, saveDraft, deleteDraft, type RequestDraft } from "./requestDrafts";

export interface SubmissionApi {
  save: typeof saveRequest;
  upload: typeof uploadAttachment;
  email: typeof sendRequestEmail;
}
const defaultApi: SubmissionApi = {save: saveRequest, upload: uploadAttachment, email: sendRequestEmail};

/** Freeze identities and original bytes before returning to the request queue. */
export async function queueDraftSubmission(draft: RequestDraft, request: ChangeRequest) {
  if (draft.submission) throw new Error("This draft already has a pending submission. Resume it from Requests.");
  const row: RequestDraft = {...draft, submission: {
    request, saveMutation: newId(), attachMutation: newId(), email: "idle",
    uploads: [
      ...draft.values.photos.map(photo => ({source: photo, kind: "photo" as const, attachmentId:newId(), mutationId:newId()})),
      ...(draft.values.pdf ? [{source:draft.values.pdf,kind:"document" as const,attachmentId:newId(),mutationId:newId()}] : [])
    ]
  }};
  await saveDraft(row);
}

const running = new Map<string, Promise<string>>();
/** A tab lock prevents overlapping recovery; checkpoints survive response loss. */
export function runDraftSubmission(id: string, scope = API_URL, api = defaultApi): Promise<string> {
  const key = scope + ":" + id;
  const existing = running.get(key);
  if (existing) return existing;
  const execute = async () => {
    const row = await readDraft(id,scope);
    if (!row?.submission) return "Submission already finished. Refresh the request queue to view it.";
    const step = row.submission;
    const persist = () => saveDraft({...row, updatedAt:new Date().toISOString()});
    if (!step.saved) { step.saved = await api.save(step.request,step.request.revision,step.saveMutation); await persist(); }
    for (const file of step.uploads) {
      if (file.uploaded) continue;
      if (!file.prepared) {
        const prepared = file.kind === "photo" ? await preparePhotoForUpload(file.source.blob,file.source.name) : {blob:file.source.blob,name:file.source.name,mimeType:file.source.type || "application/pdf",size:file.source.blob.size};
        file.prepared = {name:prepared.name,mimeType:prepared.mimeType,size:prepared.size,kind:file.kind,data:await blobToBase64(prepared.blob)};
        await persist();
      }
      file.uploaded = await api.upload(step.saved.id,file.prepared,file.attachmentId,file.mutationId);
      await persist();
    }
    if (!step.linked) {
      step.linked = step.uploads.length ? await api.save({...step.saved,attachments:[...step.saved.attachments,...step.uploads.map(file=>file.uploaded!)]},step.saved.revision,step.attachMutation) : step.saved;
      await persist();
    }
    const recipient = row.values.emailAddress.trim();
    if (recipient && step.email === "idle") {
      step.email = "sending";
      await persist(); // A crash from this point means delivery is uncertain.
      try { await api.email(step.linked.id,recipient,undefined,step.linked); step.email = "sent"; }
      catch (error) { step.email = "uncertain"; step.emailError = error instanceof Error ? error.message : "Email delivery could not be confirmed."; }
      await persist();
    } else if (step.email === "sending") { step.email = "uncertain"; await persist(); }
    const label = step.request.job.customer + (step.request.job.jobNumber ? " · job " + step.request.job.jobNumber : "");
    if (step.email === "uncertain") return "Sent to estimating: " + label + ". Email delivery could not be confirmed. Open the request to review before sending again.";
    await deleteDraft(id,scope);
    return "Sent to estimating" + (recipient ? " & emailed to " + recipient : "") + ": " + label + ".";
  };
  const task = (typeof navigator !== "undefined" && navigator.locks ? navigator.locks.request("hays-submit:"+key,execute) : execute()).finally(()=>running.delete(key));
  running.set(key,task);
  return task;
}
