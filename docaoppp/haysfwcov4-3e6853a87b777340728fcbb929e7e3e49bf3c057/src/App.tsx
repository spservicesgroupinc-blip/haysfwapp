import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
  type ReactElement,
} from "react";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileText,
  Hourglass,
  Inbox,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  newId,
  type ChangeRequest,
  type JobEntry,
  type RequestAttachment,
  type RequestStatus,
  type RequestSummary,
} from "./types";
import { createRequestedChange } from "./services/requests";
import {
  claimRequest,
  cacheJobDirectory,
  deleteRequest,
  fetchAttachment,
  loadDashboard,
  openRequest,
  saveRequest,
  transitionRequest,
} from "./services/storage";
import ConfirmDeleteModal from "./components/ConfirmDeleteModal";
import {
  HOME,
  REVIEW,
  destinationToView,
  hashToView,
  initialView,
  persistView,
  sameView,
  viewToHash,
  writeHistory,
  type NavDestination,
  type View,
} from "./services/navigation";
import AppHeader from "./components/AppHeader";
import AdminJobs from "./components/AdminJobs";
import Dashboard from "./components/Dashboard";
import SimpleRequest from "./components/SimpleRequest";
import RequestReview from "./components/RequestReview";
import PdfViewer from "./components/PdfViewer";
import InstallApp from "./components/InstallApp";
import "./app.css";
import "./ux.css";
import summaryFontUrl from "./assets/fonts/NotoSans-Regular.ttf?url";
import { downloadBlob } from "./services/download";
import WorkspaceSyncStatus from "./components/WorkspaceSyncStatus";
import RequestQueue from "./components/RequestQueue";
import DraftRecovery from "./components/DraftRecovery";
import type { RequestDraft } from "./services/requestDrafts";
import { runDraftSubmission } from "./services/durableSubmission";
const JobsDocuments = lazy(() => import("./documents/JobsDocuments"));
const RequestWorkspaceLink = lazy(
  () => import("./documents/RequestWorkspaceLink"),
);
import { startCrmSync, syncCustomersFromJobs } from "./crm";
import { CUSTOMER_REFERENCE_CHANGED, getCachedCustomerReference, getCustomerReference } from "./documents/services/customerReferenceService";
import type { CustomerReferenceSnapshot } from "./documents/services/customerReference";
import { customerReferenceJobs } from "./services/customerReferenceJobs";
import { sharedJobDirectory } from "./services/sharedJobDirectory";
const CustomerList = lazy(() => import("./components/crm/CustomerList"));
const CustomerDetail = lazy(() => import("./components/crm/CustomerDetail"));

const STATUS_LABELS: Record<RequestStatus, string> = {
  submitted: "In queue",
  in_review: "In review",
  needs_information: "Needs info",
  completed: "Completed",
};
// Home dashboard tiles double as status filters for the request queue.
type StatKey = RequestStatus | "all" | "open";
const FILTER_LABELS: Record<StatKey, string> = {
  ...STATUS_LABELS,
  all: "All",
  open: "Open",
};
const STAT_TILES: {
  key: Exclude<StatKey, "open">;
  label: string;
  tone: string;
  icon: ReactElement;
}[] = [
  {
    key: "all",
    label: "All requests",
    tone: "all",
    icon: <Inbox size={16} />,
  },
  {
    key: "submitted",
    label: "In queue",
    tone: "queue",
    icon: <Hourglass size={16} />,
  },
  {
    key: "in_review",
    label: "In review",
    tone: "review",
    icon: <ClipboardList size={16} />,
  },
  {
    key: "needs_information",
    label: "Needs info",
    tone: "attention",
    icon: <TriangleAlert size={16} />,
  },
  {
    key: "completed",
    label: "Completed",
    tone: "done",
    icon: <CheckCircle2 size={16} />,
  },
];

