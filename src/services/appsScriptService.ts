/**
 * Client for the Hays + Sons Apps Script database backend.
 *
 * Transport notes (important):
 *  - Apps Script Web Apps do NOT answer CORS preflight requests, so the body is
 *    posted as `text/plain;charset=utf-8` (a CORS "simple request"). Sending
 *    `application/json` would trigger a preflight and fail in the browser.
 *  - Apps Script always returns HTTP 200, even for application errors, so we
 *    branch on the JSON envelope's `ok` field rather than `res.ok`.
 */
import { RestorationJobData } from '../types/jobData';
import { DatabaseError, normalizeDatabaseUrl, requestDatabase } from './appsScriptTransport';
import { APPS_SCRIPT_URL } from '../config/appsScript';
export { DatabaseError } from './appsScriptTransport';

/** Lightweight row used by the job library list (no full record). */
export interface JobSummary {
  recordId: string;
  jobNumber: string;
  jobName: string;
  customerName: string;
  email: string;
  mobilePhone: string;
  lossAddress: string;
  carrier: string;
  claimNumber: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  schemaVersion: number;
  deleted: boolean;
  /** Included when the list is requested with `fullRecords: true`. */
  record?: RestorationJobData;
}

/** The Apps Script deployment bundled into the app. */
export function getDatabaseUrl(): string | null {
  return normalizeDatabaseUrl(APPS_SCRIPT_URL);
}

export function isDatabaseConfigured(): boolean {
  return getDatabaseUrl() !== null;
}

/**
 * DEVELOPER BYPASS — returns the shared secret when one is configured.
 *
 * When this is set, authentication is DISABLED: anyone who obtains the web-app
 * URL can read and write the database. It exists only to unblock local work
 * when the OAuth origin cannot be registered. Never set it in production, and
 * never ship a build containing it.
 */
export function getDevSharedSecret(): string | null {
  const secret = (import.meta.env.VITE_DEV_SHARED_SECRET as string | undefined)?.trim();
  // Guard against accidentally setting a trivially guessable value.
  return secret && secret.length >= 16 ? secret : null;
}

/** True when requests are being sent with the developer shared secret. */
export function isDeveloperBypassEnabled(): boolean {
  return getDevSharedSecret() !== null;
}

/** Credentials attached to an authenticated request. */
export type AuthContext = Record<string, unknown>;

/** Application account as returned by the backend. */
export interface AppUser {
  email: string;
  name: string;
  role: string;
}

interface StoredSession {
  token: string;
  expiresAt: string;
  user: AppUser;
}

const SESSION_STORAGE_KEY = 'hays.db.session';

let currentSession: StoredSession | null = null;
const sessionListeners = new Set<(user: AppUser | null) => void>();

export function subscribeSession(listener: (user: AppUser | null) => void): () => void {
  sessionListeners.add(listener);
  return () => { sessionListeners.delete(listener); };
}

function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed || !parsed.token || !parsed.user?.email || !Number.isFinite(Date.parse(parsed.expiresAt))) return null;
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredSession | null) {
  currentSession = session;
  try {
    if (session) localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode) — memory only */
  }
  for (const listener of sessionListeners) listener(session?.user ?? null);
}

// Restore eagerly so a page reload keeps the user signed in.
if (typeof window !== 'undefined') {
  currentSession = readStoredSession();
}

/** The signed-in application user, or null. */
export function getCurrentUser(): AppUser | null {
  if (currentSession && new Date(currentSession.expiresAt).getTime() <= Date.now()) {
    writeStoredSession(null);
  }
  return currentSession ? currentSession.user : null;
}

/** True when a (locally unexpired) session exists. */
export function hasSession(): boolean {
  return getCurrentUser() !== null;
}

/** Signs in with an application account. Throws {@link DatabaseError} on failure. */
export async function login(email: string, password: string): Promise<AppUser> {
  const result = await callApi<{ token?: string; sessionToken?: string; expiresAt: string; user: AppUser }>(
    'login',
    { email, password }
  );
  const token = result.token || result.sessionToken;
  if (!token) {
    throw new DatabaseError(
      'The database did not return a session token. Redeploy the Apps Script web app and try again.',
      'bad_response'
    );
  }
  writeStoredSession({ token, expiresAt: result.expiresAt, user: result.user });
  return result.user;
}

