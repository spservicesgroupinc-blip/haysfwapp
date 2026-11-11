export type RequestStatus =
  | "submitted"
  | "in_review"
  | "needs_information"
  | "completed";
/** Lifecycle of a permanent job record (see Workspace.stage). */
export type JobStage = "lead" | "in_progress" | "complete" | "closed";
export type AttachmentKind = "estimate" | "quote" | "photo" | "document";
export interface RequestedChange {
  id: string;
  room: string;
  action: "add" | "revise" | "remove";
  description: string;
  reason: string;
  measurements: string;
  materials: string;
  scheduleImpact: string;
}
export interface RequestAttachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  driveFileId: string;
}
export interface ChangeRequest {
  /** Permanent shared job; request.job remains an independent historical snapshot. */
  workspaceId?: string;
  /** CRM customer this change order belongs to, when the customer is known. */
  customerId?: string;
  schemaVersion: 2;
  requestType?: "change_order" | "insurance_supplement";
  customerCredits?: boolean;
  /** Optional PM-provided amount, signed as an increase (+) or deduction (-). */
  knownChangeAmount?: string;
  /** Signed estimate line references, e.g. +12, -34; kept as submitted text. */
  lineNumbers?: string;
  finalChangeOrder?: { scope: string; amount: string };
  /** Exact customer PDF saved in this request's Drive folder. */
  customerDocument?: {
    attachmentId: string;
    inputFingerprint: string;
    templateVersion: number;
  };
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  status: RequestStatus;
  estimatorName: string;
  submittedAt: string | null;
  informationQuestion: string;
  job: JobDetails;
  requestedChanges: RequestedChange[];
  attachments: RequestAttachment[];
  // Job directory row this request's job number was matched to, so the
  // original contract amount can be traced back to the uploaded report.
  jobDirectoryId?: string;
}
export interface RequestSummary {
  workspaceId?: string;
  customerId?: string;
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  status: RequestStatus;
  estimatorName: string;
  changesCount: number;
  attachmentsCount: number;
  job: Pick<
    JobDetails,
    "customer" | "jobNumber" | "projectManager" | "orderNumber" | "address"
  >;
}
export interface JobDetails {
  customer: string;
  customerPhone?: string;
  customerEmail?: string;
  address: string;
  jobNumber: string;
  projectManager: string;
  branchName: string;
  branchAddress: string;
  branchPhone: string;
  branchContact: string;
  carrier: string;
  claim: string;
  orderNumber: string;
  date: string;
  insuranceRelated: boolean;
  originalContract: string;
  previousChanges: string;
  addedDays: string;
}
// A row in the job directory, imported from the Dash JobSummaryReport on the
// Jobs page and read from the Jobs sheet. The PM picks one to autofill the
// request's job details.
export interface JobEntry {
  id: string;
  jobNumber: string;
  customer: string;
  address: string;
  /** Structured loss/property location retained from the CSV, when provided. */
  jobAddress?: string;
  city?: string;
  state?: string;
  zip?: string;
  carrier?: string;
  claim?: string;
  secondaryEmail?: string;
  supervisor?: string;
  foreman?: string;
  dateInspected?: string;
  startDate?: string;
  finishDate?: string;
  projectManager: string;
  estimator: string;
  status: string;
  customerPhone: string;
  customerEmail: string;
  // Original contract amount from the report, normalized to the app's
  // canonical decimal string (e.g. "167045.81"); "" when the export carries no
  // amount for the job.
  contractAmount: string;
  active: boolean;
  updatedAt: string;
}
export const newId = () => crypto.randomUUID();
export function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
