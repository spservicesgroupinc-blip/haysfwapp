import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOMER_REFERENCE_CHANGED,
  CUSTOMER_REFERENCE_CACHE_KEY,
  getCachedCustomerReference,
  getCustomerReference,
  replaceCustomerReference,
} from "../src/documents/services/customerReferenceService";
import { customerReferenceJobs, jobsToCustomerReferences } from "../src/services/customerReferenceJobs";
import type { CustomerReferenceSnapshot } from "../src/documents/services/customerReference";

const snapshot: CustomerReferenceSnapshot = {
  customers: [{ customerName: "Jane", jobNumber: " FW-123 ", contractPrice: 0, jobAddress: "10 Main St", city: "Fort Wayne", state: "IN", zip: "46802", customerPhone: "260-555-0123", carrier: "Acme", claim: "CL-12" }],
  fileName: "customers.csv", updatedAt: "2026-10-22T12:00:00.000Z", updatedBy: "Office", version: "v1",
};

test("shared reference converts to stable job options and back without losing location or zero price", () => {
  const jobs = customerReferenceJobs(snapshot);
  assert.equal(jobs[0].id, "reference:FW-123");
  assert.equal(jobs[0].address, "10 Main St, Fort Wayne IN 46802");
  assert.equal(jobs[0].contractAmount, "0.00");
  assert.equal(jobs[0].claim, "CL-12");
  assert.equal(jobsToCustomerReferences(jobs)[0].jobAddress, "10 Main St");
  assert.equal(jobsToCustomerReferences(jobs)[0].city, "Fort Wayne");
  assert.equal(jobsToCustomerReferences(jobs)[0].contractPrice, 0);
  assert.equal(customerReferenceJobs({ ...snapshot, customers: [{ ...snapshot.customers[0], status: "Closed", contractPrice: null }] })[0].active, false);
});

test("shared reference refresh caches valid snapshots and emits changes only after successful replacement", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const data = new Map<string, string>();
  const events = new EventTarget();
  let changed = 0;
  events.addEventListener(CUSTOMER_REFERENCE_CHANGED, event => {
    changed++;
    assert.equal((event as CustomEvent<CustomerReferenceSnapshot>).detail.version, "v1");
  });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: events });
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, reference: snapshot }))) as typeof fetch;
  try {
    assert.equal(getCachedCustomerReference(), null);
    assert.equal((await getCustomerReference()).customers[0].customerName, "Jane");
    assert.equal(getCachedCustomerReference()?.customers[0].claim, "CL-12");
    assert.equal(changed, 0);
    await replaceCustomerReference(snapshot.customers, snapshot.fileName);
    assert.equal(changed, 1);
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, error: "Cannot save" }))) as typeof fetch;
    await assert.rejects(() => replaceCustomerReference(snapshot.customers, "new.csv"), /Cannot save/);
    assert.equal(changed, 1);
    assert.equal(getCachedCustomerReference()?.fileName, "customers.csv");
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, reference: { ...snapshot, customers: [{ ...snapshot.customers[0], customerPhone: {} }] } }))) as typeof fetch;
    await assert.rejects(() => getCustomerReference(), /invalid customer reference/);
    assert.equal(getCachedCustomerReference()?.customers[0].customerPhone, "260-555-0123");
    data.set(CUSTOMER_REFERENCE_CACHE_KEY, JSON.stringify({ ...snapshot, customers: [{ ...snapshot.customers[0], contractPrice: "bad" }] }));
    assert.equal(getCachedCustomerReference(), null);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("a delayed refresh cannot replace a confirmed import in the cache or its returned result", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const data = new Map<string, string>();
  const latest = { ...snapshot, fileName: "latest.csv", version: "v2", customers: [{ ...snapshot.customers[0], customerName: "Updated customer" }] };
  let finishOldRead!: (value: Response) => void;
  const delayedRead = new Promise<Response>(resolve => { finishOldRead = resolve; });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  globalThis.fetch = (async (_url: unknown, options?: RequestInit) => {
    const { action } = JSON.parse(String(options?.body));
    return action === "getCustomerReference" ? delayedRead : new Response(JSON.stringify({ ok: true, reference: latest }));
  }) as typeof fetch;
  try {
    const oldRead = getCustomerReference();
    await replaceCustomerReference(latest.customers, latest.fileName);
    finishOldRead(new Response(JSON.stringify({ ok: true, reference: snapshot })));
    assert.equal((await oldRead).version, "v2");
    assert.equal(getCachedCustomerReference()?.version, "v2");
    assert.equal(getCachedCustomerReference()?.customers[0].customerName, "Updated customer");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