/** What the login page needs to know before offering "Create account". */
export interface RegistrationInfo {
  /** False when no invite code is configured, i.e. sign-up is switched off. */
  enabled: boolean;
  requiresInviteCode: boolean;
  allowedDomains: string[];
  defaultRole: string;
  minPasswordLength: number;
  sessionHours: number;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  inviteCode: string;
}

/**
 * Asks the backend whether self-service sign-up is available.
 *
 * Never throws: an older deployment without the `registrationInfo` action
 * simply answers `unknown_action`, in which case sign-up is assumed open
 * rather than hiding the affordance.
 */
export async function fetchRegistrationInfo(): Promise<RegistrationInfo> {
  try {
    const info = await callApi<Partial<RegistrationInfo>>('registrationInfo');
    return {
      enabled: info?.enabled !== false,
      requiresInviteCode: info?.requiresInviteCode === true,
      allowedDomains: info?.allowedDomains ?? [],
      defaultRole: info?.defaultRole ?? 'editor',
      minPasswordLength: info?.minPasswordLength ?? 8,
      sessionHours: info?.sessionHours ?? 12,
    };
  } catch {
    // A probe failure must never hide sign-up — treat it as "open".
    return {
      enabled: true,
      requiresInviteCode: false,
      allowedDomains: [],
      defaultRole: 'editor',
      minPasswordLength: 8,
      sessionHours: 12,
    };
  }
}

/**
 * Creates an account and signs in as that user. Throws {@link DatabaseError}
 * when sign-up is disabled, the invite code is wrong, or the email is taken.
 *
 * The backend assigns the role; it can never be `admin` here.
 */
export async function registerAccount(input: RegisterInput): Promise<AppUser> {
  const result = await callApi<{ token?: string; sessionToken?: string; expiresAt: string; user: AppUser }>(
    'register',
    {
      name: input.name,
      email: input.email,
      password: input.password,
      inviteCode: input.inviteCode,
    }
  );
  const token = result.token || result.sessionToken;
  if (!token) {
    throw new DatabaseError(
      'The database did not return a session token. Redeploy the Apps Script web app and try again.',
      'bad_response'
    );
  }
  writeStoredSession({ token, expiresAt: result.expiresAt, user: result.user });
  return result.user;
}

/** Clears the local session and revokes it server-side (best effort). */
export async function logout(): Promise<void> {
  const token = currentSession ? currentSession.token : null;
  writeStoredSession(null);
  if (!token) return;
  try {
    await callApi('logout', { sessionToken: token });
  } catch {
    /* The local session is already gone; a stale server row expires on its own. */
  }
}

/** Confirms the stored session is still valid server-side. */
export async function verifySession(): Promise<AppUser | null> {
  const session = currentSession;
  if (!session) return null;

  const isDead = (err: unknown) =>
    err instanceof DatabaseError &&
    (err.code === 'session_expired' || err.code === 'unauthenticated' || err.code === 'unauthorized');

  const adopt = (user: AppUser) => {
    writeStoredSession({ token: session.token, expiresAt: session.expiresAt, user });
    return user;
  };

  try {
    const result = await callApi<{ user: AppUser }>('checkSession', { sessionToken: session.token });
    return adopt(result.user);
  } catch (err) {
    if (err instanceof DatabaseError && err.code === 'unknown_action') {
      // Older deployments may expose `session` instead.
      try {
        const result = await callApi<{ user: AppUser }>('session', {
          sessionToken: session.token,
        });
        return adopt(result.user);
      } catch (inner) {
        if (isDead(inner)) {
          writeStoredSession(null);
          return null;
        }
        throw inner;
      }
    }
    if (isDead(err)) {
      writeStoredSession(null);
      return null;
    }
    throw err;
  }
}

/**
 * Resolves the credentials for a database call: the developer bypass when it is
 * configured, otherwise the signed-in session token.
 */
export async function acquireAuthContext(): Promise<AuthContext> {
  const secret = getDevSharedSecret();
  if (secret) return { sharedSecret: secret };
  if (getCurrentUser() && currentSession) return { sessionToken: currentSession.token };
  throw new DatabaseError('You are signed out. Please sign in again.', 'no_session');
}

