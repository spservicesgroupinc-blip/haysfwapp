import type { Activity, Customer, Task } from "./types";

const DATABASE = "hays-crm-v1";

let connection: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const open = indexedDB.open(DATABASE, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore("customers", { keyPath: "id" });
      open.result.createObjectStore("activities", { keyPath: "id" });
      open.result.createObjectStore("tasks", { keyPath: "id" });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => {
      connection = undefined;
      reject(open.error);
    };
  });
  return connection;
}

async function read<T>(
  store: string,
  operation: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const request = operation(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result as T);
    tx.onabort = tx.onerror = () =>
      reject(tx.error || new Error("Could not read device storage."));
  });
}

async function putValue<T>(store: string, value: T): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error || new Error("Could not write device storage."));
  });
}

/** Writes without notifying subscribers, so server refreshes don't re-trigger reads. */
async function putValueSilent<T>(store: string, value: T): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error || new Error("Could not write device storage."));
  });
}

async function deleteValue(store: string, id: string): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error || new Error("Could not write device storage."));
  });
}

const listeners = new Set<() => void>();
let channel: BroadcastChannel | undefined;

const emit = () => {
  listeners.forEach((listener) => listener());
  channel?.postMessage("changed");
};

export const listLocalCustomers = () =>
  read<Customer[]>("customers", (store) => store.getAll());

export const getLocalCustomer = (id: string) =>
  read<Customer | undefined>("customers", (store) => store.get(id));

export const putCustomer = async (customer: Customer): Promise<void> => {
  await putValue("customers", customer);
  emit();
};

/** Used by mergeCustomers to drop the merged-away source row. */
export const deleteCustomer = async (id: string): Promise<void> => {
  await deleteValue("customers", id);
  emit();
};

export const listLocalActivities = (customerId: string) =>
  read<Activity[]>("activities", (store) => store.getAll()).then((rows) =>
    rows.filter((activity) => activity.customerId === customerId),
  );

export const putActivity = async (activity: Activity): Promise<void> => {
  await putValue("activities", activity);
  emit();
};

export const listLocalTasks = (customerId: string) =>
  read<Task[]>("tasks", (store) => store.getAll()).then((rows) =>
    rows.filter((task) => task.customerId === customerId),
  );

/** Used for local openTaskCount enrichment. */
export const listAllLocalTasks = () =>
  read<Task[]>("tasks", (store) => store.getAll());

export const putTask = async (task: Task): Promise<void> => {
  await putValue("tasks", task);
  emit();
};

export const putCustomerSilent = (customer: Customer) =>
  putValueSilent("customers", customer);
export const putActivitySilent = (activity: Activity) =>
  putValueSilent("activities", activity);
export const putTaskSilent = (task: Task) =>
  putValueSilent("tasks", task);

/** Fires on CRM mutations in this tab and (via BroadcastChannel) across tabs. */
export const subscribe = (listener: () => void): (() => void) => {
  if (typeof BroadcastChannel !== "undefined" && !channel) {
    channel = new BroadcastChannel("hays-crm-events");
    channel.onmessage = () => listeners.forEach((item) => item());
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
