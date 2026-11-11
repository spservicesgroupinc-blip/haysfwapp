import { ApiError } from "../services/storage";
import * as api from "./api";
import {
  getLocalCustomer,
  putActivity,
  putActivitySilent,
  putCustomer,
  putCustomerSilent,
  putTask,
  putTaskSilent,
  subscribe as subscribeStore,
} from "./store";
import type { Activity, Customer, Task } from "./types";

type PendingMutation =
  | { kind: "customer"; entity: Customer; expectedRevision: number }
  | { kind: "task"; entity: Task; expectedRevision: number }
  | { kind: "activity"; entity: Activity };

const pending = new Map<string, PendingMutation & { mutationId: string }>();
const key = (kind: string, id: string) => `${kind}:${id}`;

const crmListeners = new Set<() => void>();
const emitCrm = () => crmListeners.forEach((listener) => listener());

export function notifyCrm(): void {
  emitCrm();
}

let initialized = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 3000;

function schedule(delay = 30000): void {
  if (!initialized) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void syncNow().then(
      () => {
        retryDelay = 3000;
      },
      () => {
        schedule(retryDelay);
        retryDelay = Math.min(retryDelay * 2, 60000);
      },
    );
  }, delay);
  // Browser timers are numeric; Node test timers should not hold the process open.
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}

const resume = () => schedule(0);

let storeBridgeUnsub: (() => void) | undefined;
function ensureStoreBridge(): void {
  if (storeBridgeUnsub) return;
  storeBridgeUnsub = subscribeStore(() => emitCrm());
}

export function subscribeCrm(listener: () => void): () => void {
  ensureStoreBridge();
  crmListeners.add(listener);
  return () => {
    crmListeners.delete(listener);
  };
}

export function startCrmSync(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  ensureStoreBridge();
  window.addEventListener("online", resume);
  resume();
}

export async function stageCustomer(
  customer: Customer,
  expectedRevision: number,
): Promise<void> {
  await putCustomer(customer);
  pending.set(key("customer", customer.id), {
    kind: "customer",
    entity: structuredClone(customer),
    expectedRevision,
    mutationId: crypto.randomUUID(),
  });
  emitCrm();
  schedule(0);
}

/**
 * Stages many customers behind a single notification and sync pass, so a job
 * import creating a whole directory doesn't re-render the list per customer.
 */
export async function stageCustomers(
  records: { customer: Customer; expectedRevision: number }[],
): Promise<void> {
  if (!records.length) return;
  for (const record of records) {
    await putCustomerSilent(record.customer);
    pending.set(key("customer", record.customer.id), {
      kind: "customer",
      entity: structuredClone(record.customer),
      expectedRevision: record.expectedRevision,
      mutationId: crypto.randomUUID(),
    });
  }
  emitCrm();
  schedule(0);
}

export async function stageTask(
  task: Task,
  expectedRevision: number,
): Promise<void> {
  await putTask(task);
  pending.set(key("task", task.id), {
    kind: "task",
    entity: structuredClone(task),
    expectedRevision,
    mutationId: crypto.randomUUID(),
  });
  emitCrm();
  schedule(0);
}

export async function stageActivity(activity: Activity): Promise<void> {
  await putActivity(activity);
  pending.set(key("activity", activity.id), {
    kind: "activity",
    entity: structuredClone(activity),
    mutationId: crypto.randomUUID(),
  });
  emitCrm();
  schedule(0);
}

export async function refreshCustomersFromServer(): Promise<void> {
  const summaries = await api.listCustomers();
  if (!Array.isArray(summaries))
    throw new Error("The customer service returned an invalid customer list.");
  for (const summary of summaries) {
    if (pending.has(key("customer", summary.id))) continue;
    const existing = await getLocalCustomer(summary.id);
    const merged: Customer = {
      id: summary.id,
      revision: summary.revision ?? existing?.revision ?? 0,
      createdAt: summary.createdAt ?? existing?.createdAt ?? summary.updatedAt,
      updatedAt: summary.updatedAt,
      name: summary.name,
      phone: summary.phone,
      email: summary.email,
      address: summary.address,
      cityStateZip: summary.cityStateZip ?? existing?.cityStateZip,
      tags: summary.tags,
      mergedFromIds: summary.mergedFromIds ?? existing?.mergedFromIds,
    };
    await putCustomerSilent(merged);
  }
}

export async function refreshActivitiesForCustomer(customerId: string): Promise<void> {
  const activities = await api.listActivities(customerId);
  if (!Array.isArray(activities))
    throw new Error("The customer service returned an invalid activity list.");
  for (const activity of activities) {
    if (pending.has(key("activity", activity.id))) continue;
    await putActivitySilent(activity);
  }
}

export async function refreshTasksForCustomer(customerId: string): Promise<void> {
  const tasks = await api.listTasks(customerId);
  if (!Array.isArray(tasks))
    throw new Error("The customer service returned an invalid task list.");
  for (const task of tasks) {
    if (pending.has(key("task", task.id))) continue;
    await putTaskSilent(task);
  }
}

async function syncNow(): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  let failure: unknown;
  for (const [entryKey, mutation] of [...pending]) {
    try {
      if (mutation.kind === "customer") {
        const saved = await api.saveCustomer(
          mutation.entity,
          mutation.expectedRevision,
          mutation.mutationId,
        );
        await putCustomer(saved);
      } else if (mutation.kind === "task") {
        const saved = await api.saveTask(
          mutation.entity,
          mutation.expectedRevision,
          mutation.mutationId,
        );
        await putTask(saved);
      } else {
        await api.addActivity(mutation.entity, mutation.mutationId);
      }
      pending.delete(entryKey);
    } catch (error) {
      // On CONFLICT keep the local copy and stop retrying this mutation.
      if (error instanceof ApiError && error.code === "CONFLICT") pending.delete(entryKey);
      else failure = error;
    }
  }
  try {
    await refreshCustomersFromServer();
  } catch (error) {
    failure = error;
  }
  emitCrm();
  if (failure) throw failure;
}
