/**
 * Google Identity Services (GIS) wrapper.
 *
 * Obtains a Google **ID token** (a signed JWT) for the signed-in user. The token
 * is sent to the Apps Script backend, which verifies it server-side against
 * Google before serving any data. The client never holds a client secret.
 *
 * Unlike the previous Firebase flow, the credential is persisted to
 * localStorage with its real expiry, so a page reload no longer silently signs
 * the user out.
 */

const STORAGE_KEY = 'hays.google.idCredential';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

export interface GoogleIdentity {
  /** Signed-in email address. */
  email: string;
  /** Display name, when provided by the token. */
  name?: string;
  /** Picture URL, when provided. */
  picture?: string;
  /** Raw JWT to send to the backend. */
  token: string;
  /** Unix seconds at which the token expires. */
  expiresAt: number;
}

interface JwtPayload {
  email?: string;
  name?: string;
  picture?: string;
  exp?: number;
  aud?: string;
  email_verified?: boolean | string;
}

type Listener = (identity: GoogleIdentity | null) => void;

let gisScriptPromise: Promise<void> | null = null;
let clientId: string | null = null;
let initialized = false;
let current: GoogleIdentity | null = null;
let pendingPrompt: { resolve: (token: string) => void; reject: (err: Error) => void; timer: number } | null = null;

const listeners = new Set<Listener>();

/** Reads the configured OAuth Web client id. */
export function getClientId(): string | null {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || null;
}

export function isIdentityConfigured(): boolean {
  return getClientId() !== null;
}

/** Decodes a JWT payload without verifying it (the server does verification). */
function decodeJwt(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const json = decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

function toIdentity(token: string): GoogleIdentity | null {
  const payload = decodeJwt(token);
  if (!payload?.email || !payload.exp) return null;
  return {
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
    token,
    expiresAt: Number(payload.exp),
  };
}

function isExpired(identity: GoogleIdentity, skewSeconds = 60): boolean {
  return identity.expiresAt * 1000 - skewSeconds * 1000 <= Date.now();
}

function persist(identity: GoogleIdentity | null) {
  try {
    if (identity) localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: identity.token }));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode) — memory only */
  }
}

function restore(): GoogleIdentity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: string };
    if (!parsed.token) return null;
    const identity = toIdentity(parsed.token);
    if (!identity || isExpired(identity)) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return identity;
  } catch {
    return null;
  }
}

function emit() {
  listeners.forEach((listener) => listener(current));
}

/** Subscribes to sign-in state. Returns an unsubscribe function. */
export function onIdentityChange(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

/** Returns the current identity if it is still valid, otherwise null. */
export function getIdentity(): GoogleIdentity | null {
  if (current && isExpired(current)) {
    current = null;
    persist(null);
  }
  return current;
}

function handleCredentialResponse(response: { credential?: string }) {
  if (!response?.credential) return;
  const identity = toIdentity(response.credential);
  if (!identity) return;

  current = identity;
  persist(identity);
  emit();

  if (pendingPrompt) {
    window.clearTimeout(pendingPrompt.timer);
    pendingPrompt.resolve(response.credential);
    pendingPrompt = null;
  }
}

/** Loads the GIS library once. */
function loadGis(): Promise<void> {
  if (gisScriptPromise) return gisScriptPromise;

  gisScriptPromise = new Promise<void>((resolve, reject) => {
    if (typeof window !== 'undefined' && (window as any).google?.accounts?.id) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    const script = existing ?? document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('Could not load Google Sign-In. Check your connection.')));
    if (!existing) document.head.appendChild(script);
  });

  return gisScriptPromise;
}

/** Loads GIS and initialises it for the configured client id. Idempotent. */
export async function initIdentity(): Promise<boolean> {
  const id = getClientId();
  if (!id) return false;

  await loadGis();

  if (!initialized || clientId !== id) {
    const google = (window as any).google;
    if (!google?.accounts?.id) throw new Error('Google Sign-In failed to initialise.');

    google.accounts.id.initialize({
      client_id: id,
      callback: handleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true,
      use_fedcm_for_prompt: true,
    });

    clientId = id;
    initialized = true;
  }

  if (!current) {
    const restored = restore();
    if (restored) {
      current = restored;
      emit();
    }
  }

  return true;
}

/**
 * Turns a Google Identity Services failure reason into an actionable message.
 * The raw reason codes are documented under "PromptMomentNotification".
 */
