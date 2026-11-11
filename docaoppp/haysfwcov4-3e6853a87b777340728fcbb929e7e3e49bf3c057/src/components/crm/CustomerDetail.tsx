import { useCallback, useEffect, useState } from "react";
import {
  Briefcase,
  FileText,
  GitMerge,
  Link2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Tag,
  UserRound,
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
} from "lucide-react";
import {
  addNote,
  createTask,
  linkWorkspaceToCustomer,
  listActivities,
  listCustomers,
  listTasks,
  logCommunication,
  openCustomer,
  setWorkspaceStage,
  subscribeCrm,
  toggleTask,
} from "../../crm";
import type {
  Activity,
  Customer,
  CustomerSummary,
  JobStage,
  NewCommunicationInput,
  NewTaskInput,
  Task,
} from "../../crm/types";
import {
  cachedWorkspaces,
  subscribeWorkspaces,
  saveWorkspaceLocally,
} from "../../services/workspaces";
import { workspaceFromDirectory } from "../../workspaces/model";
import { cachedRequests, cachedJobDirectory } from "../../services/storage";
import { customerNameKey } from "../../services/customerDirectory";
import type { ChangeRequest, JobEntry, RequestStatus } from "../../types";
import type { WorkspaceRow } from "../../workspaces/types";
import type { CustomerData } from "../../documents/types/jobData";
import ActivityTimeline from "./ActivityTimeline";
import CustomerForm from "./CustomerForm";
import TaskList from "./TaskList";
import "./crm.css";
import "./CustomerDetail.css";

const STAGES: JobStage[] = ["lead", "in_progress", "complete", "closed"];
const STAGE_LABELS: Record<JobStage, string> = {
  lead: "Lead",
  in_progress: "In progress",
  complete: "Complete",
  closed: "Closed",
};
const REQUEST_LABELS: Record<RequestStatus, string> = {
  submitted: "In queue",
  in_review: "In review",
  needs_information: "Needs info",
  completed: "Completed",
};

export interface CustomerDetailProps {
  id: string;
  onBack: () => void;
  onOpenWorkspace?: (id: string) => void;
  onOpenRequest?: (id: string) => void;
  embedded?: boolean;
  workspaceId?: string;
  onEditContact?: () => void;
  contactOverride?: CustomerData;
}

