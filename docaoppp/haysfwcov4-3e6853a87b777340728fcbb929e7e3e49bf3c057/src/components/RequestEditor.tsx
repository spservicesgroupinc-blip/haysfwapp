import { useEffect, useRef, useState } from "react";
import {
  newId,
  type ChangeRequest,
  type JobDetails,
  type RequestAttachment,
} from "../types";
import { createRequestedChange } from "../services/requests";
import {
  ApiError,
  blobToBase64,
  saveRequest,
  uploadAttachment,
  type AttachmentUpload,
} from "../services/storage";
import {
  looksLikePhotoFile,
  preparePhotoForUpload,
} from "../services/photoUpload";
import { moneyCents } from "../services/contract";
import { invalidateCustomerDocument } from "../services/customerDocument";
import {
  pricingInputError,
  finalContractTotal,
  customerDocumentDraft,
} from "../services/changeOrder";
import "./RequestEditor.css";
import RequestQuestions from "./RequestQuestions";
import { SignedAmountInput, LineChangesInput } from "./SignedInputs";

type PendingFile = {
  id: string;
  mutationId: string;
  file: File;
  kind: "photo" | "document";
};
const JOB_FIELDS = [
  ["customer", "Customer name"],
  ["customerPhone", "Customer phone"],
  ["customerEmail", "Customer email"],
  ["address", "Property address"],
  ["jobNumber", "Job number"],
  ["projectManager", "Project manager"],
  ["originalContract", "Original contract amount"],
  ["previousChanges", "Previous authorized changes"],
] as const;
const DOCUMENT_FIELDS = [
  ["orderNumber", "Change-order number"],
  ["date", "Change-order date"],
  ["addedDays", "Added days"],
  ["carrier", "Insurance carrier"],
  ["claim", "Claim number"],
  ["branchName", "Branch name"],
  ["branchAddress", "Branch address"],
  ["branchPhone", "Branch phone"],
  ["branchContact", "Contractor representative"],
] as const;

