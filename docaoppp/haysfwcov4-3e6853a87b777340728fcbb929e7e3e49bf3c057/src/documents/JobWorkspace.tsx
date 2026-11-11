import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import JSZip from "jszip";
import {
  Download,
  Eye,
  FileText,
  FolderOpen,
  Plus,
  RefreshCw,
  Save,
} from "lucide-react";
import type { ChangeRequest, JobEntry, RequestSummary } from "../types";
import type { CustomerSummary } from "../crm/types";
import CustomerDetail from "../components/crm/CustomerDetail";
import { customerIdForPick } from "../services/customerDirectory";
import type { Workspace, WorkspaceRow, DocumentRow } from "../workspaces/types";
import {
  requestFromWorkspace,
  recalculateFinancials,
  updateRecordField,
} from "../workspaces/model";
import {
  cachedWorkspace,
  cachedJobDocuments,
  loadWorkspace,
  refreshJobDocuments,
  saveWorkspaceLocally,
  subscribeWorkspaces,
  syncWorkspaces,
  resolveWorkspaceConflict,
  queueJobDocument,
  fetchJobDocument,
  documentFingerprint,
  flushWorkspace,
} from "../services/workspaces";
import { openRequest, fetchAttachment } from "../services/storage";
import { priorChangesFrom } from "../services/changeOrder";
import { customerDocumentFingerprint } from "../services/customerDocument";
import { downloadBlob } from "../services/download";
import { SectionCustomer } from "./components/SectionCustomer";
import { SectionInsurance } from "./components/SectionInsurance";
import { SectionMortgage } from "./components/SectionMortgage";
import { SectionTeam } from "./components/SectionTeam";
import { SectionChecklist } from "./components/SectionChecklist";
import { SectionProductionNotes } from "./components/SectionProductionNotes";
import { FinancialSummaryCard } from "./components/FinancialSummaryCard";
import { IntakeParserCard } from "./components/IntakeParserCard";
import { PdfPreviewModal } from "./components/PdfPreviewModal";
import {
  JOB_DOCUMENTS,
  buildCombinedPacketFileName,
  safeJobNumber,
  type JobDocument as Template,
} from "./services/documentCatalog";
import {
  generateCompletePacket,
  generateDocWithSpans,
  type PdfFieldSpan,
} from "./services/pdfService";
import { getPdfFieldSchema } from "./services/pdfFieldSchema";
import { getMissingJobFields } from "./services/jobReadiness";
import { fillWorkspaceFromDirectory, matchingDirectoryEntry } from "./services/directoryAutofill";
import type { ProvenanceRecord } from "./services/intakeParser";
import type { RestorationJobData } from "./types/jobData";
import "./workspace.css";
import "./documents.css";

const textOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
type Tab = "overview" | "details" | "documents" | "requests" | "intake";
function Section({
  title,
  children,
  open = false,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="workspace-section" open={open}>
      <summary>{title}</summary>
      <div className="workspace-section-body">{children}</div>
    </details>
  );
}

