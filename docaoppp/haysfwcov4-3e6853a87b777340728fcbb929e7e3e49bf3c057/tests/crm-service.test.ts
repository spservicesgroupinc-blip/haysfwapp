import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {
  addNote,
  createCustomer,
  createTask,
  linkWorkspaceToCustomer,
  listActivities,
  listCustomers,
  listTasks,
  setWorkspaceStage,
  toggleTask,
} from "../src/crm/index";
import { createWorkspace } from "../src/workspaces/model";
import { readWorkspaceRow, updateWorkspaceRow } from "../src/workspaces/localStore";

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

test("a created customer is enriched with local job and open-task counts", async () => {
  await resetDatabases();
  const customer = await createCustomer({ name: "Acme Restoration" });
  await createTask(customer.id, { title: "Send estimate" });

  const workspace = createWorkspace();
  workspace.customerId = customer.id;
  await updateWorkspaceRow(workspace.id, () => ({ workspace, serverRevision: 0, dirty: false }));

  const directory = await listCustomers();
  const summary = directory.find((entry) => entry.id === customer.id);
  assert.ok(summary);
  assert.equal(summary.jobCount, 1);
  assert.equal(summary.openTaskCount, 1);
});

test("matching customers automatically reuse the record and combine missing details", async () => {
  await resetDatabases();
  const first = await createCustomer({ name: "Auto Match", phone: "260-555-0100", tags: ["existing"] });
  const merged = await createCustomer({ name: " auto   match ", phone: "(260) 555-0100", email: "auto@example.test", tags: ["imported"] });
  assert.equal(merged.id, first.id);
  assert.equal(merged.phone, "260-555-0100");
  assert.equal(merged.email, "auto@example.test");
  assert.deepEqual(merged.tags, ["existing", "imported"]);
  assert.equal((await listCustomers()).length, 1);
  const different = await createCustomer({ name: "Auto Match", phone: "260-555-0999" });
  assert.notEqual(different.id, first.id);
});

test("notes append to the timeline newest first", async () => {
  await resetDatabases();
  const customer = await createCustomer({ name: "Timeline Co" });
  await addNote(customer.id, "first note");
  await new Promise((resolve) => setTimeout(resolve, 5));
  await addNote(customer.id, "second note");

  const activities = await listActivities(customer.id);
  assert.equal(activities.length, 2);
  assert.equal(activities[0].body, "second note");
  assert.equal(activities[1].body, "first note");
  assert.equal(activities[0].kind, "note");
  assert.equal(activities[0].direction, "system");
});

test("tasks open by default and toggle to done with a completed timestamp", async () => {
  await resetDatabases();
  const customer = await createCustomer({ name: "Task Co" });
  const task = await createTask(customer.id, {
    title: "Send proposal",
    dueDate: "2026-11-01",
    assignee: "Dana",
  });
  assert.equal(task.status, "open");
  assert.equal(task.revision, 0);
  assert.equal(task.completedAt, undefined);

  const done = await toggleTask(task);
  assert.equal(done.status, "done");
  assert.ok(done.completedAt);
  assert.equal(done.revision, 1);

  const tasks = await listTasks(customer.id);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].status, "done");
});

test("the task list puts open tasks first and orders by due date", async () => {
  await resetDatabases();
  const customer = await createCustomer({ name: "Order Co" });
  await createTask(customer.id, { title: "Open later", dueDate: "2026-12-01" });
  await createTask(customer.id, { title: "Open sooner", dueDate: "2026-11-01" });
  const done = await createTask(customer.id, { title: "Done sooner", dueDate: "2026-10-01" });
  await toggleTask(done);

  const titles = (await listTasks(customer.id)).map((task) => task.title);
  assert.deepEqual(titles, ["Open sooner", "Open later", "Done sooner"]);
});

test("stage and customer link persist through the workspace save path", async () => {
  await resetDatabases();
  const workspace = createWorkspace();
  await updateWorkspaceRow(workspace.id, () => ({ workspace, serverRevision: 0, dirty: false }));

  const customer = await createCustomer({ name: "Linked Co" });
  await setWorkspaceStage(workspace.id, "in_progress");
  await linkWorkspaceToCustomer(workspace.id, customer.id);

  const row = await readWorkspaceRow(workspace.id);
  assert.equal(row?.workspace.stage, "in_progress");
  assert.equal(row?.workspace.customerId, customer.id);
});
