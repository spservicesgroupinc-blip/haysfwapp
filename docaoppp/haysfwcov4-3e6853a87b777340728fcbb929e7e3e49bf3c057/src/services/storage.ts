import type {
  AttachmentKind,
  ChangeRequest,
  JobEntry,
  RequestAttachment,
  RequestStatus,
  RequestSummary,
} from "../types";

export class ApiError extends Error {
  constructor(
    message: string,
    public code = "SERVICE_ERROR",
    public currentRevision?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function apiFailure(
  payload: { error?: string; code?: string; currentRevision?: number } | null,
): never {
  throw new ApiError(
    payload?.error || "The sync service is unavailable.",
    payload?.code,
    payload?.currentRevision,
  );
}

function env(name: string): string | undefined {
  const value = (
    import.meta as unknown as {
      env?: Record<string, string | undefined>;
    }
  ).env;
  return value?.[name];
}

const STORAGE_KEY_REQUESTS = "hays_change_orders_requests";
const STORAGE_KEY_JOBS = "hays_change_orders_jobs";
const STORAGE_KEY_ATTACHMENTS = "hays_change_orders_attachments";
// Seed data used when running offline or in demo mode without remote Google Sheets
const INITIAL_DEMO_JOBS: JobEntry[] = [
  {
    id: "j1",
    jobNumber: "F-26-0366-P",
    customer: "York Ridge Apartments",
    address: "1200 York St, Fort Wayne, IN 46802",
    projectManager: "Dana Whitfield",
    estimator: "Marcus Vance",
    status: "Active",
    customerPhone: "260-555-0144",
    customerEmail: "dana@yorkridge.example.com",
    contractAmount: "167045.81",
    active: true,
    updatedAt: "2026-10-01T12:00:00.000Z",
  },
  {
    id: "j2",
    jobNumber: "I-26-1042-W",
    customer: "Beacon Health Pavilion",
    address: "500 E Jefferson Blvd, South Bend, IN 46601",
    projectManager: "Sarah Jenkins",
    estimator: "Marcus Vance",
    status: "Active",
    customerPhone: "574-555-0199",
    customerEmail: "sjenkins@beacon.example.com",
    contractAmount: "84210.00",
    active: true,
    updatedAt: "2026-10-05T09:30:00.000Z",
  },
  {
    id: "j3",
    jobNumber: "F-26-0411-C",
    customer: "Summit City Commerce Center",
    address: "3100 Executive Pkwy, Fort Wayne, IN 46808",
    projectManager: "Dana Whitfield",
    estimator: "Marcus Vance",
    status: "Active",
    customerPhone: "260-555-0211",
    customerEmail: "facilities@summitcity.example.com",
    contractAmount: "215400.50",
    active: true,
    updatedAt: "2026-10-08T15:00:00.000Z",
  },
];

const INITIAL_DEMO_REQUESTS: ChangeRequest[] = [
  {
    schemaVersion: 2,
    id: "req-1",
    revision: 1,
    createdAt: "2026-10-01T12:00:00.000Z",
    updatedAt: "2026-10-01T12:00:00.000Z",
    status: "submitted",
    estimatorName: "",
    submittedAt: "2026-10-01T12:00:00.000Z",
    informationQuestion: "",
    job: {
      customer: "York Ridge Apartments",
      customerPhone: "260-555-0144",
      customerEmail: "dana@yorkridge.example.com",
      address: "1200 York St, Fort Wayne, IN 46802",
      jobNumber: "F-26-0366-P",
      projectManager: "Dana Whitfield",
      branchName: "Hays + Sons Complete Restoration",
      branchAddress: "909 Production Road, Fort Wayne, IN 46808",
      branchPhone: "1-260-471-9110",
      branchContact: "",
      carrier: "State Farm",
      claim: "CLM-99201",
      orderNumber: "CO-01",
      date: "2026-10-01",
      insuranceRelated: true,
      originalContract: "167045.81",
      previousChanges: "0.00",
      addedDays: "0",
    },
    requestedChanges: [
      {
        id: "c1",
        room: "Kitchen",
        action: "add",
        description:
          "Wet insulation behind kitchen drywall requires removal and replacement.",
        reason: "Discovered moisture intrusion during demolition.",
        measurements: "12 LF x 8 FT",
        materials: "R-13 Kraft Faced Batt",
        scheduleImpact: "1 day",
      },
    ],
    attachments: [],
  },
  {
    schemaVersion: 2,
    id: "req-2",
    revision: 2,
    createdAt: "2026-10-05T09:30:00.000Z",
    updatedAt: "2026-10-06T14:15:00.000Z",
    status: "in_review",
    estimatorName: "Marcus Vance",
    submittedAt: "2026-10-05T09:30:00.000Z",
    informationQuestion: "",
    job: {
      customer: "Beacon Health Pavilion",
      customerPhone: "574-555-0199",
      customerEmail: "sjenkins@beacon.example.com",
      address: "500 E Jefferson Blvd, South Bend, IN 46601",
      jobNumber: "I-26-1042-W",
      projectManager: "Sarah Jenkins",
      branchName: "Hays + Sons Complete Restoration",
      branchAddress: "909 Production Road, Fort Wayne, IN 46808",
      branchPhone: "1-260-471-9110",
      branchContact: "",
      carrier: "Travelers",
      claim: "TRV-88319-A",
      orderNumber: "CO-02",
      date: "2026-10-05",
      insuranceRelated: true,
      originalContract: "84210.00",
      previousChanges: "0.00",
      addedDays: "2",
    },
    requestedChanges: [
      {
        id: "c2",
        room: "Suite 104 Entryway",
        action: "revise",
        description:
          "Upgrade commercial grade vinyl tile to match existing corridor transition.",
        reason: "Owner request for seamless aesthetic match.",
        measurements: "240 SF",
        materials: "Armstrong Commercial VCT",
        scheduleImpact: "0 days",
      },
    ],
    attachments: [],
  },
];

function getLocalRequests(): ChangeRequest[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_REQUESTS);
    if (raw) return JSON.parse(raw);
  } catch {
    // fallback
  }
  return [...INITIAL_DEMO_REQUESTS];
}

