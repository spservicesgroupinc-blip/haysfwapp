import type { DocumentRow, WorkspaceRow } from "./types";

const DATABASE = "hays-job-workspaces-v1";
let connection: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const open = indexedDB.open(DATABASE, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore("workspaces", { keyPath: "workspace.id" });
      const documents = open.result.createObjectStore("documents", {
        keyPath: "document.id",
      });
      documents.createIndex("workspace", "document.workspaceId");
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
    const req = operation(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result as T);
    tx.onabort = tx.onerror = () =>
      reject(tx.error || new Error("Could not read device storage."));
  });
}

/** Read and replace in one transaction, so competing tabs cannot drop newer edits. */
async function update<T>(
  store: string,
  id: string,
  change: (current: T | undefined) => T | undefined,
): Promise<T | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const table = tx.objectStore(store);
    const request = table.get(id);
    let result: T | undefined;
    request.onsuccess = () => {
      try {
        result = change(request.result as T | undefined);
        if (result) table.put(result);
      } catch (error) {
        tx.abort();
        reject(error);
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () =>
      reject(
        tx.error ||
          new Error(
            "Device save did not finish. Keep this page open and retry.",
          ),
      );
  });
}

export const readWorkspaceRows = () =>
  read<WorkspaceRow[]>("workspaces", (store) => store.getAll());
export const readWorkspaceRow = (id: string) =>
  read<WorkspaceRow | undefined>("workspaces", (store) => store.get(id));
export const updateWorkspaceRow = (
  id: string,
  change: (current: WorkspaceRow | undefined) => WorkspaceRow | undefined,
) => update("workspaces", id, change);
export const readDocumentRows = (workspaceId?: string) =>
  read<DocumentRow[]>("documents", (store) =>
    workspaceId ? store.index("workspace").getAll(workspaceId) : store.getAll(),
  );
export const readDocumentRow = (id: string) =>
  read<DocumentRow | undefined>("documents", (store) => store.get(id));
export const updateDocumentRow = (
  id: string,
  change: (current: DocumentRow | undefined) => DocumentRow | undefined,
) => update("documents", id, change);