/** True when the failure means "the backend isn't set up", not "the call failed". */
export function isConfigurationError(err: unknown): boolean {
  return err instanceof DatabaseError && err.code === 'not_configured';
}

/**
 * True when the deployment predates an action the client just called, i.e. the
 * script needs to be redeployed with the latest Code.gs.
 */
export function isMissingActionError(err: unknown): boolean {
  return err instanceof DatabaseError && err.code === 'unknown_action';
}

/**
 * Sends one request to the backend and unwraps the JSON envelope.
 * Throws {@link DatabaseError} on any application-level failure.
 */
async function callApi<T>(action: string, payload: Record<string, unknown> = {}, timeoutMs = 30000): Promise<T> {
  const url = getDatabaseUrl();
  if (!url) {
    throw new DatabaseError(
      'The bundled Apps Script deployment URL is invalid. Update src/config/appsScript.ts and rebuild the app.',
      'not_configured'
    );
  }

  try {
    return await requestDatabase<T>(url, action, payload, timeoutMs);
  } catch (err) {
    if (err instanceof DatabaseError && ['session_expired', 'unauthorized', 'unauthenticated'].includes(err.code)
      && payload.sessionToken && payload.sessionToken === currentSession?.token) writeStoredSession(null);
    throw err;
  }
}

/** All document and intake operations use the same Apps Script session as job saves. */
export async function callAuthenticatedAppsScript<T>(action: string, payload: Record<string, unknown> = {}, timeoutMs = 30000): Promise<T> {
  return callApi<T>(action, { ...payload, ...await acquireAuthContext() }, timeoutMs);
}

/** Unauthenticated liveness check. */
export async function pingDatabase(): Promise<{ pong: boolean; schemaVersion: number; time: string }> {
  const data = await callApi<any>('ping');
  return {
    pong: data?.pong === true ? true : data?.status === 'ok',
    schemaVersion: typeof data?.schemaVersion === 'number' ? data.schemaVersion : 0,
    time:
      typeof data?.time === 'string'
        ? data.time
        : typeof data?.timestamp === 'string'
          ? data.timestamp
          : new Date().toISOString(),
  };
}

/** Creates or updates a job. Upsert is keyed on `record.recordId`. */
export async function saveJob(
  auth: AuthContext,
  job: RestorationJobData
): Promise<{ record: RestorationJobData; created: boolean; recordId: string }> {
  const data = await callApi<any>('saveJob', { ...auth, job });
  const acknowledged = data?.record ?? data;
  if (!acknowledged || typeof acknowledged !== 'object' || !acknowledged.recordId
    || acknowledged.recordId !== job.recordId) {
    throw new DatabaseError('The database did not acknowledge this job. Your save remains on this device.', 'bad_response');
  }
  if (data && typeof data === 'object' && data.record) {
    return data as { record: RestorationJobData; created: boolean; recordId: string };
  }
  // Deployments that return the saved record object directly.
  const record = (data && typeof data === 'object' ? data : job) as RestorationJobData;
  const recordId = record.recordId || job.recordId || '';
  return { record: { ...record, recordId }, created: !job.recordId, recordId };
}

/** Lists saved jobs, newest first. */
export async function listJobs(
  auth: AuthContext,
  options: { includeDeleted?: boolean; limit?: number; fullRecords?: boolean } = {}
): Promise<{ jobs: JobSummary[]; count: number }> {
  const data = await callApi<any>('listJobs', { ...auth, ...options });
  if (!Array.isArray(data) && !Array.isArray(data?.jobs)) {
    throw new DatabaseError('The database returned an unreadable customer list.', 'bad_response');
  }
  const jobs: JobSummary[] = Array.isArray(data) ? data : Array.isArray(data?.jobs) ? data.jobs : [];
  return { jobs, count: typeof data?.count === 'number' ? data.count : jobs.length };
}

