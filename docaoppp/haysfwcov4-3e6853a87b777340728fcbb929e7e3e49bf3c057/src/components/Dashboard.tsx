import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  TriangleAlert,
  X,
} from "lucide-react";
import type { CustomerSummary } from "../crm/types";
import { listCustomers, subscribeCrm } from "../crm";
import type { JobEntry, RequestStatus, RequestSummary } from "../types";
import "./Dashboard.css";

/** Dashboard tiles link into the request queue with the matching filter. */
export type RequestFilter = RequestStatus | "all" | "open";

const STATUS_LABELS: Record<RequestStatus, string> = {
  submitted: "In queue",
  in_review: "In review",
  needs_information: "Needs info",
  completed: "Completed",
};

export interface DashboardProps {
  requests: RequestSummary[];
  jobs: JobEntry[];
  jobsAreDemo?: boolean;
  notice?: string;
  onDismissNotice?: () => void;
  onNewRequest: () => void;
  onOpenRequest: (id: string) => void;
  onOpenRequests: (filter: RequestFilter) => void;
  onOpenCustomers: () => void;
  onOpenCustomer: (id: string) => void;
  onOpenJobs: () => void;
}

function timestamp(value?: string): number {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function shortDate(value?: string): string {
  const time = timestamp(value);
  if (!time) return "—";
  return new Date(time).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Directory rows share an import timestamp, so the job's own date wins. */
function jobActivity(job: JobEntry): number {
  return timestamp(job.dateInspected) || timestamp(job.startDate) || timestamp(job.updatedAt);
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export default function Dashboard({
  requests,
  jobs,
  jobsAreDemo = false,
  notice,
  onDismissNotice,
  onNewRequest,
  onOpenRequest,
  onOpenRequests,
  onOpenCustomers,
  onOpenCustomer,
  onOpenJobs,
}: DashboardProps) {
  const [customers, setCustomers] = useState<CustomerSummary[]>();

  useEffect(() => {
    let active = true;
    const read = async () => {
      try {
        const rows = await listCustomers();
        if (active) setCustomers(rows);
      } catch {
        if (active) setCustomers((current) => current ?? []);
      }
    };
    void read();
    const unsubscribe = subscribeCrm(() => void read());
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const {
    openRequests,
    completedRequests,
    counts,
    completedThisMonth,
    oldestWaitDays,
  } = useMemo(() => {
    const newestFirst = (a: RequestSummary, b: RequestSummary) =>
      timestamp(b.updatedAt) - timestamp(a.updatedAt);
    const open = requests.filter((item) => item.status !== "completed").sort(newestFirst);
    const completed = requests.filter((item) => item.status === "completed").sort(newestFirst);
    const byStatus: Record<RequestStatus, number> = {
      submitted: 0,
      in_review: 0,
      needs_information: 0,
      completed: 0,
    };
    for (const item of requests) byStatus[item.status] += 1;
    const now = new Date();
    const thisMonth = completed.filter((item) => {
      const date = new Date(timestamp(item.updatedAt));
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    }).length;
    const oldest = open.reduce(
      (min, item) => Math.min(min, timestamp(item.createdAt) || timestamp(item.updatedAt)),
      Number.POSITIVE_INFINITY,
    );
    return {
      openRequests: open,
      completedRequests: completed,
      counts: byStatus,
      completedThisMonth: thisMonth,
      oldestWaitDays: Number.isFinite(oldest)
        ? Math.max(0, Math.floor((Date.now() - oldest) / 86400000))
        : 0,
    };
  }, [requests]);

  const activeJobs = useMemo(() => jobs.filter((job) => job.active).length, [jobs]);
  const recentJobs = useMemo(
    () => [...jobs].sort((a, b) => jobActivity(b) - jobActivity(a)).slice(0, 5),
    [jobs],
  );
  const recentCustomers = useMemo(
    () =>
      [...(customers ?? [])]
        .sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt))
        .slice(0, 5),
    [customers],
  );
  const openFollowUps = useMemo(
    () => (customers ?? []).reduce((total, customer) => total + customer.openTaskCount, 0),
    [customers],
  );

  const todayLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="dash">
      <header className="dash-head">
        <div>
          <p className="dash-date">{todayLabel}</p>
          <h1>Dashboard</h1>
          <p className="dash-sub">
            Change orders, jobs, and customers across the company.
          </p>
        </div>
        <button className="button primary" onClick={onNewRequest}>
          <ClipboardList size={17} />
          New change order
        </button>
      </header>

      {notice ? (
        <div className="notice success dash-notice" role="status">
          <CheckCircle2 size={18} />
          <span>{notice}</span>
          {onDismissNotice ? (
            <button
              className="icon-button"
              aria-label="Dismiss confirmation"
              onClick={onDismissNotice}
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
      ) : null}

      {counts.needs_information ? (
        <button
          type="button"
          className="dash-attention"
          onClick={() => onOpenRequests("needs_information")}
        >
          <TriangleAlert size={17} />
          <span>
            <strong>
              {plural(counts.needs_information, "change order needs", "change orders need")} more
              information.
            </strong>{" "}
            Estimating is waiting on the project manager.
          </span>
          <span className="dash-attention-link">
            Review <ArrowRight size={13} />
          </span>
        </button>
      ) : null}

      <section className="dash-kpis" aria-label="Operations overview">
        <button type="button" className="dash-kpi" onClick={() => onOpenRequests("open")}>
          <span className="dash-kpi-label">
            <ClipboardList size={15} />
            Open change orders
          </span>
          <span className="dash-kpi-value">{openRequests.length}</span>
          <span className="dash-kpi-note">
            {counts.submitted + counts.in_review} awaiting review
          </span>
        </button>

        <button
          type="button"
          className={`dash-kpi${counts.needs_information ? " is-attention" : ""}`}
          onClick={() => onOpenRequests("needs_information")}
        >
          <span className="dash-kpi-label">
            <TriangleAlert size={15} />
            Needs more info
          </span>
          <span className="dash-kpi-value">{counts.needs_information}</span>
          <span className="dash-kpi-note">
            {counts.needs_information ? "Waiting on the project manager" : "Nothing outstanding"}
          </span>
        </button>

        <button
          type="button"
          className="dash-kpi"
          onClick={() => onOpenRequests("completed")}
        >
          <span className="dash-kpi-label">
            <CheckCircle2 size={15} />
            Completed change orders
          </span>
          <span className="dash-kpi-value">{completedRequests.length}</span>
          <span className="dash-kpi-note">{completedThisMonth} this month</span>
        </button>

        <button type="button" className="dash-kpi" onClick={onOpenJobs}>
          <span className="dash-kpi-label">
            <Briefcase size={15} />
            Active jobs
          </span>
          <span className="dash-kpi-value">{activeJobs}</span>
          <span className="dash-kpi-note">
            {jobsAreDemo ? "Sample job directory" : `${plural(jobs.length, "job")} in the directory`}
          </span>
        </button>
      </section>

      <div className="dash-grid">
        <section className="dash-card" aria-labelledby="dash-pending-title">
          <div className="dash-card-head">
            <div>
              <h2 id="dash-pending-title">Pending change orders</h2>
              <p>
                {openRequests.length
                  ? `Oldest waiting ${plural(oldestWaitDays, "day")}`
                  : "Everything is caught up"}
              </p>
            </div>
            <button className="text-button" onClick={() => onOpenRequests("open")}>
              View all <ArrowRight size={13} />
            </button>
          </div>
          <div className="dash-card-body">
            {openRequests.length ? (
              openRequests.slice(0, 6).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="dash-row"
                  onClick={() => onOpenRequest(item.id)}
                >
                  <span className="dash-row-main">
                    <strong>{item.job.customer || "Untitled request"}</strong>
                    <small>
                      {item.job.jobNumber || "Job pending"} ·{" "}
                      {plural(item.changesCount, "change")}
                    </small>
                  </span>
                  <span className={`dash-status status-${item.status}`}>
                    {STATUS_LABELS[item.status]}
                  </span>
                  <time dateTime={item.updatedAt}>{shortDate(item.updatedAt)}</time>
                  <ChevronRight size={16} className="dash-row-chevron" />
                </button>
              ))
            ) : (
              <p className="dash-empty">No change orders are waiting for review.</p>
            )}
          </div>
        </section>

        <section className="dash-card" aria-labelledby="dash-completed-title">
          <div className="dash-card-head">
            <div>
              <h2 id="dash-completed-title">Completed change orders</h2>
              <p>Most recent first</p>
            </div>
            <button className="text-button" onClick={() => onOpenRequests("completed")}>
              View all <ArrowRight size={13} />
            </button>
          </div>
          <div className="dash-card-body">
            {completedRequests.length ? (
              completedRequests.slice(0, 5).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="dash-row"
                  onClick={() => onOpenRequest(item.id)}
                >
                  <span className="dash-row-main">
                    <strong>{item.job.customer || "Untitled request"}</strong>
                    <small>
                      {item.job.jobNumber || "Job pending"} ·{" "}
                      {plural(item.changesCount, "change")}
                    </small>
                  </span>
                  <time dateTime={item.updatedAt}>{shortDate(item.updatedAt)}</time>
                  <ChevronRight size={16} className="dash-row-chevron" />
                </button>
              ))
            ) : (
              <p className="dash-empty">Completed change orders will appear here.</p>
            )}
          </div>
        </section>
      </div>

      <div className="dash-grid">
        <section className="dash-card" aria-labelledby="dash-jobs-title">
          <div className="dash-card-head">
            <div>
              <h2 id="dash-jobs-title">Recent jobs</h2>
              <p>Latest activity in the job directory</p>
            </div>
            <button className="text-button" onClick={onOpenJobs}>
              Jobs &amp; documents <ArrowRight size={13} />
            </button>
          </div>
          <div className="dash-card-body">
            {recentJobs.length ? (
              recentJobs.map((job) => (
                <div className="dash-row is-static" key={job.id}>
                  <span className="dash-row-main">
                    <strong>{job.customer || "Unnamed job"}</strong>
                    <small>
                      {job.jobNumber || "No job number"} · {job.projectManager || "Unassigned PM"}
                    </small>
                  </span>
                  <span className={`dash-status${job.active ? " status-active" : ""}`}>
                    {job.status || (job.active ? "Active" : "Closed")}
                  </span>
                  <time dateTime={job.dateInspected || job.startDate || job.updatedAt}>
                    {shortDate(job.dateInspected || job.startDate || job.updatedAt)}
                  </time>
                </div>
              ))
            ) : (
              <p className="dash-empty">Import a job report to see recent jobs.</p>
            )}
          </div>
        </section>

        <section className="dash-card" aria-labelledby="dash-customers-title">
          <div className="dash-card-head">
            <div>
              <h2 id="dash-customers-title">Customers</h2>
              <p>
                {openFollowUps
                  ? `${plural(openFollowUps, "open follow-up")} across the directory`
                  : "Recently updated contacts"}
              </p>
            </div>
            <button className="text-button" onClick={onOpenCustomers}>
              View all <ArrowRight size={13} />
            </button>
          </div>
          <div className="dash-card-body">
            {customers === undefined ? (
              <p className="dash-empty">Loading customers…</p>
            ) : recentCustomers.length ? (
              recentCustomers.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  className="dash-row"
                  onClick={() => onOpenCustomer(customer.id)}
                >
                  <span className="dash-row-main">
                    <strong>{customer.name}</strong>
                    <small>
                      {plural(customer.jobCount, "job")}
                      {customer.openTaskCount
                        ? ` · ${plural(customer.openTaskCount, "open follow-up")}`
                        : ""}
                    </small>
                  </span>
                  <time dateTime={customer.updatedAt}>{shortDate(customer.updatedAt)}</time>
                  <ChevronRight size={16} className="dash-row-chevron" />
                </button>
              ))
            ) : (
              <p className="dash-empty">
                Customers appear here as jobs are imported and synced.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