function AttachmentPreview({
  preview,
  onClose,
}: {
  preview: { name: string; blob: Blob } | null;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!preview) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(preview.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [preview]);
  // Escape is the desktop twin of the phone's back gesture, which the shell
  // already routes to onClose.
  useEffect(() => {
    if (!preview) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview, onClose]);
  if (!preview) return null;
  return (
    <div
      className="shell-modal"
      role="dialog"
      aria-modal="true"
      aria-label={preview.name}
      onClick={onClose}
    >
      <div
        className="shell-modal-box"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shell-modal-head">
          <strong>{preview.name}</strong>
          <button
            className="icon-button"
            aria-label="Close preview"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="shell-modal-body">
          {preview.blob.type.startsWith("image/") ? (
            url ? (
              <img src={url} alt={preview.name} />
            ) : null
          ) : (
            <PdfViewer blob={preview.blob} label={preview.name} />
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [view, setViewState] = useState<View>(initialView);
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [directoryJobs, setJobs] = useState<JobEntry[]>([]);
  const [jobsAreDemo, setJobsAreDemo] = useState(true);
  const [reference, setReference] = useState<CustomerReferenceSnapshot | null>(getCachedCustomerReference);
  const referenceJobs = useMemo(() => reference ? customerReferenceJobs(reference) : [], [reference]);
  const jobs = useMemo(() => sharedJobDirectory(jobsAreDemo && referenceJobs.length ? [] : directoryJobs, reference ? referenceJobs : null), [directoryJobs, referenceJobs, reference, jobsAreDemo]);
  const [ready, setReady] = useState(false);
  const [bootSlow, setBootSlow] = useState(false);
  const [listError, setListError] = useState("");
  const [openError, setOpenError] = useState("");
  const [homeSearch, setHomeSearch] = useState("");
  const [homeStatus, setHomeStatus] = useState<StatKey>("all");
  // Confirmation for the quick PM flow, shown on the dashboard it returns to.
  const [homeNotice, setHomeNotice] = useState("");
  const [submissions, setSubmissions] = useState<
    {
      id: string;
      status: "pending" | "success" | "error";
      message: string;
      send: () => Promise<string>;
    }[]
  >([]);
  const activeSubmissions = useRef(new Set<string>());
  const crmSyncStarted = useRef(false);

  const [request, setRequest] = useState<ChangeRequest | null>(null);
  const [newRequestSeed, setNewRequestSeed] = useState<
    ChangeRequest | undefined
  >();
  const [requestDraft, setRequestDraft] = useState<RequestDraft>();
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState<{ name: string; blob: Blob } | null>(
    null,
  );
  const [requestToDelete, setRequestToDelete] = useState<
    RequestSummary | ChangeRequest | null
  >(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const queueScroll = useRef(0);
  const previousView = useRef(view.kind);
  // A preview is pushed onto the history stack so the phone's back gesture
  // closes it. The two flags keep that bookkeeping off the routing path.
  const previewEntry = useRef(false);
  const suppressPop = useRef(false);
  const leaveGuard = useRef<(() => boolean) | null>(null);
  const registerLeaveGuard = useCallback((guard: (() => boolean) | null) => {
    leaveGuard.current = guard;
  }, []);

  const viewRef = useRef(view);
  viewRef.current = view;
  const previewRef = useRef(preview);
  previewRef.current = preview;

  /**
   * The single way a view changes: React state, the URL and the stored view
   * move together, so the back gesture, a shared link and a cold start all
   * agree on where the user is.
   */
  const navigateTo = useCallback(
    (next: View, mode: "push" | "replace" = "push") => {
      if (viewRef.current.kind === "review" && next.kind !== "review") queueScroll.current = window.scrollY;
      viewRef.current = next;
      setViewState(next);
      persistView(next);
      writeHistory(next, mode);
    },
    [],
  );

  const refresh = useCallback(async () => {
    try {
      const data = await loadDashboard();
      setRequests(data.requests);
      setJobs(data.jobs);
      setJobsAreDemo(Boolean(data.jobsAreDemo));
      setListError("");
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    let active = true;
    let generation = 0;
    const read = async () => {
      const current = ++generation;
      try {
        const latest = await getCustomerReference();
        if (active && generation === current) setReference(latest);
      } catch {
        // The last shared snapshot remains available offline.
      }
    };
    const replaced = (event: Event) => {
      generation++;
      setReference((event as CustomEvent<CustomerReferenceSnapshot>).detail);
    };
    window.addEventListener(CUSTOMER_REFERENCE_CHANGED, replaced);
    window.addEventListener("online", read);
    void read();
    return () => {
      active = false;
      window.removeEventListener(CUSTOMER_REFERENCE_CHANGED, replaced);
      window.removeEventListener("online", read);
    };
  }, []);

  useEffect(() => {
    if (jobsAreDemo && !referenceJobs.length) return;
    cacheJobDirectory(jobs);
    void syncCustomersFromJobs(jobs, true).catch(() => undefined);
  }, [jobs, jobsAreDemo, referenceJobs.length]);

  /**
   * Leave whatever is on screen for another view. Any open request or file
   * preview is dropped, and the dashboard refreshes when it is the target.
   */
  const goTo = useCallback(
    (next: View, mode: "push" | "replace" = "push") => {
      if (
        !sameView(next, viewRef.current) &&
        leaveGuard.current &&
        !leaveGuard.current()
      )
        return;
      navigateTo(next, mode);
      if (next.kind !== "request") {
        setRequest(null);
        setSaveError("");
        setOpenError("");
        setPreview(null);
        previewEntry.current = false;
      }
      // A fresh visit to the quick form clears the last confirmation.
      if (next.kind === "simple") {
        setHomeNotice("");
        setNewRequestSeed(undefined);
        setRequestDraft(undefined);
      }
      if (next.kind === "review" || next.kind === "dashboard") void refresh();
    },
    [navigateTo, refresh],
  );

  const navigate = useCallback(
    (destination: NavDestination) => { const next=destinationToView(destination); if (!sameView(next,viewRef.current)) goTo(next); },
    [goTo],
  );

  const goHome = useCallback(() => goTo(HOME), [goTo]);

  const handleDeleteRequest = useCallback(
    async (id: string) => {
      setIsDeleting(true);
      try {
        await deleteRequest(id);
        setRequests((prev) => prev.filter((r) => r.id !== id));
        setRequest(null);
        setHomeNotice("Change order request was deleted successfully.");
        setRequestToDelete(null);
        if (viewRef.current.kind === "request" && viewRef.current.id === id) {
          goHome();
        }
        void refresh();
      } catch (err) {
        setListError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsDeleting(false);
      }
    },
    [goHome, refresh],
  );

  const closePreview = useCallback(() => {
    if (!previewRef.current) return;
    setPreview(null);
    if (!previewEntry.current) return;
    // Remove the entry the preview pushed so one back gesture leaves the
    // request rather than closing a dialog that is already gone.
    previewEntry.current = false;
    suppressPop.current = true;
    window.history.back();
  }, []);

  useEffect(() => {
    // The shell restores scroll itself on every view change; without this the
    // browser would fight it and land the user halfway down the previous screen.
    if ("scrollRestoration" in window.history)
      window.history.scrollRestoration = "manual";

    // The current entry becomes the dashboard, so backing out of a restored
    // deep link lands on the request list instead of leaving the app.
    const initial = viewRef.current;
    window.history.replaceState(null, "", viewToHash(HOME));
    if (!sameView(initial, HOME))
      window.history.pushState(null, "", viewToHash(initial));

    void refresh().finally(() => setReady(true));
    if (initial.kind === "request") void openRequestById(initial.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-time CRM bootstrap: local-first store + background sync.
  useEffect(() => {
    if (crmSyncStarted.current) return;
    crmSyncStarted.current = true;
    void startCrmSync();
  }, []);

  useEffect(() => {
    const onPop = () => {
      if (suppressPop.current) {
        suppressPop.current = false;
        return;
      }
      // An open preview owns the entry it pushed: back closes the file first.
      if (previewRef.current) {
        previewEntry.current = false;
        setPreview(null);
        return;
      }
      const next = hashToView(window.location.hash) ?? HOME;
      if (sameView(next, viewRef.current)) return;
      if (leaveGuard.current && !leaveGuard.current()) {
        window.history.pushState(null, "", viewToHash(viewRef.current));
        return;
      }
      leaveGuard.current = null;
      if (next.kind === "request") {
        setRequest(null);
        navigateTo(next, "replace");
        setOpenError("");
        void openRequestById(next.id);
        return;
      }
      goTo(next, "replace");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goTo, navigateTo]);

  // A view change is a page change: start at the top and let a screen reader
  // follow the new content instead of silently staying on the old heading.
  const viewKey =
    view.kind === "request" || view.kind === "workspace" || view.kind === "customer"
      ? `${view.kind}:${view.id}`
      : view.kind;
  useEffect(() => {
    const returnToQueue = view.kind === "review" && previousView.current === "request";
    previousView.current = view.kind;
    window.scrollTo({ top: returnToQueue ? queueScroll.current : 0, left: 0 });
    mainRef.current?.focus({ preventScroll: true });
  }, [viewKey]);

  // Never leave someone staring at a spinner: offer a retry if boot stalls.
  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => setBootSlow(true), 6000);
    return () => window.clearTimeout(timer);
  }, [ready]);

  async function openRequestById(id: string) {
    setBusy("Opening request…");
    setOpenError("");
    try {
      const data = await openRequest(id);
      setRequest(data);
      setSaveError("");
      navigateTo({ kind: "request", id: data.id });
    } catch (error) {
      // Shown inside the request view: a failed load must never leave the
      // screen on an endless spinner with no way back to the list.
      setOpenError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function runSubmission(id: string, send: () => Promise<string>) {
    if (activeSubmissions.current.has(id)) return;
    activeSubmissions.current.add(id);
    const update = (status: "pending" | "success" | "error", message: string) =>
      setSubmissions((items) =>
        items.map((item) =>
          item.id === id ? { ...item, status, message } : item,
        ),
      );
    update("pending", "Submitting your change order…");
    try {
      const message = await send();
      update("success", message);
      void refresh();
    } catch (error) {
      update(
        "error",
        `Submission could not be completed: ${error instanceof Error ? error.message : "Check your connection and try again."}`,
      );
    } finally {
      activeSubmissions.current.delete(id);
    }
  }

  function submitQuickRequest(send: () => Promise<string>) {
    const id = newId();
    setSubmissions((items) => [
      ...items,
      {
        id,
        send,
        status: "pending",
        message: "Submitting your change order…",
      },
    ]);
    goHome();
    // Let the home screen render before image preparation or network work.
    window.setTimeout(() => void runSubmission(id, send), 0);
  }

  async function claim(name: string) {
    if (!request || !name.trim()) return;
    setBusy("Starting work…");
    setSaveError("");
    try {
      const server = await claimRequest(
        request.id,
        request.revision,
        name.trim(),
        newId(),
      );
      setRequest(server);
      void refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function markComplete() {
    if (!request) return;
    setBusy("Completing…");
    setSaveError("");
    try {
      const server = await transitionRequest(
        request.id,
        request.revision,
        "completed",
        "",
        newId(),
      );
      setRequest(server);
      void refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function requestInfo(question: string) {
    if (!request) return;
    setBusy("Sending request…");
    setSaveError("");
    try {
      const server = await transitionRequest(
        request.id,
        request.revision,
        "needs_information",
        question,
        newId(),
      );
      setRequest(server);
      void refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function sendResponse(response: string) {
    if (!request) return;
    setBusy("Sending response…");
    setSaveError("");
    try {
      const updated: ChangeRequest = {
        ...request,
        requestedChanges: [
          ...request.requestedChanges,
          { ...createRequestedChange(), description: response.trim() },
        ],
      };
      const saved = await saveRequest(updated, request.revision, newId());
      const server = await transitionRequest(
        saved.id,
        saved.revision,
        "submitted",
        "",
        newId(),
      );
      setRequest(server);
      void refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function previewAttachment(attachment: RequestAttachment) {
    if (!request) return;
    setBusy(`Opening ${attachment.name}…`);
    setSaveError("");
    try {
      const result = await fetchAttachment(request.id, attachment.id);
      setPreview({ name: result.name, blob: result.blob });
      // One extra history entry: the back gesture closes the file preview
      // before it leaves the request.
      if (!previewEntry.current) {
        previewEntry.current = true;
        window.history.pushState(null, "", window.location.hash);
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function downloadAttachment(attachment: RequestAttachment) {
    if (!request) return;
    setBusy(`Downloading ${attachment.name}…`);
    setSaveError("");
    try {
      const result = await fetchAttachment(request.id, attachment.id);
      downloadBlob(result.blob, result.name);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function downloadSummary() {
    if (!request || busy) return;
    setBusy("Preparing summary PDF…");
    setSaveError("");
    try {
      const [{ generateRequestPdf, summaryFilename }, response] =
        await Promise.all([
          import("./services/requestPdf"),
          fetch(summaryFontUrl),
        ]);
      if (!response.ok)
        throw new Error(
          "The PDF font could not be loaded. Try downloading again.",
        );
      const bytes = await generateRequestPdf(
        request,
        new Uint8Array(await response.arrayBuffer()),
      );
      const blob = new Blob([new Uint8Array(bytes)], {
        type: "application/pdf",
      });
      const name = summaryFilename(request);
      downloadBlob(blob, name);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  const statusCounts = useMemo(() => {
    const counts: Record<RequestStatus, number> = {
      submitted: 0,
      in_review: 0,
      needs_information: 0,
      completed: 0,
    };
    for (const item of requests) counts[item.status] += 1;
    return counts;
  }, [requests]);
  const filteredRequests = requests.filter(
    (item) =>
      (homeStatus === "all" ||
        (homeStatus === "open"
          ? item.status !== "completed"
          : item.status === homeStatus)) &&
      `${item.job.customer} ${item.job.jobNumber} ${item.job.projectManager} ${item.estimatorName}`
        .toLowerCase()
        .includes(homeSearch.toLowerCase()),
  );

  if (!ready)
    return (
      <div className="boot">
        <div className="brand">
          <svg viewBox="0 0 65 42" aria-hidden="true">
            <rect width="14" height="42" fill="#dc2626" />
            <rect x="36" width="14" height="42" fill="#1a1a1a" />
            <rect x="14" y="14" width="51" height="14" fill="#1a1a1a" />
          </svg>
          <div>
            <strong>Hays+Sons</strong>
            <span>CHANGE ORDERS</span>
          </div>
        </div>
        {bootSlow ? (
          <>
            <p>
              The connection to the shared sheet is taking longer than usual.
            </p>
            <div className="button-row">
              <button
                className="button primary"
                onClick={() => void refresh().finally(() => setReady(true))}
              >
                Try again
              </button>
              <button
                className="button"
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="spinner" />
            <p>Opening your change orders…</p>
          </>
        )}
      </div>
    );

  const back =
    view.kind === "dashboard"
      ? undefined
      : view.kind === "review"
        ? { label: "Dashboard", onClick: goHome }
        : view.kind === "request"
          ? { label: "Back to requests", onClick: () => goTo(REVIEW) }
          : view.kind === "customer"
            ? { label: "Back to customers", onClick: () => goTo({ kind: "customers" }) }
            : { label: "Back to dashboard", onClick: goHome };
  const subtitle =
    view.kind === "request"
      ? request
        ? `${request.job.customer || "Untitled request"}${
            request.job.jobNumber ? ` · ${request.job.jobNumber}` : ""
          } · ${STATUS_LABELS[request.status]}`
        : openError
          ? "Unavailable"
          : "Loading request…"
      : undefined;

  return (
    <div className="app-shell">
      <AppHeader
        current={view.kind}
        onNavigate={navigate}
        back={back}
        subtitle={subtitle}
        busy={busy}
      />
      <InstallApp />
      <WorkspaceSyncStatus />
      {listError ? (
        <div className="storage-error" role="alert">
          <X size={18} />
          <span>
            <strong>Could not load requests.</strong> {listError}
          </span>
          <button className="button small" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      ) : null}
      {view.kind === "dashboard" ? (
        <main className="shell-home dash-shell" ref={mainRef} tabIndex={-1}>
          <Dashboard
            requests={requests}
            jobs={jobs}
            jobsAreDemo={jobsAreDemo}
            notice={homeNotice}
            onDismissNotice={() => setHomeNotice("")}
            onNewRequest={() => goTo({ kind: "simple" })}
            onOpenRequest={(id) => void openRequestById(id)}
            onOpenRequests={(filter) => {
              setHomeStatus(filter);
              goTo(REVIEW);
            }}
            onOpenCustomers={() => goTo({ kind: "customers" })}
            onOpenCustomer={(id) => goTo({ kind: "customer", id })}
            onOpenJobs={() => goTo({ kind: "workspaces" })}
          />
        </main>
      ) : view.kind === "simple" ? (
        <main className="shell-request" ref={mainRef} tabIndex={-1}>
          <SimpleRequest
            key={requestDraft?.id || newRequestSeed?.id || "new"}
            jobs={jobs}
            requests={requests}
            initialDraft={requestDraft}
            onLeaveGuard={registerLeaveGuard}
            initialRequest={newRequestSeed}
            onSubmit={submitQuickRequest}
          />
        </main>
      ) : view.kind === "workspace" || view.kind === "workspaces" ? (
        <main className="shell-request" ref={mainRef} tabIndex={-1}>
          <Suspense
            fallback={
              <div className="empty">
                <div className="spinner" />
                <p>Loading job documents…</p>
              </div>
            }
          >
            <JobsDocuments
              initialTool={view.kind === "workspaces" ? view.tool : undefined}
              workspaceId={view.kind === "workspace" ? view.id : undefined}
              jobs={jobs}
              requests={requests}
              onOpenWorkspace={(id) => goTo({ kind: "workspace", id })}
              onBack={() => goTo({ kind: "workspaces" })}
              onOpenRequest={(id) => void openRequestById(id)}
              onNewRequest={(seed) => {
                goTo({ kind: "simple" });
                setNewRequestSeed(seed);
              }}
            />
          </Suspense>
        </main>
      ) : view.kind === "jobs" ? (
        <main className="shell-request" ref={mainRef} tabIndex={-1}>
          <AdminJobs jobs={jobs} onImported={(imported) => { setJobs(imported); setJobsAreDemo(false); }} />
        </main>
      ) : view.kind === "request" ? (
        <main className="shell-request" ref={mainRef} tabIndex={-1}>
          {saveError ? (
            <div className="storage-error" role="alert">
              <X size={18} />
              <span>
                <strong>The action could not be completed.</strong> {saveError}{" "}
                Try again using the same action.
              </span>
              <button className="button small" onClick={() => setSaveError("")}>
                Dismiss
              </button>
            </div>
          ) : null}
          {request ? (
            <>
              <Suspense fallback={null}>
                <RequestWorkspaceLink
                  key={request.id}
                  request={request}
                  onOpen={(id) => goTo({ kind: "workspace", id })}
                  onSaved={(saved) => {
                    setRequest(saved);
                    void refresh();
                  }}
                />
              </Suspense>
              <RequestReview
                key={request.id}
                request={request}
                busy={busy}
                onBack={goHome}
                onPreview={(attachment) => void previewAttachment(attachment)}
                onDownload={(attachment) => void downloadAttachment(attachment)}
                onClaim={(name) => void claim(name)}
                onComplete={() => void markComplete()}
                onRequestInfo={(question) => void requestInfo(question)}
                onSendResponse={(response) => void sendResponse(response)}
                onDownloadSummary={() => void downloadSummary()}
                onSaved={(saved) => {
                  setRequest(saved);
                  setSaveError("");
                  void refresh();
                }}
                onReload={() => openRequest(request.id)}
                onBusy={setBusy}
                onLeaveGuard={registerLeaveGuard}
                onDelete={handleDeleteRequest}
              />
            </>
          ) : openError ? (
            <div className="empty">
              <div className="empty-icon">
                <TriangleAlert size={28} />
              </div>
              <h3>This change order could not be opened.</h3>
              <p>{openError}</p>
              <div className="button-row">
                <button
                  className="button primary"
                  onClick={() => void openRequestById(view.id)}
                >
                  Try again
                </button>
                <button className="button" onClick={goHome}>
                  Back to requests
                </button>
              </div>
            </div>
          ) : (
            <div className="empty">
              <div className="spinner" />
              <p>Loading request…</p>
            </div>
          )}
        </main>
      ) : view.kind === "customers" ? (
        <main className="shell-request" ref={mainRef} tabIndex={-1}>
          <Suspense
            fallback={
              <div className="empty">
                <div className="spinner" />
                <p>Loading customers…</p>
              </div>
            }
          >
            <CustomerList onOpen={(id) => goTo({ kind: "customer", id })} />
          </Suspense>
        </main>
      ) : view.kind === "customer" ? (
        <main className="shell-request" ref={mainRef} tabIndex={-1}>
          <Suspense
            fallback={
              <div className="empty">
                <div className="spinner" />
                <p>Loading customer…</p>
              </div>
            }
          >
            <CustomerDetail
              id={view.id}
              onBack={() => goTo({ kind: "customers" })}
              onOpenWorkspace={(id) => goTo({ kind: "workspace", id })}
              onOpenRequest={(id) => void openRequestById(id)}
            />
          </Suspense>
        </main>
      ) : (
        <main className="home shell-home" ref={mainRef} tabIndex={-1}>
          <header className="ops-head">
            <div className="ops-head-text">
              <h1>Requests</h1>
            </div>
          </header>

          {homeNotice ? (
            <div className="notice success" role="status">
              <CheckCircle2 size={18} />
              <span>{homeNotice}</span>
              <button
                className="icon-button"
                aria-label="Dismiss confirmation"
                onClick={() => setHomeNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          ) : null}

          <DraftRecovery
            onResume={(draft)=>{goTo({kind:"simple"});setRequestDraft(draft);setNewRequestSeed(draft.values.initialRequest);}}
            onRetry={(draft)=>submitQuickRequest(()=>runDraftSubmission(draft.id))}
            onOpen={(id)=>void openRequestById(id)}
          />

          <div className="queue-toolbar">
                {requests.length ? (
                  <label className="search">
                    <Search size={17} />
                    <input
                      aria-label="Search requests"
                      placeholder="Customer, job, or PM…"
                      value={homeSearch}
                      onChange={(event) => setHomeSearch(event.target.value)}
                    />
                  </label>
                ) : null}
          <section className="stat-grid" aria-label="Request status overview">
            {STAT_TILES.map(({ key, label, tone, icon }) => {
              const count = key === "all" ? requests.length : statusCounts[key];
              const active = homeStatus === key;
              return (
                <button
                  key={key}
                  type="button"
                  className={`stat-tile tone-${tone}${active ? " is-active" : ""}`}
                  aria-pressed={active}
                  onClick={() => setHomeStatus(active ? "all" : key)}
                >
                  <span className="stat-icon">{icon}</span>
                  <span className="stat-value">{count}</span>
                  <span className="stat-label">{label}</span>
                </button>
              );
            })}
          </section>

          </div>

          {statusCounts.needs_information > 0 &&
          homeStatus !== "needs_information" ? (
            <section className="attention-banner">
              <span className="attention-icon">
                <TriangleAlert size={18} />
              </span>
              <div>
                <strong>
                  {statusCounts.needs_information === 1
                    ? "1 request needs more information."
                    : `${statusCounts.needs_information} requests need more information.`}
                </strong>
                <span>
                  Estimating is waiting on details from the project manager.
                </span>
              </div>
              <button
                className="button small"
                onClick={() => setHomeStatus("needs_information")}
              >
                Review
              </button>
            </section>
          ) : null}

          <section className="draft-section">
            <div className="section-heading">
              <div>
                <h2>
                  Requests{" "}
                  <span className="count">{filteredRequests.length}</span>
                </h2>
                <p>
                  {homeStatus === "all"
                    ? "Live status for every request, from intake to completion."
                    : `Showing ${FILTER_LABELS[homeStatus].toLowerCase()} requests only.`}
                </p>
              </div>
              <div className="section-tools">
                {homeStatus === "all" ? null : (
                  <button
                    className="text-button"
                    onClick={() => setHomeStatus("all")}
                  >
                    <X size={13} />
                    Clear filter
                  </button>
                )}

              </div>
            </div>
            {!requests.length ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <FileText size={30} />
                </div>
                <h3>No change requests yet.</h3>
                <p>
                  Requests submitted by project managers land here for the
                  estimating team to review and complete.
                </p>
                <button
                  className="button"
                  onClick={() => goTo({ kind: "simple" })}
                >
                  <Plus size={16} />
                  Create your first request
                </button>
              </div>
            ) : (
              <RequestQueue requests={filteredRequests} onOpen={id=>void openRequestById(id)} onDelete={setRequestToDelete}/>
            )}
          </section>
          <footer className="home-footer">
            <ShieldCheck size={15} />
            <span>Requests sync through Google Sheets and Drive.</span>
          </footer>
        </main>
      )}
      <div
        className="submission-notifications"
        aria-label="Submission notifications"
      >
        {submissions.map((item) => (
          <div
            key={item.id}
            className={`notice submission-notification ${item.status === "error" ? "danger" : item.status === "success" ? "success" : "neutral"}`}
          >
            {item.status === "success" ? (
              <CheckCircle2 size={18} />
            ) : item.status === "error" ? (
              <TriangleAlert size={18} />
            ) : (
              <Clock3 size={18} />
            )}
            <span role={item.status === "error" ? "alert" : "status"}>
              {item.message}
            </span>
            {item.status === "error" ? (
              <button
                className="button small"
                onClick={() => void runSubmission(item.id, item.send)}
              >
                Retry submission
              </button>
            ) : null}
            {item.status !== "pending" ? (
              <button
                className="icon-button"
                aria-label="Dismiss submission notification"
                onClick={() =>
                  setSubmissions((items) =>
                    items.filter((entry) => entry.id !== item.id),
                  )
                }
              >
                <X size={16} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <AttachmentPreview preview={preview} onClose={closePreview} />
      <ConfirmDeleteModal
        isOpen={Boolean(requestToDelete)}
        title="Are you sure you want to delete?"
        message="Are you sure you want to delete this change order request? This will permanently remove the request and all uploaded attachments from the Google Sheet and Drive. This action cannot be undone."
        itemSummary={
          requestToDelete
            ? {
                customer: requestToDelete.job?.customer || "Untitled Request",
                jobNumber: requestToDelete.job?.jobNumber || "—",
                orderNumber: requestToDelete.job?.orderNumber || "—",
                status: requestToDelete.status,
              }
            : undefined
        }
        busy={isDeleting}
        onConfirm={() => {
          if (requestToDelete) {
            void handleDeleteRequest(requestToDelete.id);
          }
        }}
        onCancel={() => {
          if (!isDeleting) setRequestToDelete(null);
        }}
      />
    </div>
  );
}
