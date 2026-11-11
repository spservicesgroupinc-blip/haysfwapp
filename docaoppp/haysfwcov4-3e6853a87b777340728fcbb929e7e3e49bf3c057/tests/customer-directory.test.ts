import { test } from "node:test";
import assert from "node:assert/strict";
import {
  customerIdForPick,
  customerIdOfOption,
  customerOptionId,
  customerOptions,
  automaticJobMatch,
} from "../src/services/customerDirectory";

test("full matching values select automatically while ambiguous customer names do not", () => {
  const first = job();
  assert.equal(automaticJobMatch(" f-26-0366-p ", [first]), first);
  assert.equal(automaticJobMatch("York Ridge Apartments", [first]), first);
  assert.equal(automaticJobMatch("York Ridge", [first]), undefined);
  assert.equal(automaticJobMatch("York Ridge Apartments", [first, job({ id: "job-2", jobNumber: "OTHER" })]), undefined);
});
import type { CustomerSummary } from "../src/crm/types";
import type { JobEntry } from "../src/types";

function job(overrides: Partial<JobEntry> = {}): JobEntry {
  return {
    id: "job-1",
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

function customer(overrides: Partial<CustomerSummary> = {}): CustomerSummary {
  return {
    id: "cust-1",
    name: "York Ridge Apartments",
    phone: "260-555-0144",
    email: "dana@yorkridge.example.com",
    address: "1200 York St, Fort Wayne, IN 46802",
    jobCount: 1,
    openTaskCount: 0,
    updatedAt: "2026-10-01T12:00:00.000Z",
    ...overrides,
  };
}

test("a customer with an active directory job is not offered twice", () => {
  const options = customerOptions([job()], [customer()]);
  assert.deepEqual(options, []);
});

test("a customer whose job is no longer listed stays searchable", () => {
  // The upload was replaced or the job was closed, but the customer record and
  // its contact details are still there for the next change order.
  const options = customerOptions([job({ active: false })], [customer()]);
  assert.equal(options.length, 1);
  assert.equal(options[0].customer, "York Ridge Apartments");
  assert.equal(options[0].jobNumber, "");
  assert.equal(options[0].customerPhone, "260-555-0144");
  assert.equal(options[0].customerEmail, "dana@yorkridge.example.com");
  assert.equal(options[0].address, "1200 York St, Fort Wayne, IN 46802");
  assert.equal(options[0].contractAmount, "");
  assert.equal(options[0].active, true);
});

test("customer options are ordered by name and skip unnamed records", () => {
  const options = customerOptions(
    [],
    [
      customer({ id: "c2", name: "Beacon Health Pavilion" }),
      customer({ id: "c3", name: "   " }),
      customer({ id: "c1", name: "Alpha Restoration" }),
    ],
  );
  assert.deepEqual(
    options.map((option) => option.customer),
    ["Alpha Restoration", "Beacon Health Pavilion"],
  );
});

test("a customer option id maps back to the customer record", () => {
  assert.equal(customerIdOfOption(customerOptionId("cust-1")), "cust-1");
  assert.equal(customerIdOfOption("job-1"), undefined);
  assert.equal(customerIdOfOption(undefined), undefined);
});

test("a picked directory job links to the customer with the same name", () => {
  assert.equal(
    customerIdForPick(job(), [customer()], ""),
    "cust-1",
    "spelling differences in case and spacing still match",
  );
  assert.equal(
    customerIdForPick(job({ customer: "Unlisted Co" }), [customer()], ""),
    undefined,
  );
});

test("a typed customer name links to the loaded customer record", () => {
  assert.equal(
    customerIdForPick(null, [customer()], "  york ridge   APARTMENTS "),
    "cust-1",
  );
  assert.equal(customerIdForPick(null, [customer()], "Someone Else"), undefined);
  assert.equal(customerIdForPick(null, [customer()], ""), undefined);
});

test("an ambiguous customer name needs an explicit customer pick", () => {
  const customers = [customer(), customer({ id: "cust-2", email: "other@example.test" })];
  assert.equal(customerIdForPick(null, customers, "York Ridge Apartments"), undefined);
  assert.equal(customerIdForPick(job(), customers, ""), undefined);
  assert.equal(customerIdForPick(job({ id: customerOptionId("cust-2") }), customers, ""), "cust-2");
});