export default function CustomerDetail({ id, onBack, onOpenWorkspace, onOpenRequest, embedded = false, workspaceId, onEditContact, contactOverride }: CustomerDetailProps) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [mergeFocus, setMergeFocus] = useState(false);
  const [linkJobId, setLinkJobId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadCustomer = useCallback(async () => {
    try {
      const next = await openCustomer(id);
      setCustomer(next);
      setError(next ? "" : "This record's contact details are not available yet. Try again after syncing.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  const loadActivities = useCallback(async () => {
    try {
      setActivities(await listActivities(id));
    } catch {
      // Timeline is non-critical.
    }
  }, [id]);

  const loadTasks = useCallback(async () => {
    try {
      setTasks(await listTasks(id));
    } catch {
      // Tasks are non-critical.
    }
  }, [id]);

  const loadCustomers = useCallback(async () => {
    try {
      setCustomers(await listCustomers());
    } catch {
      // Merge picker just shows an empty list.
    }
  }, []);

  useEffect(() => {
    void loadCustomer();
    void loadActivities();
    void loadTasks();
    void loadCustomers();
    const unsubscribe = subscribeCrm(() => {
      void loadCustomer();
      void loadActivities();
      void loadTasks();
      void loadCustomers();
    });
    return unsubscribe;
  }, [loadCustomer, loadActivities, loadTasks, loadCustomers]);

  useEffect(() => {
    const read = async () => {
      setWorkspaces(await cachedWorkspaces());
    };
    void read();
    return subscribeWorkspaces(() => void read());
  }, []);

  // Own change orders are read from this device's request cache: a customer
  // links to the change orders its picks created, without another round-trip.
  useEffect(() => {
    setRequests(cachedRequests());
  }, [id]);

  const handleAddNote = useCallback(
    async (body: string) => {
      await addNote(id, body);
      await loadActivities();
    },
    [id, loadActivities],
  );

  const handleLogCommunication = useCallback(
    async (input: NewCommunicationInput) => {
      await logCommunication(id, input);
      await loadActivities();
    },
    [id, loadActivities],
  );

  const handleAddTask = useCallback(
    async (input: NewTaskInput) => {
      await createTask(id, input);
      await loadTasks();
    },
    [id, loadTasks],
  );

  const handleToggleTask = useCallback(
    async (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      await toggleTask(task);
      await loadTasks();
    },
    [tasks, loadTasks],
  );

  const changeStage = useCallback(
    async (workspaceId: string, stage: JobStage) => {
      setBusy(true);
      setError("");
      try {
        await setWorkspaceStage(workspaceId, stage);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const linkJob = useCallback(async () => {
    if (!linkJobId) return;
    setBusy(true);
    setError("");
    try {
      await linkWorkspaceToCustomer(linkJobId, id);
      setLinkJobId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [id, linkJobId]);

  const handleSaved = useCallback(async () => {
    setFormOpen(false);
    setMergeFocus(false);
    await loadCustomer();
    await loadCustomers();
  }, [loadCustomer, loadCustomers]);

  async function openImportedJob(entry: JobEntry) {
    if (!onOpenWorkspace || busy) return;
    setBusy(true);
    try {
      const workspace = workspaceFromDirectory(entry);
      workspace.customerId = id;
      await saveWorkspaceLocally(workspace);
      onOpenWorkspace(workspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  }

  if (!customer) {
    return (
      <div className="empty">
        {error ? (
          <>
            <h3>This customer could not be opened.</h3>
            <p>{error}</p>
            <div className="button-row">
              <button
                className="button primary"
                onClick={() => void loadCustomer()}
              >
                Try again
              </button>
              {!embedded && <button className="button" onClick={onBack}>
                Back to customers
              </button>}
            </div>
          </>
        ) : (
          <>
            <div className="spinner" />
            <p>Loading customer…</p>
          </>
        )}
      </div>
    );
  }

  const linked = workspaces.filter((row) => row.workspace.customerId === id);
  const unlinked = workspaces.filter((row) => row.workspace.customerId !== id);
  // New change orders carry the customer id; older ones are matched by name so
  // a customer's history is complete the first time they are opened.
  const customerKey = customerNameKey(customer.name);
  const linkedRequests = requests
    .filter(
      (request) =>
        workspaceId ? request.workspaceId === workspaceId : request.customerId === id ||
        (!request.customerId &&
          customerKey &&
          customerNameKey(request.job?.customer) === customerKey),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const importedJobs = cachedJobDirectory().filter(job =>
    customerNameKey(job.customer) === customerKey &&
    !linked.some(row => row.workspace.record.customer.jobNumber.trim().toUpperCase() === job.jobNumber.trim().toUpperCase()));
  const openTasks = tasks.filter(task => task.status === "open");
  const activeJobs = linked.filter(row => !["complete", "closed"].includes(row.workspace.stage || "lead")).length + importedJobs.filter(job => job.active).length;
  const initials = customer.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  const updatedDate = new Date(customer.updatedAt);
  const contact = {
    phone: contactOverride?.mainPhone || contactOverride?.mobilePhone || contactOverride?.homePhone || customer.phone,
    email: contactOverride?.email || customer.email,
    address: contactOverride?.lossAddress || contactOverride?.mailingAddress || customer.address,
    cityStateZip: contactOverride?.lossAddress ? "" : contactOverride?.mailingAddress ? contactOverride.mailingCityStateZip : customer.cityStateZip,
  };

  return (
    <div className={`crm crm-detail${embedded ? " crm-detail-embedded" : ""}`}>
      {!embedded && <>
      <div className="customer-breadcrumb">
        <button type="button" onClick={onBack}><ArrowLeft size={15} />All customers</button>
        <span aria-hidden="true">/</span><span>Customer overview</span>
      </div>
      <div className="crm-profile">
        <span className="crm-profile-avatar" aria-hidden="true">
          {initials || <UserRound size={28} />}
        </span>
        <div className="crm-profile-main">
          <p className="customer-eyebrow">Customer workspace</p>
          <h1>{customer.name || "Untitled customer"}</h1>
          <p className="customer-profile-caption">Jobs, conversations, and the next step — together.</p>
          {customer.tags?.length ? (
            <div className="crm-tags">
              {customer.tags.map((tag) => (
                <span key={tag} className="crm-tag">
                  <Tag size={12} />
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="crm-profile-actions">
          {customer.phone && <a className="button primary" href={`tel:${customer.phone.replace(/[^+\d]/g, "")}`}><Phone size={16} />Call customer</a>}
          {customer.email && <a className="button" href={`mailto:${customer.email}`}><Mail size={16} />Email</a>}
          <button
            className="button"
            onClick={() => {
              setMergeFocus(false);
              setFormOpen(true);
            }}
          >
            <Pencil size={16} />
            Edit
          </button>
          <button
            className="button"
            onClick={() => {
              setMergeFocus(true);
              setFormOpen(true);
            }}
          >
            <GitMerge size={16} />
            Merge
          </button>
        </div>
      </div>

      <div className="customer-overview-stats" aria-label="Customer overview">
        <div><Briefcase size={18} /><span><strong>{activeJobs}</strong><small>Active {activeJobs === 1 ? "job" : "jobs"}</small></span></div>
        <div><CalendarClock size={18} /><span><strong>{openTasks.length}</strong><small>Open follow-ups</small></span></div>
        <div><FileText size={18} /><span><strong>{linkedRequests.length}</strong><small>Change orders</small></span></div>
        <div className="customer-last-updated"><CheckCircle2 size={17} /><span><strong>Customer record</strong><small>{Number.isNaN(updatedDate.getTime()) ? "Details available below" : `Updated ${updatedDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}</small></span></div>
      </div>
      </>}

      {error ? (
        <div className="notice danger" role="alert">
          {error}
        </div>
      ) : null}

      <div className="customer-overview-layout">
      <div className="customer-overview-main">
      {!embedded && <section className="crm-section customer-jobs" aria-label="Jobs">
        <div className="crm-section-head">
          <h2>
            <Briefcase size={17} />
            Jobs & properties
          </h2>
        </div>
        {linked.length || importedJobs.length ? (
          <ul className="crm-job-list">
            {linked.map((row) => (
              <li key={row.workspace.id} className="crm-job">
                <div className="crm-job-main">
                  <span className="customer-job-number">{row.workspace.record.customer.jobNumber || "Job in preparation"}</span>
                  <strong>{row.workspace.record.customer.lossAddress || row.workspace.record.customer.customerName || "Untitled job"}</strong>
                  <small>{row.workspace.record.team.projectManager ? `Project manager · ${row.workspace.record.team.projectManager}` : "Job workspace"}</small>
                </div>
                <select
                  className="crm-job-stage"
                  aria-label={`Stage for ${row.workspace.record.customer.customerName || "job"}`}
                  value={row.workspace.stage ?? "lead"}
                  disabled={busy}
                  onChange={(event) =>
                    void changeStage(
                      row.workspace.id,
                      event.target.value as JobStage,
                    )
                  }
                >
                  {STAGES.map((stage) => (
                    <option key={stage} value={stage}>
                      {STAGE_LABELS[stage]}
                    </option>
                  ))}
                </select>
                {onOpenWorkspace && <button className="customer-open-record" type="button" aria-label={`Open job ${row.workspace.record.customer.jobNumber || row.workspace.record.customer.customerName}`} onClick={() => onOpenWorkspace(row.workspace.id)}><ArrowUpRight size={18} /></button>}
              </li>
            ))}
            {importedJobs.map(job => <li className="crm-job" key={job.id}>
              <div className="crm-job-main"><span className="customer-job-number">{job.jobNumber}</span><strong>{job.address || job.customer}</strong><small>{job.projectManager ? `Project manager · ${job.projectManager}` : "From customer database"}</small></div>
              <span className={`crm-badge customer-status ${job.active ? "is-active" : ""}`}>{job.status || (job.active ? "Active" : "Inactive")}</span>
              {onOpenWorkspace && <button className="customer-open-record" type="button" disabled={busy} aria-label={`Open job ${job.jobNumber}`} onClick={() => void openImportedJob(job)}><ArrowUpRight size={18} /></button>}
            </li>)}
          </ul>
        ) : (
          <p className="crm-empty">No jobs linked to this customer yet.</p>
        )}

        <details className="customer-link-tools"><summary><Link2 size={14} />Manage job connections</summary><p>Matching jobs connect automatically. Use this for a job recorded under a different customer.</p><div className="crm-link">
          <div className="crm-field">
            <label htmlFor="crm-link-job">Link a job</label>
            <select
              id="crm-link-job"
              aria-label="Link a job to this customer"
              value={linkJobId}
              disabled={busy}
              onChange={(event) => setLinkJobId(event.target.value)}
            >
              <option value="">Choose an unlinked job…</option>
              {unlinked.map((row) => (
                <option key={row.workspace.id} value={row.workspace.id}>
                  {row.workspace.record.customer.customerName || "Untitled job"}
                  {row.workspace.record.customer.jobNumber
                    ? ` · ${row.workspace.record.customer.jobNumber}`
                    : ""}
                </option>
              ))}
            </select>
          </div>
          <button
            className="button"
            disabled={busy || !linkJobId}
            onClick={() => void linkJob()}
          >
            <Link2 size={16} />
            Link job
          </button>
        </div>
        </details>
      </section>}

      <section className="crm-section" aria-label="Change orders">
        <div className="crm-section-head">
          <h2>
            <FileText size={17} />
            Change orders
          </h2>
          {linkedRequests.length ? (
            <span className="crm-badge">{linkedRequests.length}</span>
          ) : null}
        </div>
        {linkedRequests.length ? (
          <ul className="crm-job-list">
            {linkedRequests.map((request) => (
              <li key={request.id} className="crm-job">
                <div className="crm-job-main">
                  <strong>
                    {request.job.jobNumber ||
                      request.job.customer ||
                      "Untitled change order"}
                  </strong>
                  <small>
                    {[
                      request.job.customer,
                      new Date(request.updatedAt).toLocaleDateString(),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </div>
                <span className={`crm-badge customer-status status-${request.status}`}>
                  {REQUEST_LABELS[request.status] ?? request.status}
                </span>
                {onOpenRequest && <button className="customer-open-record" type="button" aria-label={`Open change order ${request.job.jobNumber || request.id}`} onClick={() => onOpenRequest(request.id)}><ArrowUpRight size={18} /></button>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="crm-empty">
            {workspaceId ? "No change orders for this record yet. Use New change request to get started."
              : "No change orders linked to this customer yet. Pick this customer on the New request page and the change order appears here."}
          </p>
        )}
      </section>

      <ActivityTimeline
        activities={activities}
        onAddNote={handleAddNote}
        onLogCommunication={handleLogCommunication}
      />
      </div>
      <aside className="customer-overview-sidebar" aria-label="Customer details and follow-ups">
        <section className="crm-section customer-contact" aria-label="Contact details">
          <div className="crm-section-head"><h2>Contact details</h2><UserRound size={17} aria-hidden="true" /></div>
          <dl>
            <div><dt><Phone size={14} />Phone</dt><dd>{contact.phone ? <a href={`tel:${contact.phone.replace(/[^+\d]/g, "")}`}>{contact.phone}<ArrowUpRight size={13} /></a> : <span className="customer-missing">No phone added</span>}</dd></div>
            <div><dt><Mail size={14} />Email</dt><dd>{contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}<ArrowUpRight size={13} /></a> : <span className="customer-missing">No email added</span>}</dd></div>
            <div><dt><MapPin size={14} />Address</dt><dd>{[contact.address, contact.cityStateZip].filter(Boolean).join(", ") || <span className="customer-missing">No address added</span>}</dd></div>
          </dl>
          <button className="text-button" type="button" onClick={() => { if (onEditContact) { onEditContact(); return; } setMergeFocus(false); setFormOpen(true); }}>Update contact details<ArrowUpRight size={14} /></button>
        </section>
      <TaskList
        tasks={tasks}
        onAddTask={handleAddTask}
        onToggle={handleToggleTask}
      />
      </aside>
      </div>

      {formOpen ? (
        <CustomerForm
          mode="edit"
          initial={customer}
          customers={customers}
          mergeFocus={mergeFocus}
          onCancel={() => setFormOpen(false)}
          onSaved={handleSaved}
        />
      ) : null}
    </div>
  );
}
