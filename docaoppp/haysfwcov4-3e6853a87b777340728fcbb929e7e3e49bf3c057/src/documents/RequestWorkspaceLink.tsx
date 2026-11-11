import { useEffect, useId, useRef, useState } from "react";
import type { ChangeRequest } from "../types";
import type { Workspace } from "../workspaces/types";
import {
  cachedWorkspaces,
  refreshWorkspaces,
  saveWorkspaceLocally,
  flushWorkspace,
} from "../services/workspaces";
import { createWorkspace, normalizeJobNumber } from "../workspaces/model";
import { workspaceApi } from "../services/workspaceApi";
import "./workspace.css";

export default function RequestWorkspaceLink({
  request,
  onOpen,
  onSaved,
}: {
  request: ChangeRequest;
  onOpen: (id: string) => void;
  onSaved: (request: ChangeRequest) => void;
}) {
  const selectId = useId();
  const [jobs, setJobs] = useState<Workspace[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{
    choice: string;
    workspace?: Workspace;
    mutationId: string;
    expectedRevision: number;
  } | null>(null);
  useEffect(() => {
    if (!expanded) return;
    let active = true;
    const read = async () => {
      const rows = await cachedWorkspaces();
      if (active) setJobs(rows.map((row) => row.workspace));
    };
    void read().catch((value) => active && setError(String(value)));
    void refreshWorkspaces()
      .then(read)
      .catch((value) => active && setError(String(value)));
    return () => {
      active = false;
    };
  }, [expanded]);
  if (request.workspaceId)
    return (
      <div className="workspace-request-link">
        <button className="button" onClick={() => onOpen(request.workspaceId!)}>
          Open job details & documents →
        </button>
      </div>
    );
  const matches = jobs.filter(
    (job) =>
      request.job.jobNumber.trim() &&
      normalizeJobNumber(job.record.customer.jobNumber) ===
        normalizeJobNumber(request.job.jobNumber),
  );
  async function link() {
    if (!choice) return;
    setBusy(true);
    setError("");
    try {
      if (!attempt.current || attempt.current.choice !== choice)
        attempt.current = {
          choice,
          mutationId: crypto.randomUUID(),
          expectedRevision: request.revision,
        };
      const transaction = attempt.current;
      let workspaceId = choice;
      if (choice === "new") {
        if (!transaction.workspace) {
          const workspace = createWorkspace();
          const job = request.job;
          Object.assign(workspace.record.customer, {
            customerName: job.customer,
            jobNumber: job.jobNumber,
            lossAddress: job.address,
            mainPhone: job.customerPhone || "",
            email: job.customerEmail || "",
          });
          Object.assign(workspace.record.insurance, {
            carrier: job.carrier,
            claimNumber: job.claim,
          });
          Object.assign(workspace.record.team, {
            projectManager: job.projectManager,
            estimator: request.estimatorName || job.branchContact,
          });
          workspace.originalContract = job.originalContract;
          workspace.previousChanges = job.previousChanges;
          transaction.workspace = workspace;
        }
        if (
          !(await cachedWorkspaces()).some(
            (row) => row.workspace.id === transaction.workspace!.id,
          )
        )
          await saveWorkspaceLocally(transaction.workspace);
        workspaceId = transaction.workspace.id;
      }
      await flushWorkspace(workspaceId);
      const result = await workspaceApi<{ request: ChangeRequest }>(
        "linkRequestWorkspace",
        {
          id: request.id,
          workspaceId,
          expectedRevision: transaction.expectedRevision,
          mutationId: transaction.mutationId,
        },
      );
      onSaved(result.request);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace-request-link">
      <button className="button" onClick={() => setExpanded((value) => !value)}>
        Connect job details & documents
      </button>
      {expanded && (
        <div className="workspace-panel">
          <p>
            Link this request to a shared job. Its saved customer details,
            scope, price, and PDFs stay as they are.
          </p>
          <div className="workspace-directory-select">
            <label htmlFor={selectId}>Shared job</label>
            <select
              id={selectId}
              value={choice}
              disabled={busy}
              onChange={(event) => {
                setChoice(event.target.value);
                attempt.current = null;
              }}
            >
              <option value="">Choose a saved job…</option>
              <option value="new">Create a job from this request</option>
              {[
                ...matches,
                ...jobs.filter((job) => !matches.includes(job)),
              ].map((job) => (
                <option key={job.id} value={job.id}>
                  {job.record.customer.customerName || "Untitled"} ·{" "}
                  {job.record.customer.jobNumber || "No number"}
                  {matches.includes(job) ? " (matching job number)" : ""}
                </option>
              ))}
            </select>
          </div>
          <button
            className="button primary"
            disabled={!choice || busy}
            onClick={() => void link()}
          >
            {busy ? "Connecting…" : "Connect to job"}
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