function saveLocalRequests(items: ChangeRequest[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_REQUESTS, JSON.stringify(items));
  } catch {
    // quota exceeded or private mode
  }
}

/**
 * Requests this device has already loaded, without the demo seed. Read-only
 * callers (linking a customer to its change orders) use this instead of
 * `getLocalRequests`, which invents demo rows on an empty device.
 */
export function cachedRequests(): ChangeRequest[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_REQUESTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChangeRequest[]) : [];
  } catch {
    return [];
  }
}

function getLocalJobs(): JobEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_JOBS);
    if (raw) return JSON.parse(raw);
  } catch {
    // fallback
  }
  return [...INITIAL_DEMO_JOBS];
}

function saveLocalJobs(items: JobEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_JOBS, JSON.stringify(items));
  } catch {
    // quota exceeded or private mode
  }
}

/**
 * The job directory the app last loaded from the backend. Unlike
 * `getLocalJobs` this never invents demo rows, so callers can trust it as
 * evidence that a job was really imported.
 */
export function cachedJobDirectory(): JobEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_JOBS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as JobEntry[]) : [];
  } catch {
    return [];
  }
}

/** Cache shared lookup rows for offline pickers and customer job counts. */
export function cacheJobDirectory(jobs: JobEntry[]): void {
  saveLocalJobs(jobs);
}

