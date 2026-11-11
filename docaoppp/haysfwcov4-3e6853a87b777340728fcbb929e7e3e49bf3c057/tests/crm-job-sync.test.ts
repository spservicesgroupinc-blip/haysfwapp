import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { syncCustomersFromJobs } from "../src/crm/jobSync";
import { createCustomer, listCustomers } from "../src/crm/index";
import { getLocalCustomer } from "../src/crm/store";
import { createWorkspace } from "../src/workspaces/model";
import { readWorkspaceRow, updateWorkspaceRow } from "../src/workspaces/localStore";
import type { JobEntry } from "../src/types";

// No network in these tests: every API call fails fast.
globalThis.fetch = (async () => {
  throw new TypeError("Network unavailable");
}) as typeof fetch;

function openDb(
  name: string,
  version: number,
  upgrade: (db: IDBDatabase) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function clearStores(
  name: string,
  version: number,
  upgrade: (db: IDBDatabase) => void,
  stores: string[],
): Promise<void> {
  const db = await openDb(name, version, upgrade);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores, "readwrite");
    stores.forEach((store) => tx.objectStore(store).clear());
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

const crmSchema = (db: IDBDatabase) => {
  if (!db.objectStoreNames.contains("customers"))
    db.createObjectStore("customers", { keyPath: "id" });
  if (!db.objectStoreNames.contains("activities"))
    db.createObjectStore("activities", { keyPath: "id" });
  if (!db.objectStoreNames.contains("tasks"))
    db.createObjectStore("tasks", { keyPath: "id" });
};

const workspaceSchema = (db: IDBDatabase) => {
  if (!db.objectStoreNames.contains("workspaces"))
    db.createObjectStore("workspaces", { keyPath: "workspace.id" });
  if (!db.objectStoreNames.contains("documents"))
    db.createObjectStore("documents", { keyPath: "document.id" });
};

async function resetDatabases(): Promise<void> {
  await clearStores("hays-crm-v1", 1, crmSchema, ["customers", "activities", "tasks"]);
  await clearStores("hays-job-workspaces-v1", 1, workspaceSchema, ["workspaces", "documents"]);
}

function job(overrides: Partial<JobEntry> = {}): JobEntry {
  return {
    id: crypto.randomUUID(),
    jobNumber: "F-26-0366-P",
    customer: "York Ridge Apartments",
    address: "1200 York St, Fort Wayne, IN 46802",
    projectManager: "Dana Whitfield",
    estimator: "Marcus Vance",
    status: "Active",
    customerPhone: "260-555-0144",
    customerEmail: "dana@yorkridge.example.com",
    contractAmount: "167045.81",
    active: true,
    updatedAt: "2026-10-01T12:00:00.000Z",
    ...overrides,
  };
}

test("each uploaded job customer becomes one customer record", async () => {
  await resetDatabases();
  const result = await syncCustomersFromJobs([
    job(),
    job({ jobNumber: "F-26-0400-A", customer: "  york ridge   APARTMENTS " }),
    job({ jobNumber: "I-26-1042-W", customer: "Beacon Health Pavilion" }),
  ]);

  assert.equal(result.created.length, 2);
  const customers = await listCustomers();
  assert.deepEqual(
    customers.map((customer) => customer.name).sort(),
    ["Beacon Health Pavilion", "York Ridge Apartments"],
  );
  const yorkRidge = customers.find((c) => c.name === "York Ridge Apartments");
  assert.equal(yorkRidge?.phone, "260-555-0144");
  assert.equal(yorkRidge?.email, "dana@yorkridge.example.com");
  assert.equal(yorkRidge?.address, "1200 York St, Fort Wayne, IN 46802");
});

test("re-running the sync after another refresh adds nothing", async () => {
  await resetDatabases();
  const jobs = [job(), job({ jobNumber: "I-26-1042-W", customer: "Beacon Health Pavilion" })];

  await syncCustomersFromJobs(jobs);
  const second = await syncCustomersFromJobs(jobs);

  assert.equal(second.created.length, 0);
  assert.equal(second.updated.length, 0);
  assert.equal((await listCustomers()).length, 2);
});

test("cached uploads defer new contacts until shared customer IDs can be checked", async () => {
  await resetDatabases();
  const result = await syncCustomersFromJobs([job()], true);
  assert.equal(result.created.length, 0);
  assert.equal((await listCustomers()).length, 0);
});

test("job details fill blanks without overwriting entered contact info", async () => {
  await resetDatabases();
  const customer = await createCustomer({
    name: "York Ridge Apartments",
    phone: "260-000-0000",
  });

  const result = await syncCustomersFromJobs([job()]);
  assert.equal(result.created.length, 0);
  assert.equal(result.updated.length, 1);

  const [saved] = await listCustomers();
  assert.equal(saved.id, customer.id);
  assert.equal(saved.phone, "260-000-0000");
  assert.equal(saved.email, "dana@yorkridge.example.com");
  assert.equal(saved.address, "1200 York St, Fort Wayne, IN 46802");
});

test("a saved job with a matching job number is linked to its customer", async () => {
  await resetDatabases();
  const workspace = createWorkspace();
  workspace.record.customer.jobNumber = "f-26-0366-p";
  workspace.record.customer.customerName = "Different spelling";
  await updateWorkspaceRow(workspace.id, () => ({
    workspace,
    serverRevision: 0,
    dirty: false,
  }));

  const result = await syncCustomersFromJobs([job()]);
  const customerId = result.created[0].id;

  assert.deepEqual(result.linkedWorkspaceIds, [workspace.id]);
  const row = await readWorkspaceRow(workspace.id);
  assert.equal(row?.workspace.customerId, customerId);
  assert.equal(row?.workspace.record.customer.mainPhone, "260-555-0144");
  assert.equal(row?.workspace.record.customer.customerName, "Different spelling");
  assert.equal(row?.workspace.originalContract, "167045.81");
});

test("a saved job without a job number is linked by customer name", async () => {
  await resetDatabases();
  const workspace = createWorkspace();
  workspace.record.customer.customerName = "Beacon Health Pavilion";
  await updateWorkspaceRow(workspace.id, () => ({
    workspace,
    serverRevision: 0,
    dirty: false,
  }));

  const result = await syncCustomersFromJobs([
    job({ jobNumber: "", customer: "Beacon Health Pavilion" }),
  ]);

  assert.equal(result.created.length, 1);
  const row = await readWorkspaceRow(workspace.id);
  assert.equal(row?.workspace.customerId, result.created[0].id);
});

test("the customer list counts uploaded jobs once even before they are opened", async () => {
  await resetDatabases();
  const store = new Map<string, string>();
  const previous = (globalThis as { localStorage?: Storage }).localStorage;
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;

  try {
    const jobs = [
      job(),
      job({ jobNumber: "F-26-0400-A", customer: "York Ridge Apartments" }),
    ];
    store.set("hays_change_orders_jobs", JSON.stringify(jobs));
    await syncCustomersFromJobs(jobs);

    const workspace = createWorkspace();
    workspace.record.customer.jobNumber = "F-26-0366-P";
    workspace.record.customer.customerName = "York Ridge Apartments";
    await updateWorkspaceRow(workspace.id, () => ({
      workspace,
      serverRevision: 0,
      dirty: false,
    }));
    await syncCustomersFromJobs(jobs);

    const [customer] = await listCustomers();
    assert.equal(customer.jobCount, 2);
  } finally {
    (globalThis as { localStorage?: Storage }).localStorage = previous;
  }
});

test("several jobs for one new customer produce one record and one revision bump", async () => {
  await resetDatabases();
  await syncCustomersFromJobs([
    job({ customerPhone: "260-555-0001", customerEmail: "", address: "" }),
    job({ customerEmail: "front@yorkridge.example.com", address: "1 Main St" }),
    job({ jobNumber: "X-26-0001-A" }),
  ]);

  const customers = await listCustomers();
  assert.equal(customers.length, 1);
  assert.equal(customers[0].phone, "260-555-0001");
  assert.equal(customers[0].email, "front@yorkridge.example.com");
  assert.equal(customers[0].address, "1 Main St");

  const stored = await getLocalCustomer(customers[0].id);
  // Created at 0 and completed once; three jobs are still a single mutation.
  assert.equal(stored?.revision, 1);
});
