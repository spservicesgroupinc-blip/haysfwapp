import {
  notifyCrm,
  refreshActivitiesForCustomer,
  refreshCustomersFromServer,
  refreshTasksForCustomer,
  stageActivity,
  stageCustomer,
  stageTask,
  startCrmSync,
  subscribeCrm,
} from "./sync";
import * as api from "./api";
import {
  deleteCustomer,
  getLocalCustomer,
  listAllLocalTasks,
  listLocalActivities,
  listLocalCustomers,
  listLocalTasks,
  putCustomer,
  putCustomerSilent,
} from "./store";
import { customerNameKey, jobNumberKey } from "./jobSync";
import { cachedJobDirectory } from "../services/storage";
import { readWorkspaceRow, readWorkspaceRows } from "../workspaces/localStore";
import { saveWorkspaceLocally } from "../services/workspaces";
import type {
  Activity,
  ActivityDirection,
  ActivityKind,
  Customer,
  CustomerSummary,
  JobStage,
  NewCommunicationInput,
  NewCustomerInput,
  NewTaskInput,
  Task,
  TaskStatus,
} from "./types";

export type {
  Activity,
  ActivityDirection,
  ActivityKind,
  Customer,
  CustomerSummary,
  JobStage,
  NewCommunicationInput,
  NewCustomerInput,
  NewTaskInput,
  Task,
  TaskStatus,
};

export { startCrmSync, subscribeCrm };

export { syncCustomersFromJobs } from "./jobSync";
export type { JobCustomerSyncResult } from "./jobSync";

/** A job is one number; unnamed jobs fall back to their own row id. */
const jobIdentity = (jobNumber: string | undefined, fallback: string) =>
  jobNumberKey(jobNumber) ? `job:${jobNumberKey(jobNumber)}` : fallback;

export async function listCustomers(): Promise<CustomerSummary[]> {
  await refreshCustomersFromServer().catch(() => undefined);
  const [customers, workspaceRows, tasks] = await Promise.all([
    listLocalCustomers(),
    readWorkspaceRows(),
    listAllLocalTasks(),
  ]);
  const tasksOpen = new Map<string, number>();
  for (const task of tasks) {
    if (task.status !== "open") continue;
    tasksOpen.set(task.customerId, (tasksOpen.get(task.customerId) ?? 0) + 1);
  }

  // The directory mirrors the uploaded job report, so a customer's job count
  // includes jobs that have not been opened as a workspace yet.
  const jobsByCustomer = new Map<string, Set<string>>();
  const customerIdByName = new Map<string, string>();
  for (const customer of customers) {
    const key = customerNameKey(customer.name);
    if (key && !customerIdByName.has(key)) customerIdByName.set(key, customer.id);
  }
  const countJob = (customerId: string, identity: string) => {
    const jobs = jobsByCustomer.get(customerId) ?? new Set<string>();
    jobs.add(identity);
    jobsByCustomer.set(customerId, jobs);
  };
  for (const row of workspaceRows) {
    const customerId = row.workspace.customerId;
    if (!customerId) continue;
    countJob(
      customerId,
      jobIdentity(
        row.workspace.record.customer.jobNumber,
        `workspace:${row.workspace.id}`,
      ),
    );
  }
  for (const job of cachedJobDirectory()) {
    const customerId = customerIdByName.get(customerNameKey(job.customer));
    if (!customerId) continue;
    countJob(customerId, jobIdentity(job.jobNumber, `directory:${job.id}`));
  }

  return customers.map((customer) => ({
    id: customer.id,
    revision: customer.revision,
    createdAt: customer.createdAt,
    cityStateZip: customer.cityStateZip,
    mergedFromIds: customer.mergedFromIds,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    tags: customer.tags,
    updatedAt: customer.updatedAt,
    jobCount: jobsByCustomer.get(customer.id)?.size ?? 0,
    openTaskCount: tasksOpen.get(customer.id) ?? 0,
  }));
}

export async function openCustomer(customerId: string): Promise<Customer | null> {
  const local = await getLocalCustomer(customerId);
  try {
    const remote = await api.openCustomer(customerId);
    if (remote) {
      await putCustomerSilent(remote);
      return remote;
    }
  } catch {
    // Offline or backend not yet deployed: serve the device copy.
  }
  return local ?? null;
}