/** Loads one full job record. */
export async function getJob(
  auth: AuthContext,
  lookup: { recordId?: string; jobNumber?: string }
): Promise<{ job: RestorationJobData; updatedAt: string; updatedBy: string }> {
  const data = await callApi<any>('getJob', { ...auth, ...lookup });
  if (data && typeof data === 'object' && data.job) {
    return data as { job: RestorationJobData; updatedAt: string; updatedBy: string };
  }
  // Deployments that return the record object directly.
  return {
    job: data as RestorationJobData,
    updatedAt: typeof data?.updatedAt === 'string' ? data.updatedAt : '',
    updatedBy: typeof data?.updatedBy === 'string' ? data.updatedBy : '',
  };
}

/** Soft-deletes by default; pass `hard: true` to remove the row entirely. */
export async function deleteJob(
  auth: AuthContext,
  recordId: string,
  hard = false
): Promise<{ deleted: boolean; hard: boolean; recordId: string }> {
  const data = await callApi<any>('deleteJob', { ...auth, recordId, hard });
  return {
    deleted: data?.deleted !== false,
    hard: data?.hard === true || hard,
    recordId: typeof data?.recordId === 'string' && data.recordId ? data.recordId : recordId,
  };
}

/** Free-text search over the indexed columns. */
export async function searchJobs(
  auth: AuthContext,
  query: string,
  options: { includeDeleted?: boolean; limit?: number } = {}
): Promise<{ jobs: JobSummary[]; count: number; query?: string }> {
  try {
    const data = await callApi<any>('searchJobs', { ...auth, query, ...options });
    const jobs: JobSummary[] = Array.isArray(data) ? data : Array.isArray(data?.jobs) ? data.jobs : [];
    return { jobs, count: typeof data?.count === 'number' ? data.count : jobs.length, query };
  } catch (err) {
    if (!(err instanceof DatabaseError) || (err.code !== 'unknown_action' && err.code !== 'bad_request')) {
      throw err;
    }
    // Deployments without a dedicated search action: filter the list here.
    const { jobs } = await listJobs(auth, options);
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? jobs.filter((job) =>
          [job.customerName, job.jobNumber, job.jobName, job.recordId]
            .filter((value) => !!value)
            .some((value) => String(value).toLowerCase().indexOf(needle) !== -1)
        )
      : jobs;
    return { jobs: matches, count: matches.length, query };
  }
}

// ---- shared workspace draft ----------------------------------------------

/**
 * The record the team is currently editing, as stored in the Apps Script
 * database. There is one shared draft, so in-progress work is never stranded in
 * a single browser: it survives a cleared profile, a new device and a different
 * sign-in.
 */
export interface ServerDraft {
  job: RestorationJobData;
  recordId: string;
  updatedAt: string;
  updatedBy: string;
}

/** What the client sends when autosaving the workspace. */
export interface DraftPayload {
  job: RestorationJobData;
  recordId?: string;
  /** Client clock at the moment of the edit, used to resolve local-vs-server. */
  savedAt?: number;
}

/** Stores the shared workspace draft. Throws {@link DatabaseError} on failure. */
export async function saveDraft(auth: AuthContext, draft: DraftPayload): Promise<ServerDraft> {
  const data = await callApi<any>('saveDraft', { ...auth, draft });
  if (!data?.job || typeof data.job !== 'object' || typeof data.updatedAt !== 'string') {
    throw new DatabaseError('The database did not acknowledge your draft. It remains saved on this device.', 'bad_response');
  }
  const job = (data && typeof data === 'object' && data.job ? data.job : draft.job) as RestorationJobData;
  return {
    job,
    recordId: typeof data?.recordId === 'string' ? data.recordId : draft.recordId ?? job.recordId ?? '',
    updatedAt: typeof data?.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
    updatedBy: typeof data?.updatedBy === 'string' ? data.updatedBy : '',
  };
}

/** Reads the shared workspace draft. Returns null when the workspace is empty. */
export async function fetchDraft(auth: AuthContext): Promise<ServerDraft | null> {
  const data = await callApi<any>('getDraft', { ...auth });
  const draft = data && typeof data === 'object' && data.draft ? data.draft : data;
  if (!draft || typeof draft !== 'object' || !draft.job) return null;
  return {
    job: draft.job as RestorationJobData,
    recordId: typeof draft.recordId === 'string' ? draft.recordId : '',
    updatedAt: typeof draft.updatedAt === 'string' ? draft.updatedAt : '',
    updatedBy: typeof draft.updatedBy === 'string' ? draft.updatedBy : '',
  };
}
