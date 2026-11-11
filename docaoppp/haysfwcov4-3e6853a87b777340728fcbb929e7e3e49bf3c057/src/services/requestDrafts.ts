import type { ChangeRequest, JobEntry, RequestAttachment } from "../types";
import { API_URL, type uploadAttachment } from "./storage";

export interface DraftFile { name: string; type: string; lastModified: number; blob: Blob }
export interface DraftPhoto extends DraftFile { id: string; edited: boolean }
export interface DraftValues {
  customerText: string;
  selectedJob: JobEntry | null;
  initialRequest?: ChangeRequest;
  note: string;
  requestType?: ChangeRequest["requestType"];
  customerCredits: boolean;
  amount: string;
  amountSign: "+" | "-";
  emailAddress: string;
  photos: DraftPhoto[];
  pdf: DraftFile | null;
}
export type UploadFile = Parameters<typeof uploadAttachment>[1];
export interface SubmissionCheckpoint {
  request: ChangeRequest;
  saveMutation: string;
  attachMutation: string;
  uploads: { source: DraftFile; kind: "photo" | "document"; attachmentId: string; mutationId: string; prepared?: UploadFile; uploaded?: RequestAttachment }[];
  saved?: ChangeRequest;
  linked?: ChangeRequest;
  email: "idle" | "sending" | "sent" | "uncertain";
  emailError?: string;
}
export interface RequestDraft {
  id: string;
  scope: string;
  updatedAt: string;
  values: DraftValues;
  submission?: SubmissionCheckpoint;
}
let connection: Promise<IDBDatabase> | undefined;
function database() {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("hays-request-drafts-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts", {keyPath: ["scope", "id"]});
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); connection = undefined; }; resolve(request.result); };
    request.onerror = () => { connection = undefined; reject(request.error || new Error("Device storage is unavailable.")); };
  });
  return connection;
}
async function operation<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", mode);
    const request = work(tx.objectStore("drafts"));
    tx.oncomplete = () => { if (mode === "readwrite" && typeof window !== "undefined") window.dispatchEvent(new Event("request-drafts-changed")); resolve(request.result as T); };
    tx.onabort = tx.onerror = () => reject(tx.error || new Error("Draft could not be saved. Keep this page open and retry."));
  });
}
export const readDraft = (id: string, scope = API_URL) => operation<RequestDraft | undefined>("readonly", store => store.get([scope, id]));
export async function listDrafts(scope = API_URL) {
  const rows = await operation<RequestDraft[]>("readonly", store => store.getAll());
  return rows.filter(row => row.scope === scope).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function saveDraft(row: RequestDraft) {
  const db=await database();
  await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction("drafts","readwrite");const store=tx.objectStore("drafts");
    const current=store.get([row.scope,row.id]);let conflict=false;
    current.onsuccess=()=>{
      const existing=current.result as RequestDraft|undefined;
      if(existing?.submission && existing.submission.saveMutation!==row.submission?.saveMutation){conflict=true;tx.abort();return;}
      store.put(row);
    };
    tx.oncomplete=()=>{if(typeof window!=="undefined")window.dispatchEvent(new Event("request-drafts-changed"));resolve();};
    tx.onabort=tx.onerror=()=>reject(conflict?new Error("This draft is already being submitted. Open Requests to continue."):tx.error||new Error("Draft could not be saved. Keep this page open and retry."));
  });
}
export async function deleteDraft(id: string, scope = API_URL) { await operation("readwrite", store => store.delete([scope,id])); }
export function subscribeDrafts(callback: () => void) {
  window.addEventListener("request-drafts-changed", callback);
  return () => window.removeEventListener("request-drafts-changed", callback);
}