function getLocalAttachment(attachmentId: string): { name: string; mimeType: string; data: string } | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_ATTACHMENTS}_${attachmentId}`);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return null;
}

function saveLocalAttachment(attachmentId: string, item: { name: string; mimeType: string; data: string }): void {
  try {
    localStorage.setItem(`${STORAGE_KEY_ATTACHMENTS}_${attachmentId}`, JSON.stringify(item));
  } catch {
    // ignore
  }
}

function summarizeRequest(r: ChangeRequest): RequestSummary {
  return {
    ...(r.workspaceId ? { workspaceId: r.workspaceId } : {}),
    ...(r.customerId ? { customerId: r.customerId } : {}),
    id: r.id,
    revision: r.revision,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    status: r.status,
    estimatorName: r.estimatorName || "",
    changesCount: (r.requestedChanges || []).length,
    attachmentsCount: (r.attachments || []).length,
    job: {
      customer: r.job?.customer || "",
      jobNumber: r.job?.jobNumber || "",
      projectManager: r.job?.projectManager || "",
      orderNumber: r.job?.orderNumber || "",
      address: r.job?.address || "",
    },
  };
}

// Configured remote Apps Script URL
export const DEFAULT_APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzfOdHMBwnGihZI9gvj4M-UkH-oxoR2vhRlrY0QqOYU8tB-MTspqR07aODoBHQy3uhe/exec";

const rawConfiguredUrl = env("VITE_APPS_SCRIPT_URL");
export const API_URL =
  rawConfiguredUrl &&
  (rawConfiguredUrl.startsWith("http://") ||
    rawConfiguredUrl.startsWith("https://"))
    ? rawConfiguredUrl
    : DEFAULT_APPS_SCRIPT_URL;

const isRemoteConfigured = true;

function query(params: Record<string, string | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
}

async function requestJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    const trimmed = text.trim();
    if (trimmed.startsWith("<") || trimmed.startsWith("The page")) {
      if (!response.ok) {
        throw new ApiError(
          `Service returned HTTP ${response.status} (${response.statusText || "error"})`,
        );
      }
      throw new ApiError(
        "The sync service returned an HTML error response instead of JSON.",
      );
    }
    try {
      return JSON.parse(text);
    } catch {
      if (!response.ok) {
        throw new ApiError(
          `Service returned HTTP ${response.status} (${response.statusText || "error"})`,
        );
      }
      throw new ApiError("The sync service returned an invalid response.");
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(
        "The sync service did not respond in time. Try again.",
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function get<T>(params: Record<string, string | undefined>): Promise<T> {
  if (!isRemoteConfigured) {
    // In production (e.g. Vercel) where Vite dev server middleware isn't present
    // and no remote Apps Script URL is configured, use robust local storage.
    const action = params.action;
    if (action === "bootstrap") {
      const requests = getLocalRequests().map(summarizeRequest);
      const jobs = getLocalJobs();
      return { ok: true, requests, jobs } as unknown as T;
    }
    if (action === "listRequests") {
      const requests = getLocalRequests().map(summarizeRequest);
      return { ok: true, requests } as unknown as T;
    }
    if (action === "listJobs") {
      const jobs = getLocalJobs();
      return { ok: true, jobs } as unknown as T;
    }
    if (action === "openRequest") {
      const req = getLocalRequests().find((r) => r.id === params.id);
      if (!req) throw new ApiError("Request not found", "NOT_FOUND");
      return { ok: true, request: req } as unknown as T;
    }
    if (action === "fetchAttachment") {
      const item = getLocalAttachment(params.attachmentId || "");
      if (!item) throw new ApiError("Attachment not found", "NOT_FOUND");
      return { ok: true, ...item } as unknown as T;
    }
  }

  const separator = API_URL.includes("?") ? "&" : "?";
  const payload = await requestJson(
    `${API_URL}${separator}${query(params)}`,
    {},
    20000,
  );
  if (!payload || payload.ok === false) apiFailure(payload);
  return payload as T;
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  if (!isRemoteConfigured) {
    const action = body.action as string;
    const now = new Date().toISOString();

    if (action === "saveRequest") {
      const incoming = body.request as ChangeRequest;
      const requests = getLocalRequests();
      const existingIdx = requests.findIndex((r) => r.id === incoming.id);
      if (existingIdx >= 0) {
        const updated: ChangeRequest = {
          ...incoming,
          revision: (requests[existingIdx].revision || 0) + 1,
          updatedAt: now,
        };
        requests[existingIdx] = updated;
        saveLocalRequests(requests);
        return { ok: true, request: updated } as unknown as T;
      } else {
        const created: ChangeRequest = {
          ...incoming,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        };
        requests.unshift(created);
        saveLocalRequests(requests);
        return { ok: true, request: created } as unknown as T;
      }
    }

    if (action === "claimRequest") {
      const requests = getLocalRequests();
      const target = requests.find((r) => r.id === body.id);
      if (!target) throw new ApiError("Request not found", "NOT_FOUND");
      target.estimatorName = String(body.estimatorName || "");
      target.status = "in_review";
      target.revision = (target.revision || 0) + 1;
      target.updatedAt = now;
      saveLocalRequests(requests);
      return { ok: true, request: target } as unknown as T;
    }

    if (action === "transitionRequest") {
      const requests = getLocalRequests();
      const target = requests.find((r) => r.id === body.id);
      if (!target) throw new ApiError("Request not found", "NOT_FOUND");
      target.status = body.status as RequestStatus;
      if (body.question !== undefined) {
        target.informationQuestion = String(body.question || "");
      }
      target.revision = (target.revision || 0) + 1;
      target.updatedAt = now;
      saveLocalRequests(requests);
      return { ok: true, request: target } as unknown as T;
    }

    if (action === "uploadAttachment") {
      const { requestId, attachmentId, file } = body as {
        requestId: string;
        attachmentId: string;
        file: AttachmentUpload;
      };
      const requests = getLocalRequests();
      const target = requests.find((r) => r.id === requestId);
      if (!target) throw new ApiError("Request not found", "NOT_FOUND");
      const record: RequestAttachment = {
        id: attachmentId,
        kind: file.kind,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        driveFileId: attachmentId,
      };
      saveLocalAttachment(attachmentId, {
        name: file.name,
        mimeType: file.mimeType,
        data: file.data,
      });
      target.attachments = [...(target.attachments || []), record];
      target.updatedAt = now;
      saveLocalRequests(requests);
      return { ok: true, attachment: record } as unknown as T;
    }

    if (action === "importJobs") {
      const jobs = Array.isArray(body.jobs) ? (body.jobs as JobEntry[]) : [];
      saveLocalJobs(jobs);
      return { ok: true, jobs } as unknown as T;
    }

    if (action === "deleteRequest") {
      const requests = getLocalRequests().filter((r) => r.id !== body.id);
      saveLocalRequests(requests);
      return { ok: true, id: body.id, message: "Request deleted." } as unknown as T;
    }

    if (action === "sendEmail") {
      const { recipient } = body as { recipient: string; requestId?: string; request?: ChangeRequest };
      const requests = getLocalRequests();
      const target = requests.find((r) => r.id === body.requestId) || (body.request as ChangeRequest | undefined);
      const count = target?.attachments?.length || 0;
      return {
        ok: true,
        recipient,
        attachmentCount: count,
        message: `Email sent successfully to ${recipient} with ${count} attachment(s).`,
      } as unknown as T;
    }
  }

  try {
    const payload = await requestJson(
      API_URL,
      {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body),
      },
      60000,
    );
    if (!payload || payload.ok === false) apiFailure(payload);
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // If remote fails, fallback gracefully for offline/demo capabilities
    if (body.action === "deleteRequest") {
      const requests = getLocalRequests().filter((r) => r.id !== body.id);
      saveLocalRequests(requests);
      return { ok: true, id: body.id, message: "Request deleted locally." } as unknown as T;
    }
    if (body.action === "importJobs" && Array.isArray(body.jobs)) {
      saveLocalJobs(body.jobs as JobEntry[]);
      return { ok: true, jobs: body.jobs } as unknown as T;
    }
    // A local copy cannot confirm a save to the shared backend.
    throw error;
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(data: string, mimeType: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || "application/pdf" });
}

export async function listRequests(): Promise<RequestSummary[]> {
  const data = await get<{ requests: RequestSummary[] }>({
    action: "listRequests",
  });
  return data.requests;
}

export async function openRequest(id: string): Promise<ChangeRequest> {
  const data = await get<{ request: ChangeRequest }>({
    action: "openRequest",
    id,
  });
  const request = data?.request;
  if (!request || typeof request !== "object" || !request.id || !request.job)
    throw new Error("That change order could not be loaded.");
  return request;
}

export async function saveRequest(
  request: ChangeRequest,
  expectedRevision: number,
  mutationId: string,
): Promise<ChangeRequest> {
  const data = await post<{ request: ChangeRequest }>({
    action: "saveRequest",
    request,
    expectedRevision,
    mutationId,
  });
  return data.request;
}

export async function claimRequest(
  id: string,
  expectedRevision: number,
  estimatorName: string,
  mutationId: string,
): Promise<ChangeRequest> {
  const data = await post<{ request: ChangeRequest }>({
    action: "claimRequest",
    id,
    expectedRevision,
    estimatorName,
    mutationId,
  });
  return data.request;
}

export async function transitionRequest(
  id: string,
  expectedRevision: number,
  status: RequestStatus,
  question: string,
  mutationId: string,
): Promise<ChangeRequest> {
  const data = await post<{ request: ChangeRequest }>({
    action: "transitionRequest",
    id,
    expectedRevision,
    status,
    question,
    mutationId,
  });
  return data.request;
}

export interface AttachmentUpload {
  name: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  data: string;
}

export async function uploadAttachment(
  requestId: string,
  file: AttachmentUpload,
  attachmentId: string,
  mutationId: string,
): Promise<RequestAttachment> {
  const data = await post<{ attachment: RequestAttachment }>({
    action: "uploadAttachment",
    requestId,
    attachmentId,
    mutationId,
    file,
  });
  return data.attachment;
}

export async function fetchAttachment(
  requestId: string,
  attachmentId: string,
): Promise<{ name: string; blob: Blob }> {
  const data = await get<{ name: string; mimeType: string; data: string }>({
    action: "fetchAttachment",
    requestId,
    attachmentId,
  });
  return { name: data.name, blob: base64ToBlob(data.data, data.mimeType) };
}

export async function listJobs(): Promise<JobEntry[]> {
  const data = await get<{ jobs: JobEntry[] }>({ action: "listJobs" });
  return data.jobs;
}

export async function importJobs(jobs: JobEntry[]): Promise<JobEntry[]> {
  const data = await post<{ jobs: JobEntry[] }>({ action: "importJobs", jobs });
  const saved = Array.isArray(data.jobs) ? data.jobs : jobs;
  saveLocalJobs(saved);
  return saved;
}

export async function deleteRequest(
  id: string,
): Promise<{ ok: boolean; message?: string }> {
  const data = await post<{ ok: boolean; message?: string }>({
    action: "deleteRequest",
    id,
  });
  const localRequests = getLocalRequests().filter((r) => r.id !== id);
  saveLocalRequests(localRequests);
  return data;
}

export async function sendRequestEmail(
  requestId: string,
  recipient: string,
  subject?: string,
  request?: ChangeRequest,
): Promise<{ ok: boolean; message?: string; attachmentCount?: number }> {
  const data = await post<{
    ok: boolean;
    message?: string;
    attachmentCount?: number;
    recipient?: string;
  }>({
    action: "sendEmail",
    requestId,
    recipient,
    subject,
    request,
  });
  return data;
}

export interface DashboardData {
  requests: RequestSummary[];
  jobs: JobEntry[];
  /** True when the job list is the offline seed, not something a user imported. */
  jobsAreDemo?: boolean;
}

export async function loadDashboard(): Promise<DashboardData> {
  try {
    const data = await get<{
      requests: RequestSummary[];
      jobs: JobEntry[];
    }>({ action: "bootstrap" });
    const requests = data.requests ?? [];
    const jobs = data.jobs ?? [];
    saveLocalJobs(jobs);
    return {
      requests,
      jobs,
    };
  } catch (error) {
    try {
      const [requests] = await Promise.all([listRequests()]);
      let jobs: JobEntry[] = [];
      try {
        jobs = await listJobs();
        saveLocalJobs(jobs);
      } catch {
        // jobs optional
      }
      return { requests, jobs };
    } catch {
      // Last-resort fallback to local storage
      return {
        requests: getLocalRequests().map(summarizeRequest),
        jobs: getLocalJobs(),
        // Nothing was ever saved, so this is the built-in seed, not a report.
        jobsAreDemo: cachedJobDirectory().length === 0,
      };
    }
  }
}
