import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { X, List, Download } from "lucide-react";
import type { ChangeRequest } from "../types";
import { ApiError, fetchAttachment } from "../services/storage";
import {
  customerDocumentDraft,
  finalDocumentError,
  finalContractTotal,
  pricingInputError,
} from "../services/changeOrder";
import { contractAmounts, moneyCents } from "../services/contract";
import { customerDocumentFingerprint } from "../services/customerDocument";
import {
  CUSTOMER_DOCUMENT_FIELDS,
  updateDocumentField,
  type DocumentFieldKey,
} from "../services/customerDocumentFields";
import {
  generateCustomerDocument,
  type DocumentFieldSpan,
} from "../services/customerDocumentPdf";
import { loadCustomerDocumentFonts } from "../services/customerDocumentFont";
import { createCustomerDocumentSave } from "../services/customerDocumentSave";
import { downloadBlob } from "../services/download";
import DocumentFieldInput from "./DocumentFieldInput";
import EditablePdfPreview from "./EditablePdfPreview";
import "./CustomerDocument.css";

export default function CustomerDocumentEditor({
  request,
  onSaved,
  onReload,
  onClose,
  onLeaveGuard,
}: {
  request: ChangeRequest;
  onSaved: (request: ChangeRequest) => void;
  onReload: () => Promise<ChangeRequest>;
  onClose: () => void;
  onLeaveGuard: (guard: (() => boolean) | null) => void;
}) {
  const [base, setBase] = useState(() => structuredClone(request));
  const [draft, setDraft] = useState(() =>
    structuredClone(customerDocumentDraft(request)),
  );
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(customerDocumentDraft(request)),
  );
  const [showFields, setShowFields] = useState(true);
  const [preview, setPreview] = useState<{
    bytes: Uint8Array;
    spans: DocumentFieldSpan[];
  } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewRetry, setPreviewRetry] = useState(0);
  const [refreshing, setRefreshing] = useState(true);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [conflict, setConflict] = useState(false);
  const [retry, setRetry] = useState(false);
  const pending = useRef<(() => Promise<ChangeRequest>) | null>(null);
  const saving = useRef(false);
  const modal = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(draft) !== baseline;
  const leave = () =>
    !saving.current &&
    ((!dirty && !pending.current) ||
      window.confirm("Discard unsaved changes to this change order?"));
  const close = () => {
    if (leave()) onClose();
  };
  const locked = Boolean(progress) || retry || conflict;
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      prior?.focus();
    };
  }, []);
  useEffect(() => {
    onLeaveGuard(leave);
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty || saving.current || pending.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      onLeaveGuard(null);
      window.removeEventListener("beforeunload", unload);
    };
  }, [dirty, draft, onLeaveGuard]);
  useEffect(() => {
    let cancelled = false;
    setRefreshing(true);
    setPreviewError("");
    const timer = window.setTimeout(async () => {
      try {
        const [font, bold] = await loadCustomerDocumentFonts();
        const result = await generateCustomerDocument(
          draft,
          font,
          "draft",
          bold,
        );
        if (!cancelled) setPreview(result);
      } catch (problem) {
        if (!cancelled)
          setPreviewError(
            problem instanceof Error ? problem.message : String(problem),
          );
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [draft, previewRetry]);
  function update(key: DocumentFieldKey, value: string | boolean) {
    setDraft((previous) => updateDocumentField(previous, key, value));
    setSuccess("");
    setError("");
  }
  async function save(generate: boolean) {
    if (saving.current || conflict) return;
    saving.current = true;
    setError("");
    setSuccess("");
    try {
      if (!pending.current) {
        const validation = generate
          ? finalDocumentError(draft)
          : pricingInputError(draft);
        if (validation) throw new Error(validation);
        for (const key of ["originalContract", "previousChanges"] as const)
          if (draft.job[key].trim() && moneyCents(draft.job[key]) === null)
            throw new Error(
              `Enter a valid ${key === "originalContract" ? "original contract amount" : "previous authorized changes amount"}.`,
            );
        let generated: { bytes: Uint8Array; fingerprint: string } | undefined;
        if (generate) {
          setProgress("Generating customer PDF…");
          const [font, bold] = await loadCustomerDocumentFonts();
          const result = await generateCustomerDocument(
            draft,
            font,
            "final",
            bold,
          );
          generated = {
            bytes: result.bytes,
            fingerprint: await customerDocumentFingerprint(draft),
          };
        }
        pending.current = createCustomerDocumentSave(
          draft,
          base.revision,
          generated,
        );
      }
      setProgress("Saving change order…");
      const saved = await pending.current();
      pending.current = null;
      setRetry(false);
      setBase(structuredClone(saved));
      setDraft(structuredClone(saved));
      setBaseline(JSON.stringify(saved));
      onSaved(saved);
      setSuccess(
        saved.customerDocument
          ? "Change order and customer PDF saved."
          : "Change order changes saved. Generate the PDF when ready.",
      );
    } catch (problem) {
      const code = problem instanceof ApiError ? problem.code : "";
      if (["CONFLICT", "STATE"].includes(code)) {
        setConflict(true);
        pending.current = null;
      }
      if (code === "VALIDATION") pending.current = null;
      setRetry(Boolean(pending.current));
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      saving.current = false;
      setProgress("");
    }
  }
  async function reload() {
    if (!leave()) return;
    saving.current = true;
    setProgress("Loading latest request…");
    try {
      const latest = await onReload();
      if (latest.status === "completed") {
        onSaved(latest);
        onClose();
        return;
      }
      pending.current = null;
      setRetry(false);
      setConflict(false);
      setBase(structuredClone(latest));
      setDraft(structuredClone(customerDocumentDraft(latest)));
      setBaseline(JSON.stringify(customerDocumentDraft(latest)));
      onSaved(latest);
      setError("");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      saving.current = false;
      setProgress("");
    }
  }
  async function download() {
    if (!base.customerDocument || dirty || saving.current) return;
    saving.current = true;
    setProgress("Downloading saved PDF…");
    setError("");
    try {
      const result = await fetchAttachment(
        base.id,
        base.customerDocument.attachmentId,
      );
      downloadBlob(result.blob, result.name);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      saving.current = false;
      setProgress("");
    }
  }
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
    if (event.key !== "Tab") return;
    const items = Array.from(
      modal.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
      ) ?? [],
    ).filter((item) => item.offsetParent !== null);
    const first = items[0],
      last = items.at(-1);
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === modal.current)
    ) {
      event.preventDefault();
      last?.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last ||
        document.activeElement === modal.current)
    ) {
      event.preventDefault();
      first?.focus();
    }
  }
  const totals = contractAmounts(draft.job);
  return (
    <div
      className="customer-document-editor"
      ref={modal}
      role="dialog"
      aria-modal="true"
      aria-label="Customer change order"
      tabIndex={-1}
      onKeyDown={keys}
    >
      <header className="customer-document-header">
        <div>
          <h2>Customer change order</h2>
          <p>
            {draft.job.customer || "Customer details"} ·{" "}
            {draft.job.jobNumber || "Job number"}
          </p>
        </div>
        <div className="button-row">
          <button
            className="button"
            aria-expanded={showFields}
            aria-controls="customer-document-fields"
            onClick={() => setShowFields(!showFields)}
          >
            <List size={16} /> Fields
          </button>
          <button
            className="icon-button"
            aria-label="Close change order"
            disabled={Boolean(progress)}
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
      </header>
      <div
        className={`customer-document-body${showFields ? " with-fields" : ""}`}
      >
        <section
          className="customer-document-preview"
          aria-label="Editable PDF preview"
        >
          <p className="document-caption">
            Draft preview · Click a field to edit. Save the finished PDF before
            sending it for signature.
          </p>
          {refreshing ? (
            <p role="status" className="document-caption">
              Updating preview…
            </p>
          ) : null}
          {previewError ? (
            <div className="notice danger" role="alert">
              {previewError}
              <button
                className="button small"
                onClick={() => setPreviewRetry(previewRetry + 1)}
              >
                Retry preview
              </button>
            </div>
          ) : null}
          {preview ? (
            <EditablePdfPreview
              bytes={preview.bytes}
              spans={preview.spans}
              disabled={locked || Boolean(previewError)}
              renderField={(key) => {
                const field = CUSTOMER_DOCUMENT_FIELDS.find(
                  (item) => item.key === key,
                )!;
                return (
                  <DocumentFieldInput
                    field={field}
                    draft={draft}
                    autoFocus
                    onChange={(value) => update(key, value)}
                  />
                );
              }}
            />
          ) : null}
        </section>
        {showFields ? (
          <aside
            id="customer-document-fields"
            className="customer-document-fields"
            aria-label="Change order fields"
          >
            <h3>Form fields</h3>
            <fieldset disabled={locked}>
              {CUSTOMER_DOCUMENT_FIELDS.map((field) => (
                <DocumentFieldInput
                  key={field.key}
                  field={field}
                  draft={draft}
                  onChange={(value) => update(field.key, value)}
                />
              ))}
            </fieldset>
          </aside>
        ) : null}
      </div>
      <footer className="customer-document-footer">
        <div className="customer-document-totals">
          <span>Prior contract total: {totals.total}</span>
          <strong>New contract total: {finalContractTotal(draft)}</strong>
        </div>
        {error ? (
          <div className="notice danger" role="alert">
            {error}
          </div>
        ) : null}
        {success ? (
          <p role="status" className="document-success">
            {success}
          </p>
        ) : null}
        {progress ? <p role="status">{progress}</p> : null}
        <div className="button-row">
          {retry ? (
            <button
              className="button primary"
              disabled={Boolean(progress)}
              onClick={() => void save(false)}
            >
              Retry save
            </button>
          ) : (
            <>
              <button
                className="button"
                disabled={locked}
                onClick={() => void save(false)}
              >
                Save changes
              </button>
              <button
                className="button primary"
                disabled={locked}
                onClick={() => void save(true)}
              >
                Generate &amp; save PDF
              </button>
            </>
          )}
          <button
            className="button"
            disabled={locked || dirty || !base.customerDocument}
            onClick={() => void download()}
          >
            <Download size={16} /> Download saved PDF
          </button>
          {conflict ? (
            <button
              className="button"
              disabled={Boolean(progress)}
              onClick={() => void reload()}
            >
              Reload latest request
            </button>
          ) : null}
          <button
            className="text-button"
            disabled={Boolean(progress)}
            onClick={close}
          >
            Cancel
          </button>
        </div>
      </footer>
    </div>
  );
}
