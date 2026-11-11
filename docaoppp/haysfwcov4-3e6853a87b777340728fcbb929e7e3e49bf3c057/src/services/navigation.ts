/**
 * Hash routing for the change-order shell.
 *
 * The app is installed as a standalone PWA, so on a phone the operating
 * system's back gesture is the only "back" the user has. Every view therefore
 * owns a real history entry: back steps through the app instead of closing it,
 * and any view can be linked to or bookmarked.
 */
export type View =
  | { kind: "dashboard" }
  | { kind: "review" }
  | { kind: "request"; id: string }
  | { kind: "workspaces"; tool?: "migration" | "reference" }
  | { kind: "workspace"; id: string }
  | { kind: "jobs" }
  | { kind: "simple" }
  | { kind: "customers" }
  | { kind: "customer"; id: string };

/** The sections the app header can jump between. */
export type NavDestination =
  | "home"
  | "simple"
  | "review"
  | "jobs"
  | "workspaces"
  | "migration"
  | "reference"
  | "customers";

export const DASHBOARD: View = { kind: "dashboard" };
export const REVIEW: View = { kind: "review" };
export const HOME: View = DASHBOARD;

const VIEW_KEY = "hays-active-view";

export function destinationToView(destination: NavDestination): View {
  if (destination === "home") return DASHBOARD;
  if (destination === "migration" || destination === "reference") return { kind: "workspaces", tool: destination };
  if (destination === "simple") return { kind: "simple" };
  if (destination === "jobs") return { kind: "jobs" };
  if (destination === "workspaces") return { kind: "workspaces" };
  if (destination === "customers") return { kind: "customers" };
  return REVIEW;
}

export function viewToHash(view: View): string {
  switch (view.kind) {
    case "dashboard":
      return "#/";
    case "workspaces":
      return `#/workspaces${view.tool ? `?tool=${view.tool}` : ""}`;
    case "workspace":
      return `#/workspaces/${encodeURIComponent(view.id)}`;
    case "request":
      return `#/requests/${encodeURIComponent(view.id)}`;
    case "customer":
      return `#/customers/${encodeURIComponent(view.id)}`;
    case "customers":
      return "#/customers";
    case "simple":
      return "#/simple";
    case "jobs":
      return "#/jobs";
    case "review":
      return "#/review";
    default:
      return "#/";
  }
}

/** Unknown or partial paths fall back to null so the caller can decide. */
export function hashToView(hash: string): View | null {
  const raw = (hash || "").replace(/^#/, "").split("?")[0];
  const parts = raw.split("/").filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return DASHBOARD;
  switch (parts[0]) {
    case "dashboard":
      return DASHBOARD;
    case "workspaces":
      return parts[1]
        ? { kind: "workspace", id: parts[1] }
        : { kind: "workspaces", ...(["migration", "reference"].includes(new URLSearchParams(hash.split("?")[1]).get("tool") || "") ? { tool: new URLSearchParams(hash.split("?")[1]).get("tool") as "migration" | "reference" } : {}) };
    case "simple":
      return { kind: "simple" };
    case "jobs":
      return { kind: "jobs" };
    case "review":
      return REVIEW;
    case "requests":
      return parts[1] ? { kind: "request", id: parts[1] } : REVIEW;
    case "customers":
      return parts[1] ? { kind: "customer", id: parts[1] } : { kind: "customers" };
    default:
      return null;
  }
}

export function sameView(a: View, b: View): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "workspaces" && b.kind === "workspaces") return a.tool === b.tool;
  if (a.kind === "request" && b.kind === "request") return a.id === b.id;
  if (a.kind === "workspace" && b.kind === "workspace") return a.id === b.id;
  if (a.kind === "customer" && b.kind === "customer") return a.id === b.id;
  return true;
}

export function viewLabel(view: View): string {
  switch (view.kind) {
    case "workspaces":
    case "workspace":
      return "Jobs & Documents";
    case "request":
      return "Change order review";
    case "simple":
      return "Quick request";
    case "jobs":
      return "Import jobs";
    case "customers":
    case "customer":
      return "Customers";
    case "dashboard":
      return "Dashboard";
    case "review":
      return "Requests";
    default:
      return "Estimator review";
  }
}

/**
 * The view to show on app launch:
 * Always opens to the main screen (estimator review queue / dashboard) first,
 * with the "New request" button right on the top.
 * Only explicit deep links to a specific change order (e.g. #/requests/...)
 * bypass the main screen.
 */
export function initialView(): View {
  const hash = window.location.hash;
  if (hash.length > 1) {
    const fromHash = hashToView(hash);
    if (fromHash)
      return fromHash;
  }
  return DASHBOARD;
}

export function readStoredView(): View {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return DASHBOARD;
    const parsed = JSON.parse(raw) as Partial<View> & { id?: string };
    switch (parsed.kind) {
      case "dashboard":
        return DASHBOARD;
      case "workspace":
        return parsed.id
          ? { kind: "workspace", id: String(parsed.id) }
          : { kind: "workspaces" };
      case "workspaces":
        return { kind: "workspaces" };
      case "request":
        return parsed.id ? { kind: "request", id: String(parsed.id) } : REVIEW;
      case "customer":
        return parsed.id ? { kind: "customer", id: String(parsed.id) } : { kind: "customers" };
      case "customers":
        return { kind: "customers" };
      case "simple":
        return { kind: "simple" };
      case "jobs":
        return { kind: "jobs" };
      case "review":
        return REVIEW;
      default:
        return DASHBOARD;
    }
  } catch {
    return DASHBOARD;
  }
}

/** Forget the remembered view, so the next load starts at the dashboard. */
export function clearStoredView(): void {
  try {
    localStorage.removeItem(VIEW_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function persistView(view: View): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(view));
  } catch {
    // Storage is unavailable (private mode); routing still works for this tab.
  }
}

/** Push or replace a history entry without triggering a full navigation. */
export function writeHistory(view: View, mode: "push" | "replace"): void {
  const url = viewToHash(view);
  if (window.location.hash === url) return;
  if (mode === "replace") window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}
