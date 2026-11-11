import { CheckCircle2, Download, Eye, FileText, ImageIcon } from "lucide-react";
import type { ChangeRequest, RequestAttachment } from "../types";
import { contractAmounts } from "../services/contract";
import { signedAmountLabel } from "../services/changeOrder";
import { requestTypeLabel, customerCreditsLabel } from "../services/dashNote";
import "./IntakeReceipt.css";

const STATUS_LABELS: Record<string, string> = {
  submitted: "In queue",
  in_review: "In review",
  needs_information: "Needs info",
  completed: "Completed",
};

function fileSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function IntakeReceipt({
  request,
  onPreview,
  onDownload,
  busy = "",
}: {
  request: ChangeRequest;
  onPreview: (attachment: RequestAttachment) => void;
  onDownload: (attachment: RequestAttachment) => void;
  busy?: string;
}) {
  const amounts = contractAmounts(request.job);
  return (
    <div className="receipt">
      <div className="receipt-banner">
        <CheckCircle2 size={26} />
        <div>
          <h2>{STATUS_LABELS[request.status] ?? request.status}</h2>
          <p>
            {request.estimatorName
              ? `${request.estimatorName} is handling this request.`
              : "Your request is available to the estimating team."}
          </p>
        </div>
      </div>

      <section className="receipt-section">
        <div className="receipt-heading">
          <h2>Project details</h2>
          {request.submittedAt ? (
            <span className="receipt-caption">
              Submitted {new Date(request.submittedAt).toLocaleDateString()}
            </span>
          ) : null}
        </div>
        <dl className="receipt-job">
          <div>
            <dt>Request type</dt>
            <dd>{requestTypeLabel(request.requestType)}</dd>
          </div>
          <div>
            <dt>Customer credits</dt>
            <dd>{customerCreditsLabel(request.customerCredits)}</dd>
          </div>
          {request.knownChangeAmount ? (
            <div>
              <dt>Known change amount</dt>
              <dd>{signedAmountLabel(request.knownChangeAmount)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Job number</dt>
            <dd>{request.job.jobNumber || "—"}</dd>
          </div>
          <div>
            <dt>Customer</dt>
            <dd>{request.job.customer || "—"}</dd>
          </div>
          <div>
            <dt>Customer phone</dt>
            <dd>{request.job.customerPhone || "Not provided"}</dd>
          </div>
          <div>
            <dt>Customer email</dt>
            <dd>{request.job.customerEmail || "Not provided"}</dd>
          </div>
          <div>
            <dt>Property address</dt>
            <dd>{request.job.address || "—"}</dd>
          </div>
          <div>
            <dt>Project manager</dt>
            <dd>{request.job.projectManager || "—"}</dd>
          </div>
          <div>
            <dt>Original contract</dt>
            <dd>{amounts.original}</dd>
          </div>
          <div>
            <dt>Previous authorized changes</dt>
            <dd>{amounts.previous}</dd>
          </div>
          <div className="receipt-total">
            <dt>Total contract price</dt>
            <dd>{amounts.total}</dd>
          </div>
          <div>
            <dt>Estimate line numbers</dt>
            <dd style={{ whiteSpace: "pre-wrap" }}>
              {request.lineNumbers || "Not provided"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="receipt-section">
        <div className="receipt-heading">
          <h2>What changed</h2>
        </div>
        {request.requestedChanges.length ? (
          <div className="receipt-notes">
            {request.requestedChanges.map((change) => (
              <article className="receipt-note" key={change.id}>
                <p>{change.description || "No description provided."}</p>
                {change.reason.trim() ? (
                  <p className="receipt-note-reason">{change.reason}</p>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="receipt-caption">
            No written description was provided.
          </p>
        )}
      </section>

      {request.attachments.length ? (
        <section className="receipt-section">
          <div className="receipt-heading">
            <h2>Photos &amp; files</h2>
            <span className="receipt-caption">
              {request.attachments.length} attachment
              {request.attachments.length === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="receipt-files">
            {request.attachments.map((attachment) => (
              <li className="receipt-file" key={attachment.id}>
                <span className="receipt-file-icon">
                  {attachment.kind === "photo" ? (
                    <ImageIcon size={18} />
                  ) : (
                    <FileText size={18} />
                  )}
                </span>
                <span className="receipt-file-main">
                  <strong>{attachment.name}</strong>
                  <small>{fileSize(attachment.size)}</small>
                </span>
                <button
                  type="button"
                  className="button small"
                  aria-label={`Preview ${attachment.name}`}
                  disabled={Boolean(busy)}
                  onClick={() => onPreview(attachment)}
                >
                  <Eye size={15} />
                  Preview
                </button>
                <button
                  type="button"
                  className="button small"
                  aria-label={`Download ${attachment.name}`}
                  disabled={Boolean(busy)}
                  onClick={() => onDownload(attachment)}
                >
                  <Download size={15} />
                  Download
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