export default function RequestEditor({
  request,
  onSaved,
  onCancel,
  onReload,
  onBusy,
  onLeaveGuard,
  documentMode = false,
}: {
  request: ChangeRequest;
  onSaved: (request: ChangeRequest) => void;
  onCancel: () => void;
  onReload: () => Promise<ChangeRequest>;
  onBusy: (message: string) => void;
  onLeaveGuard: (guard: (() => boolean) | null) => void;
  documentMode?: boolean;
}) {
  const [initialDraft] = useState(() =>
    structuredClone(documentMode ? customerDocumentDraft(request) : request),
  );
  const [draft, setDraft] = useState(initialDraft);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [retrySave, setRetrySave] = useState(false);
  const saving = useRef(false);
  const pendingSave = useRef<{
    request: ChangeRequest;
    mutationId: string;
  } | null>(null);
  const uploads = useRef(
    new Map<
      string,
      { body: AttachmentUpload; attachment?: RequestAttachment }
    >(),
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const dirty =
    files.length > 0 || JSON.stringify(draft) !== JSON.stringify(initialDraft);
  const leave = () =>
    !saving.current &&
    (!dirty || window.confirm("Discard unsaved changes to this request?"));

  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    onLeaveGuard(leave);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty || saving.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      onLeaveGuard(null);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [dirty, draft, files, onLeaveGuard]);

  function updateJob(key: keyof JobDetails, value: string) {
    setDraft((previous) => {
      const next = { ...previous, job: { ...previous.job, [key]: value } };
      if (key === "jobNumber" && value !== request.job.jobNumber)
        delete next.jobDirectoryId;
      return next;
    });
  }

  function addFiles(selected: FileList | null) {
    if (!selected) return;
    const added: PendingFile[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(selected)) {
      const photo = looksLikePhotoFile(file);
      const pdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      if (
        !file.size ||
        (!photo && !pdf) ||
        (!photo && file.size > 15 * 1024 * 1024)
      )
        rejected.push(file.name);
      else
        added.push({
          id: newId(),
          mutationId: newId(),
          file,
          kind: photo ? "photo" : "document",
        });
    }
    setError(
      rejected.length
        ? `Choose a supported photo or PDF (PDFs up to 15 MB). Not added: ${rejected.join(", ")}`
        : "",
    );
    setFiles((previous) => [...previous, ...added]);
  }

  function report(message: string) {
    setProgress(message);
    onBusy(message);
  }

  async function save() {
    if (saving.current || conflict) return;
    const pricingError = pricingInputError(draft);
    if (pricingError) {
      setError(pricingError);
      return;
    }
    for (const key of ["originalContract", "previousChanges"] as const) {
      if (draft.job[key].trim() && moneyCents(draft.job[key]) === null) {
        setError(
          `Enter ${key === "originalContract" ? "the original contract amount" : "previous authorized changes"} as dollars with at most two decimal places (for example, 1250.19).`,
        );
        return;
      }
    }
    saving.current = true;
    setError("");
    try {
      if (!pendingSave.current) {
        const attachments = [...draft.attachments];
        for (const [index, entry] of files.entries()) {
          report(
            `Uploading ${entry.file.name} (${index + 1} of ${files.length})…`,
          );
          let cached = uploads.current.get(entry.id);
          if (!cached) {
            const prepared =
              entry.kind === "photo"
                ? await preparePhotoForUpload(entry.file, entry.file.name)
                : {
                    blob: entry.file,
                    name: entry.file.name,
                    mimeType: "application/pdf",
                    size: entry.file.size,
                  };
            cached = {
              body: {
                name: prepared.name,
                kind: entry.kind,
                mimeType: prepared.mimeType,
                size: prepared.size,
                data: await blobToBase64(prepared.blob),
              },
            };
            uploads.current.set(entry.id, cached);
          }
          cached.attachment ??= await uploadAttachment(
            request.id,
            cached.body,
            entry.id,
            entry.mutationId,
          );
          attachments.push(cached.attachment);
        }
        pendingSave.current = {
          request: await invalidateCustomerDocument({ ...draft, attachments }),
          mutationId: newId(),
        };
      }
      report("Saving changes…");
      const pending = pendingSave.current;
      const saved = await saveRequest(
        pending.request,
        request.revision,
        pending.mutationId,
      );
      onLeaveGuard(null);
      onSaved(saved);
    } catch (problem) {
      const code = problem instanceof ApiError ? problem.code : "";
      if (code === "CONFLICT" || code === "STATE") {
        setConflict(true);
        pendingSave.current = null;
      } else if (code === "VALIDATION") pendingSave.current = null;
      setRetrySave(Boolean(pendingSave.current));
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      saving.current = false;
      report("");
    }
  }

  async function reload() {
    if (!leave()) return;
    saving.current = true;
    report("Loading latest request…");
    try {
      const latest = await onReload();
      onLeaveGuard(null);
      onSaved(latest);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      saving.current = false;
      report("");
    }
  }

  return (
    <form
      className="request-editor review-card"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h2 ref={heading} tabIndex={-1}>
        {documentMode ? "Finalize customer document" : "Edit request"}
      </h2>
      <p>
        {documentMode
          ? "Review the customer scope and final price, then save to generate the customer PDF."
          : "Correct the request’s details, submitted text, and attachments without changing its status or assigned estimator."}
      </p>
      {error ? (
        <div className="editor-error" role="alert">
          {error}
          {conflict ? (
            <p>
              Your draft is retained. Reload the latest request to review newer
              changes before editing again.
            </p>
          ) : retrySave ? (
            <p>
              Retry this save before making more edits; its outcome has not been
              confirmed.
            </p>
          ) : null}
        </div>
      ) : null}
      <fieldset
        disabled={Boolean(progress) || retrySave}
        className="editor-fields"
      >
        {!documentMode ? (
          <RequestQuestions
            requestType={draft.requestType}
            customerCredits={draft.customerCredits}
            onChange={(answers) =>
              setDraft((previous) => ({ ...previous, ...answers }))
            }
          />
        ) : null}
        <div className="editor-job-grid">
          {JOB_FIELDS.map(([key, label]) => (
            <label className="field" key={key}>
              <span>{label}</span>
              <input
                aria-label={label}
                value={String(draft.job[key] ?? "")}
                inputMode={
                  key === "originalContract" || key === "previousChanges"
                    ? "decimal"
                    : key === "customerPhone"
                      ? "tel"
                      : key === "customerEmail"
                        ? "email"
                        : "text"
                }
                onChange={(event) => updateJob(key, event.target.value)}
              />
            </label>
          ))}
        </div>
        {documentMode ? (
          <details className="editor-document" open>
            <summary>Customer change order</summary>
          <p>
            Review the customer scope and final price, then save before
            previewing or downloading the document.
          </p>
          <div className="editor-job-grid">
            {DOCUMENT_FIELDS.map(([key, label]) => (
              <label className="field" key={key}>
                <span>{label}</span>
                <input
                  aria-label={label}
                  type={key === "date" ? "date" : "text"}
                  value={draft.job[key] ?? ""}
                  onChange={(event) => updateJob(key, event.target.value)}
                />
              </label>
            ))}
          </div>
          <LineChangesInput
            value={draft.lineNumbers ?? ""}
            onChange={(value) =>
              setDraft((previous) => ({ ...previous, lineNumbers: value }))
            }
          />
          <label className="request-checkbox">
            <input
              type="checkbox"
              checked={draft.job.insuranceRelated}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  job: {
                    ...previous.job,
                    insuranceRelated: event.target.checked,
                  },
                }))
              }
            />
            <span>Insurance-related work</span>
          </label>
          <label className="field">
            <span>Final customer scope</span>
            <textarea
              aria-label="Final customer scope"
              rows={6}
              value={draft.finalChangeOrder?.scope ?? ""}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  finalChangeOrder: {
                    amount: previous.finalChangeOrder?.amount ?? "",
                    scope: event.target.value,
                  },
                }))
              }
            />
          </label>
          <SignedAmountInput
            label="Final change amount"
            value={draft.finalChangeOrder?.amount ?? ""}
            onChange={(value) =>
              setDraft((previous) => ({
                ...previous,
                finalChangeOrder: {
                  scope: previous.finalChangeOrder?.scope ?? "",
                  amount: value,
                },
              }))
            }
            hint="Enter 0.00 for no price change."
          />
          <p>
            <strong>New contract total: {finalContractTotal(draft)}</strong>
          </p>
          </details>
        ) : null}
        {!documentMode ? (
          <>
            <h3>Submitted text</h3>
            {draft.requestedChanges.map((change, index) => (
              <div className="editor-note" key={change.id}>
                <strong>
                  Change {index + 1}
                  {change.room ? ` · ${change.room}` : ""}
                </strong>
                {(["description", "reason"] as const).map((key) => (
                  <label className="field" key={key}>
                    <span>
                      {key === "description" ? "Description" : "Reason"}{" "}
                      {index + 1}
                    </span>
                    <textarea
                      aria-label={`${key === "description" ? "Description" : "Reason"} ${index + 1}`}
                      value={change[key]}
                      rows={key === "description" ? 4 : 2}
                      onChange={(event) =>
                        setDraft((previous) => ({
                          ...previous,
                          requestedChanges: previous.requestedChanges.map(
                            (item) =>
                              item.id === change.id
                                ? { ...item, [key]: event.target.value }
                                : item,
                          ),
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            ))}
            <button
              type="button"
              className="button"
              onClick={() =>
                setDraft((previous) => ({
                  ...previous,
                  requestedChanges: [
                    ...previous.requestedChanges,
                    createRequestedChange(),
                  ],
                }))
              }
            >
              Add note
            </button>
          </>
        ) : (
          <details className="editor-source">
            <summary>View submitted text</summary>
            {request.requestedChanges.map((change, index) => (
              <article key={change.id}>
                <strong>
                  Change {index + 1}
                  {change.room ? ` · ${change.room}` : ""}
                </strong>
                <p style={{ whiteSpace: "pre-wrap" }}>
                  {change.description || "No description provided."}
                </p>
                {change.reason && (
                  <p style={{ whiteSpace: "pre-wrap" }}>
                    Reason: {change.reason}
                  </p>
                )}
              </article>
            ))}
          </details>
        )}
        {!documentMode ? (
          <>
            <h3>Photos &amp; files</h3>
            <ul className="editor-files">
              {draft.attachments.filter((file) => file.id !== draft.customerDocument?.attachmentId).map((file) => (
                <li key={file.id}>
                  <span>{file.name}</span>
                  <button
                    type="button"
                    className="button small"
                    aria-label={`Remove ${file.name}`}
                    onClick={() =>
                      setDraft((previous) => ({
                        ...previous,
                        attachments: previous.attachments.filter(
                          (item) => item.id !== file.id,
                        ),
                      }))
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
              {files.map((entry) => (
                <li key={entry.id}>
                  <span>
                    {entry.file.name} <small>(new)</small>
                  </span>
                  <button
                    type="button"
                    className="button small"
                    aria-label={`Remove new ${entry.file.name}`}
                    onClick={() =>
                      setFiles((previous) =>
                        previous.filter((item) => item.id !== entry.id),
                      )
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <label className="field">
              <span>Add photos or PDFs</span>
              <input
                type="file"
                aria-label="Add photos or PDFs"
                multiple
                accept="image/*,.heic,.heif,application/pdf,.pdf"
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
          </>
        ) : null}
      </fieldset>
      <div className="button-row">
        <button
          className="button primary"
          type="submit"
          disabled={Boolean(progress) || conflict}
        >
          {retrySave ? "Retry save" : "Save changes"}
        </button>
        <button
          className="button"
          type="button"
          disabled={Boolean(progress)}
          onClick={() => {
            if (leave()) {
              onLeaveGuard(null);
              onCancel();
            }
          }}
        >
          Cancel
        </button>
        {conflict ? (
          <button
            className="button"
            type="button"
            disabled={Boolean(progress)}
            onClick={() => void reload()}
          >
            Reload latest request
          </button>
        ) : null}
      </div>
    </form>
  );
}
