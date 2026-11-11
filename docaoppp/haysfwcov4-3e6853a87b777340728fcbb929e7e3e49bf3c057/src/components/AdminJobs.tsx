import { useRef, useState } from "react";
import { CheckCircle2, FileSpreadsheet, ListChecks, Upload, X } from "lucide-react";
import type { JobEntry } from "../types";
import { parseJobReport, type JobImportResult } from "../services/jobImport";
import { replaceCustomerReference } from "../documents/services/customerReferenceService";
import { customerReferenceJobs, jobsToCustomerReferences } from "../services/customerReferenceJobs";
import { syncCustomersFromJobs } from "../crm";
import "./AdminJobs.css";

export interface AdminJobsProps {
  jobs: JobEntry[];
  onImported: (jobs: JobEntry[]) => void;
}

export default function AdminJobs({ jobs, onImported }: AdminJobsProps) {
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("Job Summary CSV");
  const [preview, setPreview] = useState<JobImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePreview = (text: string) => {
    setError("");
    setSuccess("");
    try {
      const result = parseJobReport(text);
      setPreview(result);
      if (result.jobs.length === 0) {
        setError("No valid jobs could be parsed from the provided CSV text.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = String(event.target?.result || "");
      setCsvText(content);
      handlePreview(content);
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!preview || preview.jobs.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const snapshot = await replaceCustomerReference(jobsToCustomerReferences(preview.jobs), fileName);
      const imported = customerReferenceJobs(snapshot);
      onImported(imported);
      // The uploaded jobs are the customer list: every customer on the report
      // becomes a customer record (or fills in the details it was missing).
      const synced = await syncCustomersFromJobs(imported, true).catch(() => null);
      const added = synced?.created.length ?? 0;
      const filled = synced?.updated.length ?? 0;
      setSuccess(
        `Successfully imported ${imported.length} jobs for auto-complete.${
          added || filled
            ? ` Customer directory updated — ${added} added, ${filled} completed.`
            : ""
        }`,
      );
      setPreview(null);
      setCsvText("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-jobs">
      <div className="admin-jobs-head">
        <div>
          <h1>Import jobs for auto-complete</h1>
          <p>
            Upload or paste your Dash Job Summary CSV so project managers can
            search customers and auto-fill Quick Requests and job documents.
          </p>
        </div>
        <div className="admin-jobs-count">
          <ListChecks size={24} />
          <div>
            <strong>{jobs.length}</strong>
            <span>Active jobs in directory</span>
          </div>
        </div>
      </div>

      {success ? (
        <div className="admin-jobs-done" role="status">
          <CheckCircle2 size={18} />
          <span>{success}</span>
        </div>
      ) : null}

      {error ? (
        <div className="storage-error" role="alert">
          <X size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="admin-section">
        <div className="admin-section-heading">
          <h2>Upload or paste CSV</h2>
          <p>
            Supports standard Dash / Xactimate JobSummaryReport exports (Job Number,
            Customer, Address, ForePerson, Total Contract Sales or Estimate Amount).
          </p>
        </div>

        <div className="admin-import-bar">
          <div className="admin-file-picker">
            <input
              type="file"
              accept=".csv,text/csv"
              ref={fileInputRef}
              onChange={handleFileUpload}
              aria-label="Upload CSV file"
            />
            <button
              type="button"
              className="button"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={16} />
              Choose CSV file
            </button>
            <span style={{ color: "#76808f", fontSize: "13px" }}>
              or paste the CSV contents below
            </span>
          </div>

          <textarea
            className="admin-paste"
            placeholder="Paste job report CSV text here…"
            value={csvText}
            onChange={(e) => {
              setCsvText(e.target.value);
              handlePreview(e.target.value);
            }}
            rows={5}
            aria-label="Paste job report CSV"
          />

          <div className="admin-actions">
            <button
              type="button"
              className="button"
              disabled={!csvText.trim()}
              onClick={() => handlePreview(csvText)}
            >
              <FileSpreadsheet size={16} />
              Preview jobs
            </button>
            {preview && preview.jobs.length > 0 ? (
              <button
                type="button"
                className="button primary"
                disabled={busy}
                onClick={handleImport}
              >
                {busy
                  ? "Importing…"
                  : `Import ${preview.jobs.length} job${preview.jobs.length === 1 ? "" : "s"}`}
              </button>
            ) : null}
          </div>
        </div>

        {preview && preview.warnings.length > 0 ? (
          <div className="admin-warnings">
            <strong>Notes:</strong> {preview.warnings.join(", ")}
          </div>
        ) : null}

        {preview && preview.jobs.length > 0 ? (
          <div>
            <h3>Preview ({preview.jobs.length} jobs ready to import)</h3>
            <div className="admin-sample">
              <table>
                <thead>
                  <tr>
                    <th>Job #</th>
                    <th>Customer</th>
                    <th>Address</th>
                    <th>PM</th>
                    <th>Estimate Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.jobs.slice(0, 10).map((j, i) => (
                    <tr key={j.id || i}>
                      <td><strong>{j.jobNumber || "—"}</strong></td>
                      <td>{j.customer || "—"}</td>
                      <td>{j.address || "—"}</td>
                      <td>{j.projectManager || "—"}</td>
                      <td>{j.contractAmount ? `$${j.contractAmount}` : "—"}</td>
                      <td>{j.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.jobs.length > 10 ? (
              <p style={{ marginTop: "8px", fontSize: "12px", color: "#76808f" }}>
                Showing first 10 of {preview.jobs.length} jobs.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
