/** Apps Script transport shared by sign-in, customer saves and draft sync. */
export class DatabaseError extends Error {
  readonly code: string;

  constructor(message: string, code = 'unknown') {
    super(message);
    this.name = 'DatabaseError';
    this.code = code;
  }
}

/** Drop account-specific paths and query parameters before contacting Google. */
export function normalizeDatabaseUrl(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  // Accept a URL copied from a Markdown link or surrounded by angle brackets.
  const copied = raw.match(/^\[[^\]]*\]\((https:\/\/[^\s)]+)\)$/)?.[1]
    ?? raw.replace(/^<(.*)>$/, '$1');
  try {
    const url = new URL(copied);
    if (url.protocol !== 'https:' || url.hostname !== 'script.google.com'
      || url.port || url.username || url.password) return null;
    const path = url.pathname.match(/^\/macros\/(?:u\/\d+\/)?s\/([\w-]+)\/exec\/?$/);
    return path ? `https://script.google.com/macros/s/${path[1]}/exec` : null;
  } catch {
    return null;
  }
}

function unreadableResponse(response: Response, body: string): DatabaseError {
  // Never include Google's raw HTML: it can contain account details or tokens.
  if (/accounts\.google\.com|ServiceLogin|Sign in with Google|Sign in - Google/i.test(response.url + body)) {
    return new DatabaseError(
      'Google is requiring sign-in for the database. Set the Apps Script web app to Execute as Me and access Anyone, then update its deployment.',
      'bad_response'
    );
  }
  if (response.status === 404 || response.status === 410
    || /unable to open the file|file you have requested does not exist|page not found/i.test(body)) {
    return new DatabaseError(
      'The Apps Script deployment is no longer available. Update src/config/appsScript.ts to the active Apps Script /exec URL and rebuild the app.',
      'bad_response'
    );
  }
  return new DatabaseError(
    'The database returned an invalid response. Confirm the app uses the current /exec URL and deploy the latest Code.gs as a new version. Your changes remain queued on this device.',
    'bad_response'
  );
}

export async function requestDatabase<T>(
  url: string,
  action: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 30000
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      // Apps Script cannot answer CORS preflights; keep this a simple request.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...payload, action }),
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
    });
    // Keep the timeout active through the redirected response body as well.
    const body = await response.text();
    if (response.status === 429 || response.status >= 500) {
      throw new DatabaseError('The database is temporarily unavailable. Your changes will retry automatically.', 'network_error');
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(body);
    } catch {
      throw unreadableResponse(response, body);
    }
    if (!response.ok || !envelope || typeof envelope !== 'object'
      || !('ok' in envelope) || typeof envelope.ok !== 'boolean') {
      throw unreadableResponse(response, body);
    }
    const result = envelope as { ok: boolean; data?: T; error?: unknown; code?: unknown };
    if (!result.ok) {
      throw new DatabaseError(
        typeof result.error === 'string' ? result.error : 'The database rejected the request.',
        typeof result.code === 'string' ? result.code : 'unknown'
      );
    }
    if (!('data' in result)) throw unreadableResponse(response, body);
    return result.data as T;
  } catch (err) {
    if (err instanceof DatabaseError) throw err;
    if (controller.signal.aborted) {
      throw new DatabaseError('The database request timed out. Please try again.', 'timeout');
    }
    throw new DatabaseError(
      'Could not reach the customer database. Check your connection and that the web app is deployed.',
      'network_error'
    );
  } finally {
    clearTimeout(timer);
  }
}