export async function createCustomer(input: NewCustomerInput): Promise<Customer> {
  await refreshCustomersFromServer().catch(() => undefined);
  const nameKey = customerNameKey(input.name);
  const phoneKey = (value: string | undefined) => (value || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  const matches = (await listLocalCustomers()).filter(customer =>
    customerNameKey(customer.name) === nameKey &&
    !(customer.phone && input.phone && phoneKey(customer.phone) !== phoneKey(input.phone)) &&
    !(customer.email && input.email && customerNameKey(customer.email) !== customerNameKey(input.email)) &&
    !(customer.address && input.address && customerNameKey(customer.address) !== customerNameKey(input.address)));
  if (matches.length === 1) {
    const existing = matches[0];
    const merged = {
      ...existing,
      phone: existing.phone || input.phone,
      email: existing.email || input.email,
      address: existing.address || input.address,
      cityStateZip: existing.cityStateZip || input.cityStateZip,
      tags: [...new Set([...(existing.tags || []), ...(input.tags || [])])],
    };
    return JSON.stringify(merged) === JSON.stringify(existing) ? existing : updateCustomer(merged);
  }
  const now = new Date().toISOString();
  const customer: Customer = {
    id: crypto.randomUUID(),
    revision: 0,
    createdAt: now,
    updatedAt: now,
    name: input.name,
    phone: input.phone,
    email: input.email,
    address: input.address,
    cityStateZip: input.cityStateZip,
    tags: input.tags,
  };
  await stageCustomer(customer, 0);
  return customer;
}

export async function updateCustomer(customer: Customer): Promise<Customer> {
  const now = new Date().toISOString();
  const next: Customer = {
    ...customer,
    revision: customer.revision + 1,
    updatedAt: now,
  };
  await stageCustomer(next, customer.revision);
  return next;
}

export async function mergeCustomers(targetId: string, sourceId: string): Promise<Customer> {
  const merged = await api.mergeCustomers(targetId, sourceId);
  await putCustomer(merged);
  await deleteCustomer(sourceId);
  notifyCrm();
  return merged;
}

export async function listActivities(customerId: string): Promise<Activity[]> {
  await refreshActivitiesForCustomer(customerId).catch(() => undefined);
  const activities = await listLocalActivities(customerId);
  return activities.sort((a, b) => b.at.localeCompare(a.at));
}

export async function addNote(customerId: string, body: string, by?: string): Promise<Activity> {
  const activity: Activity = {
    id: crypto.randomUUID(),
    customerId,
    kind: "note",
    direction: "system",
    body,
    at: new Date().toISOString(),
    by,
  };
  await stageActivity(activity);
  return activity;
}

export async function logCommunication(
  customerId: string,
  input: NewCommunicationInput,
): Promise<Activity> {
  const activity: Activity = {
    id: crypto.randomUUID(),
    customerId,
    kind: input.kind,
    direction: input.direction,
    body: input.summary,
    at: new Date().toISOString(),
    by: input.by,
  };
  await stageActivity(activity);
  return activity;
}

export async function listTasks(customerId: string): Promise<Task[]> {
  await refreshTasksForCustomer(customerId).catch(() => undefined);
  const tasks = await listLocalTasks(customerId);
  return tasks.sort((a, b) => {
    const aOpen = a.status === "open" ? 0 : 1;
    const bOpen = b.status === "open" ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return (a.dueDate ?? "\uFFFF").localeCompare(b.dueDate ?? "\uFFFF");
  });
}

export async function createTask(customerId: string, input: NewTaskInput): Promise<Task> {
  const now = new Date().toISOString();
  const task: Task = {
    id: crypto.randomUUID(),
    customerId,
    title: input.title,
    dueDate: input.dueDate,
    assignee: input.assignee,
    status: "open",
    revision: 0,
    createdAt: now,
  };
  await stageTask(task, 0);
  return task;
}

export async function toggleTask(task: Task): Promise<Task> {
  const now = new Date().toISOString();
  const done = task.status !== "done";
  const next: Task = {
    ...task,
    status: done ? "done" : "open",
    completedAt: done ? now : undefined,
    revision: task.revision + 1,
  };
  await stageTask(next, task.revision);
  return next;
}

export async function setWorkspaceStage(workspaceId: string, stage: JobStage): Promise<void> {
  const row = await readWorkspaceRow(workspaceId);
  if (!row) throw new Error("This job is not available on this device.");
  const next = structuredClone(row.workspace);
  next.stage = stage;
  await saveWorkspaceLocally(next);
}

export async function linkWorkspaceToCustomer(
  workspaceId: string,
  customerId: string,
): Promise<void> {
  const row = await readWorkspaceRow(workspaceId);
  if (!row) throw new Error("This job is not available on this device.");
  const next = structuredClone(row.workspace);
  next.customerId = customerId;
  await saveWorkspaceLocally(next);
}
