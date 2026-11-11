import type { JobEntry } from "../types";
import { saveWorkspaceLocally } from "../services/workspaces";
import { readWorkspaceRows } from "../workspaces/localStore";
import { refreshCustomersFromServer, stageCustomers } from "./sync";
import { listLocalCustomers } from "./store";
import type { Customer } from "./types";
import { fillWorkspaceFromDirectory, matchingDirectoryEntry } from "../documents/services/directoryAutofill";

/** Job reports spell the same customer inconsistently, so compare a normal form. */
export const customerNameKey = (name: string | undefined): string =>
  (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export const jobNumberKey = (value: string | undefined): string =>
  (value ?? "").trim().toUpperCase();

export interface JobCustomerSyncResult {
  /** Customers that only existed in the uploaded job report before this sync. */
  created: Customer[];
  /** Customers whose missing contact details were filled in from a job. */
  updated: Customer[];
  /** Saved jobs that were pointed at the customer their job number/name owns. */
  linkedWorkspaceIds: string[];
}

/**
 * Makes the job directory the source of truth for the customer directory.
 *
 * Every uploaded job's customer becomes a customer record (or fills in the
 * contact details it was missing), and saved jobs are linked to the customer
 * their job number — or, failing that, their customer name — belongs to.
 *
 * Runs are serialized: concurrent callers (React StrictMode mounting twice, a
 * dashboard refresh during an import) would otherwise both see an empty
 * directory and create the same customer twice.
 */
export function syncCustomersFromJobs(
  jobs: JobEntry[],
  requireSharedDirectory = false,
): Promise<JobCustomerSyncResult> {
  const queued = queue.then(
    () => runJobCustomerSync(jobs, requireSharedDirectory),
    () => runJobCustomerSync(jobs, requireSharedDirectory),
  );
  queue = queued.catch(() => undefined);
  return queued;
}

let queue: Promise<unknown> = Promise.resolve();

async function runJobCustomerSync(
  jobs: JobEntry[],
  requireSharedDirectory: boolean,
): Promise<JobCustomerSyncResult> {
  const result: JobCustomerSyncResult = {
    created: [],
    updated: [],
    linkedWorkspaceIds: [],
  };
  const entries = (Array.isArray(jobs) ? jobs : []).filter(
    (job) => job && customerNameKey(job.customer),
  );

  // Imports can already have created shared CRM records on the server. Hydrate
  // those IDs before staging local additions, including on a brand-new device.
  const hydrated = await refreshCustomersFromServer().then(() => true, () => false);
  const customers = await listLocalCustomers();
  const byName = new Map<string, Customer>();
  for (const customer of customers) {
    const nameKey = customerNameKey(customer.name);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, customer);
  }

  // One pending write per customer, always against the revision the device
  // started from, so a customer on three jobs is still one server mutation.
  const staged = new Map<string, { customer: Customer; expectedRevision: number }>();
  const created = new Map<string, Customer>();
  const updated = new Map<string, Customer>();
  const customerIdByJobNumber = new Map<string, string>();

  for (const entry of entries) {
    const nameKey = customerNameKey(entry.customer);
    const phone = (entry.customerPhone ?? "").trim() || undefined;
    const email = (entry.customerEmail ?? "").trim() || undefined;
    const address = (entry.address ?? "").trim() || undefined;
    const existing = byName.get(nameKey);
    let customer: Customer;

    if (!existing) {
      // A cached CSV can be read offline, but shared customer IDs must be
      // checked before creating contacts that another device already owns.
      if (requireSharedDirectory && !hydrated) continue;
      const now = new Date().toISOString();
      customer = {
        id: crypto.randomUUID(),
        revision: 0,
        createdAt: now,
        updatedAt: now,
        name: entry.customer.trim(),
        phone,
        email,
        address,
      };
      staged.set(customer.id, { customer, expectedRevision: 0 });
      created.set(customer.id, customer);
    } else if (
      (existing.phone || phone) !== existing.phone ||
      (existing.email || email) !== existing.email ||
      (existing.address || address) !== existing.address
    ) {
      // The job report never overwrites details a person already entered.
      const next: Customer = {
        ...existing,
        phone: existing.phone || phone,
        email: existing.email || email,
        address: existing.address || address,
        revision: existing.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      staged.set(existing.id, {
        customer: next,
        expectedRevision:
          staged.get(existing.id)?.expectedRevision ?? existing.revision,
      });
      updated.set(existing.id, next);
      customer = next;
    } else {
      customer = existing;
    }

    byName.set(nameKey, customer);
    const number = jobNumberKey(entry.jobNumber);
    if (number) customerIdByJobNumber.set(number, customer.id);
  }

  if (staged.size) await stageCustomers([...staged.values()]);
  result.created = [...created.values()];
  result.updated = [...updated.values()];

  const rows = await readWorkspaceRows();
  for (const row of rows) {
    const workspace = row.workspace;
    if (row.inFlight || row.conflict) continue;
    const match = matchingDirectoryEntry(workspace, entries);
    const customerId = workspace.customerId ??
      customerIdByJobNumber.get(jobNumberKey(workspace.record.customer.jobNumber)) ??
      byName.get(customerNameKey(workspace.record.customer.customerName))?.id;
    const next = match ? fillWorkspaceFromDirectory(workspace, match) : structuredClone(workspace);
    if (customerId) next.customerId = customerId;
    if (JSON.stringify(next) === JSON.stringify(workspace)) continue;
    await saveWorkspaceLocally(next);
    if (!workspace.customerId && next.customerId) result.linkedWorkspaceIds.push(next.id);
  }

  return result;
}
