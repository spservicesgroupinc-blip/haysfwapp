import { test, expect } from "@playwright/test";
import { mockBackend } from "./helpers/backend";
import { createWorkspace } from "../src/workspaces/model";
import type { JobEntry } from "../src/types";

test("a matching saved job fills automatically, preserves reviewed details, and survives reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const entry: JobEntry = {
    id: "csv-job-1",
    jobNumber: "FW-CSV-100",
    customer: "CSV Customer",
    address: "18 Lake St, Fort Wayne, IN 46802",
    projectManager: "CSV Manager",
    estimator: "CSV Estimator",
    status: "Active",
    customerPhone: "260-555-0133",
    customerEmail: "csv@example.com",
    contractAmount: "12400.50",
    active: true,
    updatedAt: "2026-10-22T12:00:00Z",
  };
  const backend = mockBackend();
  backend.post({
    action: "importJobs",
    jobs: [
      entry,
      {
        ...entry,
        id: "csv-job-2",
        jobNumber: "FW-CSV-200",
        address: "200 Other Street",
      },
    ],
  });
  const workspace = createWorkspace();
  workspace.record.customer.jobNumber = entry.jobNumber;
  workspace.record.customer.customerName = "CSV Customer reviewed";
  workspace.record.customer.email = "reviewed@example.com";
  workspace.record.team.estimator = "";
  const saved = backend.post({
    action: "saveWorkspace",
    workspace,
    expectedRevision: 0,
    mutationId: "seed-job",
  });
  expect(saved.ok, saved.error).toBe(true);
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
      !url.pathname.includes("__api__")
    )
      return route.continue();
    if (!["fetch", "xhr"].includes(request.resourceType()))
      return route.abort();
    const body =
      request.method() === "POST"
        ? JSON.parse(request.postData() || "{}")
        : Object.fromEntries(url.searchParams);
    const result =
      request.method() === "POST" ? backend.post(body) : backend.get(body);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.goto(`/#/workspaces/${workspace.id}`);
  await page.getByRole("button", { name: "Job Details", exact: true }).click();
  await expect(page.getByLabel("Customer name", { exact: false })).toHaveValue(
    "CSV Customer reviewed",
  );
  await expect(page.getByLabel("Main phone", { exact: true })).toHaveValue(
    "260-555-0133",
  );
  await expect(page.getByLabel("Customer name", { exact: false })).toHaveValue(
    "CSV Customer reviewed",
  );
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue(
    "reviewed@example.com",
  );
  await expect(page.getByLabel("Loss address", { exact: false })).toHaveValue(
    entry.address,
  );
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(page.locator(".workspace-sync")).toContainText(
    "Saved to shared workspace",
  );
  await page.reload();
  await page.getByRole("button", { name: "Job Details", exact: true }).click();
  await expect(page.getByLabel("Main phone", { exact: true })).toHaveValue(
    entry.customerPhone,
  );
  await expect(page.getByLabel("Customer name", { exact: false })).toHaveValue(
    "CSV Customer reviewed",
  );
  await page
    .locator("summary")
    .filter({ hasText: /^Financials$/ })
    .click();
  await expect(
    page.getByLabel("Original contract amount", { exact: true }),
  ).toHaveValue(entry.contractAmount);
  await expect(
    page.getByLabel("Total approved RCV", { exact: true }),
  ).toHaveValue("");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