function describeSignInFailure(reason: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'this origin';

  switch (reason) {
    case 'unregistered_origin':
      return (
        `Google rejected the sign-in because ${origin} is not a registered origin. ` +
        'Open Google Cloud Console → APIs & Services → Credentials, edit the OAuth 2.0 "Web application" ' +
        `client, and add ${origin} under "Authorised JavaScript origins". Changes can take a few minutes.`
      );
    case 'invalid_client':
      return 'The OAuth client ID was rejected. Check that VITE_GOOGLE_CLIENT_ID matches the Web client in Google Cloud Console.';
    case 'missing_client_id':
      return 'No OAuth client ID is configured. Set VITE_GOOGLE_CLIENT_ID and restart the dev server.';
    case 'secure_http_required':
      return 'Google Sign-In requires HTTPS. Use https:// or serve the app from http://localhost.';
    case 'browser_not_supported':
      return 'This browser does not support Google Sign-In. Try Chrome, Edge or Safari.';
    case 'opt_out_or_no_session':
      return 'No Google account is signed in to this browser, or sign-in was previously dismissed. Sign in to Google in this browser, then try again.';
    case 'suppressed_by_user':
      return 'Google Sign-In was dismissed. Click "Sign in with Google" to try again.';
    case 'unregistered_origin_redirect_uri_mismatch':
      return `Google rejected ${origin}. Check the OAuth client's "Authorised JavaScript origins".`;
    default:
      return (
        'Google Sign-In could not be displayed. Open the browser console for the exact reason, ' +
        `then confirm ${origin} is listed under "Authorised JavaScript origins" for your OAuth client.`
      );
  }
}

/**
 * Resolves with a valid ID token, prompting the user to sign in if needed.
 * Rejects quickly and actionably when Google refuses to display the prompt.
 */
export async function requestIdToken(timeoutMs = 60000): Promise<string> {
  const existing = getIdentity();
  if (existing) return existing.token;

  if (!(await initIdentity())) {
    throw new Error('Google sign-in is not configured (missing VITE_GOOGLE_CLIENT_ID).');
  }

  const google = (window as any).google;

  return new Promise<string>((resolve, reject) => {
    const fail = (message: string) => {
      if (!pendingPrompt) return;
      window.clearTimeout(pendingPrompt.timer);
      pendingPrompt = null;
      reject(new Error(message));
    };

    pendingPrompt = {
      resolve,
      reject,
      timer: window.setTimeout(() => {
        pendingPrompt = null;
        reject(
          new Error(
            'Sign-in was not completed. If no Google prompt appeared, check the browser console — ' +
              'the most common cause is an unregistered JavaScript origin for the OAuth client.'
          )
        );
      }, timeoutMs),
    };

    try {
      google.accounts.id.prompt((notification: any) => {
        if (!pendingPrompt) return;

        // Google refused to render the prompt at all — terminal, so report why.
        if (notification?.isNotDisplayedMoment?.()) {
          fail(describeSignInFailure(String(notification.getNotDisplayedReason?.() || 'unknown_reason')));
          return;
        }

        if (notification?.isSkippedMoment?.()) {
          fail(describeSignInFailure(String(notification.getSkippedReason?.() || 'suppressed_by_user')));
          return;
        }

        if (notification?.isDismissedMoment?.()) {
          fail(describeSignInFailure('suppressed_by_user'));
        }
      });
    } catch (err: any) {
      fail(err instanceof Error ? err.message : String(err));
    }
  });
}

/** Renders the official Google button into a container element. */
export async function renderSignInButton(
  container: HTMLElement,
  options: { theme?: 'outline' | 'filled_blue' | 'filled_black'; size?: 'large' | 'medium' | 'small'; text?: string } = {}
): Promise<void> {
  if (!(await initIdentity())) return;
  const google = (window as any).google;
  google.accounts.id.renderButton(container, {
    type: 'standard',
    theme: options.theme ?? 'outline',
    size: options.size ?? 'large',
    text: options.text ?? 'signin_with',
    shape: 'rectangular',
    logo_alignment: 'left',
  });
}

/** Clears the local session. */
export function signOutIdentity(): void {
  current = null;
  persist(null);
  try {
    (window as any).google?.accounts?.id?.disableAutoSelect();
  } catch {
    /* ignore */
  }
  if (pendingPrompt) {
    window.clearTimeout(pendingPrompt.timer);
    pendingPrompt = null;
  }
  emit();
}

// Restore eagerly so a reload keeps the session.
if (typeof window !== 'undefined') {
  const restored = restore();
  if (restored) current = restored;
}
