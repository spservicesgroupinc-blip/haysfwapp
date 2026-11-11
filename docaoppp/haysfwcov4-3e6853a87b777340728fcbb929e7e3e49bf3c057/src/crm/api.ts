import { API_URL, ApiError } from "../services/storage";
import type { Activity, Customer, CustomerSummary, Task } from "./types";

/** All CRM actions use CORS-simple POSTs; an HTTP 200 alone is not success. */
export async function crmApi<T>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal,
    });
    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new ApiError(
        "The customer service did not return JSON. Check its Apps Script deployment.",
        "BAD_RESPONSE",
      );
    }
    if (!response.ok || data.ok !== true) {
      const unknown = /unknown action/i.test(data.error || "");
      throw new ApiError(
        unknown
          ? "Customers requires the updated Apps Script backend. Your device copy is safe; deploy the new Code.gs and retry."
          : data.error || "The customer service is unavailable.",
        unknown ? "DEPLOYMENT_REQUIRED" : data.code,
        data.currentRevision,
      );
    }
    return data as T;
  } catch (error) {
    if (controller.signal.aborted)
      throw new ApiError(
        "The customer service timed out. Your device changes are still saved; retry synchronization.",
        "TIMEOUT",
      );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function listCustomers(): Promise<CustomerSummary[]> {
  const result = await crmApi<{ customers: CustomerSummary[] }>("listCustomers");
  return Array.isArray(result.customers) ? result.customers : [];
}

export async function openCustomer(customerId: string): Promise<Customer | null> {
  const result = await crmApi<{ customer?: Customer }>("openCustomer", { customerId });
  return result.customer ?? null;
}

export async function saveCustomer(
  customer: Customer,
  expectedRevision: number,
  mutationId: string,
): Promise<Customer> {
  const result = await crmApi<{ customer: Customer }>("saveCustomer", {
    customer,
    expectedRevision,
    mutationId,
  });
  return result.customer;
}

export async function mergeCustomers(
  targetId: string,
  sourceId: string,
): Promise<Customer> {
  const result = await crmApi<{ customer: Customer }>("mergeCustomers", {
    targetId,
    sourceId,
  });
  return result.customer;
}

export async function listActivities(customerId: string): Promise<Activity[]> {
  const result = await crmApi<{ activities: Activity[] }>("listActivities", { customerId });
  return Array.isArray(result.activities) ? result.activities : [];
}

export async function addActivity(activity: Activity, mutationId: string): Promise<Activity> {
  const result = await crmApi<{ activity: Activity }>("addActivity", { activity, mutationId });
  return result.activity;
}

export async function listTasks(customerId: string): Promise<Task[]> {
  const result = await crmApi<{ tasks: Task[] }>("listTasks", { customerId });
  return Array.isArray(result.tasks) ? result.tasks : [];
}

export async function saveTask(
  task: Task,
  expectedRevision: number,
  mutationId: string,
): Promise<Task> {
  const result = await crmApi<{ task: Task }>("saveTask", {
    task,
    expectedRevision,
    mutationId,
  });
  return result.task;
}
