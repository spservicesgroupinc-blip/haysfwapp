import { useEffect, useState } from "react";
import { FileText, Plus, Search, Upload } from "lucide-react";
import type { ChangeRequest, JobEntry, RequestSummary } from "../types";
import type { WorkspaceRow } from "../workspaces/types";
import {
  createWorkspace,
  normalizeJobNumber,
  workspaceFromDirectory,
} from "../workspaces/model";
import {
  cachedWorkspaces,
  refreshWorkspaces,
  saveWorkspaceLocally,
  subscribeWorkspaces,
} from "../services/workspaces";
import { syncWorkspaces } from "../services/workspaces";
import { importWorkspaceLocally } from "../workspaces/importStore";
import {
  listCustomers,
  subscribeCrm,
  syncCustomersFromJobs,
  type CustomerSummary,
} from "../crm";
import {
  customerIdForPick,
  customerIdOfOption,
  customerOptions,
} from "../services/customerDirectory";
import JobWorkspace from "./JobWorkspace";
import { CustomerImportPage } from "./components/CustomerImportPage";
import WorkspaceMigration from "./WorkspaceMigration";
import { DirectoryJobPicker } from "./components/DirectoryJobPicker";
import "./workspace.css";
import "./documents.css";

export default function JobsDocuments({
  workspaceId,
  initialTool,
  jobs,
  requests,
  onOpenWorkspace,
  onNewRequest,
  onOpenRequest,
  onBack,
}: {
  workspaceId?: string;
  initialTool?: "migration" | "reference";
  jobs: JobEntry[];
  requests: RequestSummary[];
  onOpenWorkspace: (id: string) => void;
  onNewRequest: (request: ChangeRequest) => void;
  onOpenRequest: (id: string) => void;
  onBack: () => void;
}) {
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [rows, setRows] = useState<WorkspaceRow[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<"jobs" | "migration" | "reference">("jobs");
  useEffect(() => setTool(initialTool || "jobs"), [initialTool]);
  useEffect(() => {
    let active = true;
    const read = () =>
      void listCustomers()
        .then((value) => {
          if (active) setCustomers(value);
        })
        .catch(() => undefined);
    read();
    const unsubscribe = subscribeCrm(read);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const directory = [...jobs, ...customerOptions(jobs, customers)];
  useEffect(() => {
    let active = true;
    const read = async () => {
      const cached = await cachedWorkspaces();
      if (active) setRows(cached);
    };
    void read().catch((value) => active && setError(String(value)));
    void refreshWorkspaces()
      .then(() => {
        if (active) setError("");
      })
      .catch(
        (value) =>
          active &&
          setError(value instanceof Error ? value.message : String(value)),
      );
    const unsubscribe = subscribeWorkspaces(
      () => void read().catch((value) => active && setError(String(value))),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function create(entry?: JobEntry) {
    setBusy(true);
    setError("");
    try {
      if (entry) {
        const matches = rows.filter(
          (row) =>
            normalizeJobNumber(row.workspace.record.customer.jobNumber) ===
            normalizeJobNumber(entry.jobNumber),
        );
        if (entry.jobNumber.trim() && matches.length === 1) {
          onOpenWorkspace(matches[0].workspace.id);
          return;
        }
        if (entry.jobNumber.trim() && matches.length > 1)
          throw new Error(
            "More than one saved job uses this number. Open the correct saved job below.",
          );
      }
      const workspace = entry
        ? workspaceFromDirectory(entry)
        : createWorkspace();
      if (entry)
        workspace.customerId = customerIdForPick(
          entry,
          customers,
          entry.customer,
        );
      await saveWorkspaceLocally(workspace);
      // Opening a job from the directory registers its customer and links it.
      if (entry && !customerIdOfOption(entry.id))
        await syncCustomersFromJobs([entry], true).catch(() => undefined);
      onOpenWorkspace(workspace.id);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  }

  if (workspaceId)
    return (
      <JobWorkspace
        key={workspaceId}
        id={workspaceId}
        requests={requests}
        jobs={directory}
        customers={customers}
        onNewRequest={onNewRequest}
        onOpenRequest={onOpenRequest}
        onBack={onBack}
      />
    );
  const query = search.trim().toLowerCase();
  const visible = rows
    .filter((row) =>
      [
        row.workspace.record.customer.customerName,
        row.workspace.record.customer.jobNumber,
        row.workspace.record.customer.lossAddress,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    )
    .sort((a, b) => b.workspace.updatedAt.localeCompare(a.workspace.updatedAt));
  return (
    <div className="documents-workspace jobs-documents">
      <div className="workspace-title">
        <div>
          <p className="workspace-eyebrow">Shared job workspace</p>
          <h1>Jobs & Documents</h1>
          <p>
            Job details, production documents, and change requests together.
          </p>
        </div>
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void create()}
        >
          <Plus size={18} />
          New job
        </button>
      </div>
      {tool !== "jobs" && (
        <div className="workspace-tools">
          <button className="button" onClick={() => setTool("jobs")}>
            Back to saved jobs
          </button>
        </div>
      )}

      {error && (
        <div className="notice danger" role="alert">
          {error}
          <button
            className="button small"
            onClick={() =>
              void refreshWorkspaces()
                .then(() => setError(""))
                .catch((value) => setError(String(value)))
            }
          >
            Retry connection
          </button>
        </div>
      )}
      {tool === "migration" ? (
        <WorkspaceMigration
          workspaces={rows.map((row) => row.workspace)}
          onImport={async (workspace) => {
            await importWorkspaceLocally(
              workspace,
              rows.find((row) => row.workspace.id === workspace.id)?.workspace,
            );
            setRows(await cachedWorkspaces());
            void syncWorkspaces().catch(() => undefined);
          }}
          onDone={() => setTool("jobs")}
        />
      ) : tool === "reference" ? (
        <CustomerImportPage canImport onOpenIntake={() => setTool("jobs")} />
      ) : (
        <>
          <label className="workspace-search">
            <Search size={18} />
            <input
              aria-label="Search saved jobs"
              placeholder="Search customer, job number, or address"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <section className="workspace-panel">
            <h2>
              Saved jobs <span className="workspace-count">{rows.length}</span>
            </h2>
            {visible.length ? (
              visible.map((row) => (
                <button
                  className="workspace-list-row"
                  key={row.workspace.id}
                  onClick={() => onOpenWorkspace(row.workspace.id)}
                >
                  <FileText size={22} />
                  <span>
                    <strong>
                      {row.workspace.record.customer.customerName ||
                        "Untitled job"}
                    </strong>
                    <small>
                      {[
                        row.workspace.record.customer.jobNumber,
                        row.workspace.record.customer.lossAddress,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Job details in progress"}
                    </small>
                    <small>
                      {row.conflict
                        ? "Conflicting edits need review"
                        : row.error
                          ? "Sync needs attention · device copy saved"
                          : row.dirty || row.inFlight
                            ? "Saved on device · sync queued"
                            : "Saved to shared workspace"}
                    </small>
                  </span>
                  <span>Open →</span>
                </button>
              ))
            ) : (
              <p>
                {rows.length
                  ? "No saved jobs match your search."
                  : "Create a job or choose one from the directory below. Documents can be prepared before any change request exists."}
              </p>
            )}
          </section>
          <details className="workspace-panel directory-disclosure">
            <summary>Start from jobs &amp; customers</summary>
            <p>
              Choose an imported job to start its workspace. Future directory
              imports preserve your saved details and documents.
            </p>
            <DirectoryJobPicker
              jobs={directory}
              disabled={busy}
              onSelect={(entry) => void create(entry)}
            />
          </details>
        </>
      )}
    </div>
  );
}