export default function JobWorkspace({
  id,
  requests,
  jobs = [],
  customers = [],
  onNewRequest,
  onOpenRequest,
  onBack,
}: {
  id: string;
  requests: RequestSummary[];
  jobs?: JobEntry[];
  customers?: CustomerSummary[];
  onNewRequest: (request: ChangeRequest) => void;
  onOpenRequest: (id: string) => void;
  onBack: () => void;
}) {
  const packetSelectId = useId();
  const [focusField, setFocusField] = useState("");
  useEffect(() => {
    if (!focusField) return;
    const frame = requestAnimationFrame(() => {
      const input = document.getElementById(focusField);
      if (input) {
        let parent = input.parentElement;
        while (parent) {
          if (parent instanceof HTMLDetailsElement) parent.open = true;
          parent = parent.parentElement;
        }
        input.scrollIntoView({ block: "center" });
        input.focus({ preventScroll: true });
        setFocusField("");
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [focusField]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const current = useRef<Workspace | null>(null);
  const [row, setRow] = useState<WorkspaceRow>();
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [deviceSaving, setDeviceSaving] = useState(false);
  const saveCount = useRef(0);
  const changeSequence = useRef(0);
  const deviceError = useRef(false);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const [provenance, setProvenance] = useState<ProvenanceRecord>({});
  const [selectedCo, setSelectedCo] = useState("");
  const [preview, setPreview] = useState<{
    template?: Template;
    name: string;
    bytes: Uint8Array | null;
    spans: PdfFieldSpan[];
  } | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const previewSequence = useRef(0);
  const previewEntry = useRef(false);

  useEffect(() => {
    if (preview && !previewEntry.current) {
      window.history.pushState(null, "", window.location.hash);
      previewEntry.current = true;
    }
  }, [!!preview]);

  useEffect(() => {
    const pop = () => {
      if (!previewEntry.current) return;
      previewEntry.current = false;
      previewSequence.current++;
      setPreview(null);
      setRegenerating(false);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);

  const closePreview = () => {
    previewSequence.current++;
    setPreview(null);
    setRegenerating(false);
    if (previewEntry.current) {
      previewEntry.current = false;
      window.history.back();
    }
  };

  useEffect(() => {
    let active = true;
    const read = async () => {
      const [local, files] = await Promise.all([
        cachedWorkspace(id),
        cachedJobDocuments(id),
      ]);
      if (!active) return;
      setRow(local);
      setDocuments(files);
      if (
        local &&
        (!current.current ||
          (!saveCount.current &&
            !deviceError.current &&
            !local.dirty &&
            !local.inFlight &&
            !local.conflict))
      ) {
        if (!current.current) setTab(local.workspace.record.customer.customerName.trim() || local.workspace.customerId ? "overview" : "details");
        current.current = local.workspace;
        setWorkspace(local.workspace);
      } else if (local && current.current) {
        current.current = {
          ...current.current,
          revision: local.workspace.revision,
        };
      }
    };
    void read().catch((value) => active && setError(textOf(value)));
    void cachedWorkspace(id)
      .then(async (local) => {
        if (!local || local.serverRevision) {
          await loadWorkspace(id);
          await refreshJobDocuments(id).catch(() => undefined);
          await read();
        }
      })
      .catch((value) => active && setError(textOf(value)));
    const unsubscribe = subscribeWorkspaces(() => {
      void read().catch((value) => active && setError(textOf(value)));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [id]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (saveCount.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const change = (next: Workspace) => {
    const baseline = current.current || undefined;
    const sequence = ++changeSequence.current;
    current.current = next;
    setWorkspace(next);
    setError("");
    setDeviceSaving(true);
    saveCount.current++;
    // Each edit starts a transaction immediately. A completed earlier save cannot replace this editor.
    const saved = saveWorkspaceLocally(next, baseline)
      .then((result) => {
        deviceError.current = false;
        if (sequence === changeSequence.current) {
          const merged = result.localConflict || result.workspace;
          current.current = merged;
          setWorkspace(merged);
        }
        return result;
      })
      .catch((value) => {
        deviceError.current = true;
        setError(textOf(value));
        throw value;
      })
      .finally(() => {
        saveCount.current--;
        setDeviceSaving(saveCount.current > 0);
      });
    writes.current = saved;
    void writes.current.catch(() => undefined);
  };
  const recordChange = (record: RestorationJobData) => {
    if (current.current)
      change({
        ...current.current,
        record: recalculateFinancials(record),
        updatedAt: new Date().toISOString(),
      });
  };
  useEffect(() => {
    const currentWorkspace = current.current;
    if (!workspace || !currentWorkspace || row?.conflict || row?.inFlight) return;
    const match = matchingDirectoryEntry(currentWorkspace, jobs);
    if (!match) return;
    let merged = fillWorkspaceFromDirectory(currentWorkspace, match);
    const customerId = !merged.customerId && customerIdForPick(match, customers, match.customer);
    if (customerId) merged = { ...merged, customerId };
    if (JSON.stringify(merged) === JSON.stringify(currentWorkspace)) return;
    change(merged);
    setNotice("Matching customer and job details filled automatically. Your saved edits were kept.");
  }, [workspace, jobs, customers, row?.conflict, row?.inFlight]);
  const fieldChange = (
    section: keyof RestorationJobData,
    field: string,
    value: unknown,
  ) => {
    if (!current.current) return;
    const record = current.current.record;
    recordChange({
      ...record,
      [section]: { ...(record[section] as object), [field]: value },
    });
  };

  // PDF.js receives independent byte buffers; each edit starts a fresh span capture.
  useEffect(() => {
    if (!preview?.template || !workspace) return;
    const template = preview.template;
    const sequence = ++previewSequence.current;
    setRegenerating(true);
    void generateDocWithSpans(
      template.generator,
      structuredClone(workspace.record),
    )
      .then((result) => {
        if (sequence === previewSequence.current)
          setPreview((value) =>
            value?.template?.id === template.id
              ? { ...value, bytes: result.bytes, spans: result.spans }
              : value,
          );
      })
      .catch((value) => {
        if (sequence === previewSequence.current) setError(textOf(value));
      })
      .finally(() => {
        if (sequence === previewSequence.current) setRegenerating(false);
      });
    return () => {
      previewSequence.current++;
    };
  }, [preview?.template, workspace?.record]);

  async function action(label: string, perform: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await perform();
    } catch (value) {
      setError(textOf(value));
    } finally {
      setBusy("");
    }
  }

  async function saveGenerated(template: Template) {
    await writes.current;
    const frozen = structuredClone(current.current!);
    const bytes = await template.generator(frozen.record);
    await queueJobDocument(
      frozen,
      template.id,
      template.buildFileName(frozen.record),
      bytes,
    );
    setNotice("PDF saved on this device. Upload to the shared job is queued.");
  }

  async function selectedChangeOrder(): Promise<Uint8Array | undefined> {
    if (!selectedCo) return undefined;
    const request = await openRequest(selectedCo);
    if (request.workspaceId !== id)
      throw new Error(
        "Link this change request to the job before including its PDF.",
      );
    const reference = request.customerDocument;
    const file = request.attachments.find(
      (file) => file.id === reference?.attachmentId,
    );
    if (
      !reference ||
      !file ||
      reference.inputFingerprint !==
        (await customerDocumentFingerprint(request, reference.templateVersion))
    )
      throw new Error(
        "Prepare and save a current customer PDF for the selected change request first.",
      );
    return new Uint8Array(
      await (await fetchAttachment(request.id, file.id)).blob.arrayBuffer(),
    );
  }

  async function packet(zip: boolean, save = false) {
    await writes.current;
    const frozen = structuredClone(current.current!);
    const co = await selectedChangeOrder();
    const bytes = await generateCompletePacket(frozen.record, co);
    if (save) {
      await queueJobDocument(
        frozen,
        "packet",
        buildCombinedPacketFileName(frozen.record),
        bytes,
      );
      setNotice(
        "Packet saved on this device. Upload to the shared job is queued.",
      );
      return;
    }
    if (!zip) {
      downloadBlob(
        new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
        buildCombinedPacketFileName(frozen.record),
      );
      return;
    }
    const archive = new JSZip();
    for (const template of JOB_DOCUMENTS)
      archive.file(
        template.buildFileName(frozen.record),
        await template.generator(frozen.record),
      );
    if (co)
      archive.file(
        `06_${safeJobNumber(frozen.record)}_Customer_Change_Order.pdf`,
        co,
      );
    archive.file(buildCombinedPacketFileName(frozen.record), bytes);
    downloadBlob(
      await archive.generateAsync({ type: "blob" }),
      `${safeJobNumber(frozen.record)}_Documents.zip`,
    );
  }

  async function newRequest() {
    await writes.current;
    await flushWorkspace(id);
    const frozen = current.current!;
    // Each new request starts from every earlier change order on this job,
    // not from a single “last amount” that would lose older corrections.
    const prior = await priorChangesFrom(
      requests.filter((request) => request.workspaceId === id),
      openRequest,
      frozen.previousChanges,
    );
    onNewRequest(requestFromWorkspace(frozen, undefined, prior ?? undefined));
  }

  async function resolveConflict(choice: "device" | "server") {
    await writes.current;
    await resolveWorkspaceConflict(id, choice);
    const fresh = await cachedWorkspace(id);
    if (fresh) {
      current.current = fresh.workspace;
      setWorkspace(fresh.workspace);
    }
  }

  if (!workspace)
    return (
      <div className="workspace-empty">
        <h1>Opening job…</h1>
        {error && <p role="alert">{error}</p>}
        <button className="button" onClick={onBack}>
          Back to Jobs & Documents
        </button>
      </div>
    );
  const data = workspace.record;
  const overviewCustomerId = workspace.customerId || customerIdForPick(undefined, customers, data.customer.customerName);
  const related = requests.filter((request) => request.workspaceId === id);
  const missing = getMissingJobFields(data);
  const pending = row?.dirty || row?.inFlight;
  const status = deviceSaving
    ? "Saving on this device…"
    : row?.conflict
      ? "Review conflicting changes"
      : row?.error
        ? "Saved on device · sync needs attention"
        : pending
          ? "Saved on device · waiting to sync"
          : row?.serverRevision
            ? "Saved to shared workspace"
            : "Saved on device";

  return (
    <div className="documents-workspace job-workspace">
      <div className="workspace-title">
        <div>
          <button className="workspace-back" onClick={onBack}>
            ← Customers & Jobs
          </button>
          <h1>{data.customer.customerName || "New customer & job"}</h1>
          <p>
            {[data.customer.jobNumber, data.customer.lossAddress]
              .filter(Boolean)
              .join(" · ") ||
              "Enter the job details once, then reuse them for documents and requests."}
          </p>
        </div>
        <button
          className="button primary"
          disabled={!!busy || deviceSaving}
          onClick={() => void action("Opening request…", newRequest)}
        >
          <Plus size={17} />
          New change request
        </button>
      </div>
      <div
        className={`workspace-sync ${row?.error ? "has-error" : ""}`}
        role="status"
      >
        <span>{status}</span>
        <button
          className="button small"
          disabled={!!busy || deviceSaving}
          onClick={() =>
            void action("Syncing…", async () => {
              await writes.current;
              await syncWorkspaces();
            })
          }
        >
          <RefreshCw size={15} />
          Sync now
        </button>
      </div>
      {row?.conflict && (
        <div className="notice danger">
          <p>{row.error} Both versions are preserved until you choose.</p>
          <div className="button-row">
            <button
              className="button"
              disabled={!!busy}
              onClick={() =>
                void action("Keeping pending edits…", () =>
                  resolveConflict("device"),
                )
              }
            >
              {row.localConflict ? "Use pending draft" : "Keep my device edits"}
            </button>
            <button
              className="button"
              disabled={!!busy}
              onClick={() =>
                void action("Loading saved copy…", () =>
                  resolveConflict("server"),
                )
              }
            >
              {row.localConflict
                ? "Keep current device copy"
                : "Use shared copy"}
            </button>
          </div>
        </div>
      )}
      {error && (
        <div className="notice danger" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice success" role="status">
          {notice}
        </div>
      )}
      {busy && <p role="status">{busy}</p>}
      {missing.length > 0 && (
        <div className="workspace-missing">
          <strong>Job details to complete</strong>
          <div>
            {missing.map((field) => (
              <button
                className="text-button"
                key={field.inputId}
                onClick={() => {
                  setTab("details");
                  setFocusField(field.inputId);
                }}
              >
                {field.label} ?
              </button>
            ))}
          </div>
        </div>
      )}
      <nav className="workspace-tabs" aria-label="Job sections">
        {(
          [
            ["overview", "Overview"],
            ["details", "Job Details"],
            ["documents", "Documents"],
            ["requests", "Change Requests"],
            ["intake", "Estimate Intake"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-current={tab === value ? "page" : undefined}
            className={tab === value ? "active" : ""}
            onClick={() => setTab(value)}
          >
            {label}
            {value === "requests" ? ` (${related.length})` : ""}
          </button>
        ))}
      </nav>
      {tab === "overview" && (overviewCustomerId ? <CustomerDetail
        key={overviewCustomerId}
        id={overviewCustomerId}
        embedded
        workspaceId={workspace.id}
        contactOverride={data.customer}
        onBack={onBack}
        onOpenRequest={onOpenRequest}
        onEditContact={() => { setTab("details"); setFocusField("customer-customerName"); }}
      /> : <section className="workspace-panel" aria-label="Record overview">
        <h2>Contact details</h2>
        <p>{data.customer.mainPhone || data.customer.mobilePhone || data.customer.homePhone || "Add a phone number to keep in touch."}</p>
        {data.customer.email && <p><a href={`mailto:${data.customer.email}`}>{data.customer.email}</a></p>}
        <button className="button" onClick={() => setTab("details")}>Edit job details</button>
      </section>)}
      {tab === "details" && (
        <div className="workspace-form">
          <Section title="Customer & Property" open>
            <SectionCustomer
              data={data.customer}
              jobData={data}
              directory={jobs}
              directoryDisabled={!!busy || deviceSaving}
              onSelectDirectory={(entry) => {
                try {
                  if (!current.current) return;
                  const next = fillWorkspaceFromDirectory(
                    current.current,
                    entry,
                  );
                  if (!next.customerId)
                    next.customerId = customerIdForPick(
                      entry,
                      customers,
                      entry.customer,
                    );
                  change(next);
                  setNotice(
                    "Available directory details filled in. Existing details were preserved; review the job before generating documents.",
                  );
                } catch (value) {
                  setError(textOf(value));
                }
              }}
              onPreview={(template) =>
                setPreview({
                  template,
                  name: template.title,
                  bytes: null,
                  spans: [],
                })
              }
              onChange={(field, value) => fieldChange("customer", field, value)}
            />
          </Section>
          <Section title="Insurance & Claim">
            <SectionInsurance
              data={data.insurance}
              jobData={data}
              onPreview={(template) =>
                setPreview({
                  template,
                  name: template.title,
                  bytes: null,
                  spans: [],
                })
              }
              onChange={(field, value) =>
                fieldChange("insurance", field, value)
              }
            />
          </Section>
          <Section title="Financials">
            <div className="workspace-money">
              <label>
                Original contract amount
                <input
                  inputMode="decimal"
                  value={workspace.originalContract}
                  onChange={(event) =>
                    change({
                      ...current.current!,
                      originalContract: event.target.value,
                    })
                  }
                  placeholder="Unknown"
                />
              </label>
              <label>
                Previous authorized changes
                <input
                  inputMode="decimal"
                  value={workspace.previousChanges}
                  onChange={(event) =>
                    change({
                      ...current.current!,
                      previousChanges: event.target.value,
                    })
                  }
                />
              </label>
            </div>
            <p className="workspace-help">
              Contract amounts are separate from approved RCV. Only authorized
              changes belong in the previous changes amount.
            </p>
            <FinancialSummaryCard
              financials={data.financials}
              jobData={data}
              onPreview={(template) =>
                setPreview({
                  template,
                  name: template.title,
                  bytes: null,
                  spans: [],
                })
              }
              onRcvChange={(value) =>
                fieldChange("financials", "totalApprovedRcv", value)
              }
              onDeductibleChange={(value) =>
                fieldChange("financials", "deductible", value)
              }
            />
          </Section>
          <Section title="Mortgage">
            <SectionMortgage
              data={data.mortgage}
              jobData={data}
              onPreview={(template) =>
                setPreview({
                  template,
                  name: template.title,
                  bytes: null,
                  spans: [],
                })
              }
              onChange={(field, value) => fieldChange("mortgage", field, value)}
            />
          </Section>
          <Section title="Team & Branch">
            <SectionTeam
              data={data.team}
              branch={data.branch}
              jobData={data}
              onPreview={(template) =>
                setPreview({
                  template,
                  name: template.title,
                  bytes: null,
                  spans: [],
                })
              }
              onChange={(field, value) => fieldChange("team", field, value)}
            />
            <details className="workspace-branch">
              <summary>Edit branch details</summary>
              <div className="workspace-money">
                {Object.entries(data.branch).map(([field, value]) => (
                  <label key={field}>
                    {field.replace(/([A-Z])/g, " $1")}
                    <input
                      value={value}
                      onChange={(event) =>
                        fieldChange("branch", field, event.target.value)
                      }
                    />
                  </label>
                ))}
              </div>
            </details>
          </Section>
          <Section title="Production Checklist">
            <SectionChecklist
              checklist={data.checklist}
              jobData={data}
              onPreview={(template) =>
                setPreview({
                  template,
                  name: template.title,
                  bytes: null,
                  spans: [],
                })
              }
              onChange={(field, value) =>
                fieldChange("checklist", field, value)
              }
            />
          </Section>
          <Section title="Production Notes">
            <SectionProductionNotes
              productionNotes={data.productionNotes}
              jobData={data}
              onPreview={(template) =>
                setPreview({
                  template,
                  name: template.title,
                  bytes: null,
                  spans: [],
                })
              }
              onChange={(field, value) =>
                fieldChange("productionNotes", field, value)
              }
            />
          </Section>
        </div>
      )}
      {tab === "intake" && (
        <>
          <p className="workspace-help">
            Review extracted fields and amounts before generating documents.
            Estimate analysis does not approve a change-order price.
          </p>
          <IntakeParserCard
            currentJob={data}
            currentProvenance={provenance}
            onApplyIntake={(record, next) => {
              setProvenance(next);
              recordChange(record);
              setNotice(
                "Estimate details applied. Review the job fields and amounts before using them.",
              );
            }}
          />
        </>
      )}
      {tab === "requests" && (
        <section className="workspace-panel">
          <h2>Change requests for this job</h2>
          <p>
            Each request keeps its own saved scope, prices, and customer PDF.
          </p>
          {related.length ? (
            related.map((request) => (
              <button
                className="workspace-list-row"
                key={request.id}
                onClick={() => onOpenRequest(request.id)}
              >
                <FileText size={20} />
                <span>
                  <strong>{request.job.orderNumber || "Change request"}</strong>
                  <small>
                    {request.status.replaceAll("_", " ")} ·{" "}
                    {request.estimatorName || "Unassigned"}
                  </small>
                </span>
                <span>Open →</span>
              </button>
            ))
          ) : (
            <p>No change requests yet.</p>
          )}
          <button
            className="button primary"
            disabled={!!busy || deviceSaving}
            onClick={() => void action("Opening request…", newRequest)}
          >
            <Plus size={17} />
            New change request
          </button>
        </section>
      )}
      {tab === "documents" && (
        <>
          {missing.length > 0 && (
            <div className="notice neutral">
              <strong>Review before sending</strong>
              <p>
                Missing: {missing.map((field) => field.label).join(", ")}.
                Previews can be used while completing the job.
              </p>
              <button
                className="button small"
                onClick={() => setTab("details")}
              >
                Review job details
              </button>
            </div>
          )}
          <section className="workspace-panel">
            <div className="workspace-panel-heading">
              <div>
                <h2>Production documents</h2>
                <p>
                  Preview and edit fields, download a PDF, or save a copy to
                  this job.
                </p>
              </div>
              <div className="button-row">
                <button
                  className="button"
                  disabled={!!busy}
                  onClick={() =>
                    void action("Preparing packet…", () => packet(false))
                  }
                >
                  <Download size={16} />
                  Combined packet
                </button>
                <button
                  className="button"
                  disabled={!!busy}
                  onClick={() =>
                    void action("Preparing ZIP…", () => packet(true))
                  }
                >
                  Download ZIP
                </button>
                <button
                  className="button"
                  disabled={!!busy || deviceSaving}
                  onClick={() =>
                    void action("Saving packet…", () => packet(false, true))
                  }
                >
                  <Save size={16} />
                  Save packet to job
                </button>
              </div>
            </div>
            <div className="workspace-co-select">
              <label htmlFor={packetSelectId}>
                Change order to include in packet
              </label>
              <select
                id={packetSelectId}
                value={selectedCo}
                onChange={(event) => setSelectedCo(event.target.value)}
              >
                <option value="">No change order</option>
                {related.map((request) => (
                  <option key={request.id} value={request.id}>
                    {request.job.orderNumber || request.id} ·{" "}
                    {request.status.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="workspace-document-grid">
              {JOB_DOCUMENTS.map((template) => (
                <article className="workspace-document-card" key={template.id}>
                  <FileText size={23} />
                  <h3>{template.title}</h3>
                  <p>{template.description}</p>
                  <div className="button-row">
                    <button
                      className="button small"
                      onClick={() =>
                        setPreview({
                          template,
                          name: template.title,
                          bytes: null,
                          spans: [],
                        })
                      }
                    >
                      <Eye size={15} />
                      Preview / edit
                    </button>
                    <button
                      className="button small"
                      disabled={!!busy}
                      onClick={() =>
                        void action("Preparing PDF…", async () => {
                          const bytes = await template.generator(
                            current.current!.record,
                          );
                          downloadBlob(
                            new Blob([new Uint8Array(bytes)], {
                              type: "application/pdf",
                            }),
                            template.buildFileName(current.current!.record),
                          );
                        })
                      }
                    >
                      <Download size={15} />
                      Download
                    </button>
                    <button
                      className="button small"
                      disabled={!!busy || deviceSaving}
                      onClick={() =>
                        void action("Saving PDF…", () =>
                          saveGenerated(template),
                        )
                      }
                    >
                      <Save size={15} />
                      Save to job
                    </button>
                  </div>
                </article>
              ))}
              <article className="workspace-document-card">
                <FileText size={23} />
                <h3>Customer Change Order</h3>
                <p>
                  Prepare the customer form from a change request to preserve
                  its scope and final price.
                </p>
                <button
                  className="button small"
                  onClick={() => setTab("requests")}
                >
                  Open change requests →
                </button>
              </article>
            </div>
          </section>
          <section className="workspace-panel">
            <h2>Saved document history</h2>
            {documents.length ? (
              <DocumentHistory
                rows={documents}
                record={data}
                onOpen={(file) =>
                  void action("Opening saved PDF…", async () => {
                    const blob = await fetchJobDocument(file.document);
                    setPreview({
                      name: file.document.name,
                      bytes: new Uint8Array(await blob.arrayBuffer()),
                      spans: [],
                    });
                  })
                }
              />
            ) : (
              <p>
                Saved PDFs will appear here. Earlier versions stay available
                when job details change.
              </p>
            )}
          </section>
        </>
      )}
      <PdfPreviewModal
        isOpen={!!preview}
        title={preview?.name || ""}
        pdfBytes={preview?.bytes || null}
        spans={preview?.spans}
        isLoading={!!preview && !preview.bytes && regenerating}
        isRegenerating={regenerating}
        onClose={closePreview}
        onDownload={() => {
          if (preview?.bytes && !regenerating)
            downloadBlob(
              new Blob([new Uint8Array(preview.bytes)], {
                type: "application/pdf",
              }),
              preview.template?.buildFileName(data) || preview.name,
            );
        }}
        jobData={preview?.template ? data : undefined}
        editableFields={
          preview?.template ? getPdfFieldSchema(preview.template.id) : undefined
        }
        onFieldChange={
          preview?.template
            ? (path, value) => {
                try {
                  recordChange(
                    updateRecordField(current.current!.record, path, value),
                  );
                } catch (value) {
                  setError(textOf(value));
                }
              }
            : undefined
        }
        onSaveToDrive={
          preview?.template
            ? () =>
                void action("Saving PDF…", () =>
                  saveGenerated(preview.template!),
                )
            : undefined
        }
        isDriveLoading={!!busy}
      />
    </div>
  );
}

function DocumentHistory({
  rows,
  record,
  onOpen,
}: {
  rows: DocumentRow[];
  record: RestorationJobData;
  onOpen: (row: DocumentRow) => void;
}) {
  const [fingerprints, setFingerprints] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    void Promise.all(
      [...new Set(rows.map((row) => row.document.kind))].map(
        async (kind) =>
          [kind, await documentFingerprint(kind, record)] as const,
      ),
    ).then((pairs) => {
      if (active) setFingerprints(Object.fromEntries(pairs));
    });
    return () => {
      active = false;
    };
  }, [record, rows]);
  return (
    <div>
      {[...rows]
        .sort((a, b) =>
          b.document.createdAt.localeCompare(a.document.createdAt),
        )
        .map((row) => (
          <button
            className="workspace-list-row"
            key={row.document.id}
            onClick={() => onOpen(row)}
          >
            <FolderOpen size={20} />
            <span>
              <strong>{row.document.name}</strong>
              <small>
                {row.pending
                  ? row.error
                    ? `Upload needs attention: ${row.error}`
                    : "Saved on device · upload queued"
                  : "Saved to shared job"}
                {fingerprints[row.document.kind] &&
                fingerprints[row.document.kind] !==
                  row.document.inputFingerprint
                  ? " · Earlier job details"
                  : ""}
              </small>
            </span>
            <span>Open</span>
          </button>
        ))}
    </div>
  );
}
