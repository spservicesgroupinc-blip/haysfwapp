import { test, expect, type Page } from "@playwright/test";
import { mockBackend } from "./helpers/backend";

const csv = "Status,Job Number,Customer,Customer Main Phone,Customer Email,Job Address,Loss City,Loss State,Loss ZIP,Estimator,ForePerson,Supervisor,Estimate Amount,Total Contract Sales,Insurance Carrier,Claim Number,Date Inspected\nWork in Progress,FW-AUTO-1,Automatic Customer,260-555-0123,auto@example.test,100 Test St,Fort Wayne,IN,46802,CSV Estimator,CSV Foreperson,CSV Supervisor,999.99,1234.56,CSV Carrier,CLAIM-AUTO-1,10/12/2026 12:00:00";

async function sandbox(page: Page) {
  const backend = mockBackend();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (["localhost", "127.0.0.1"].includes(url.hostname) && !url.pathname.includes("__api__")) return route.continue();
    if (!["fetch", "xhr"].includes(request.resourceType())) return route.abort();
    const body = request.method() === "POST" ? JSON.parse(request.postData() || "{}") : Object.fromEntries(url.searchParams);
    const result = request.method() === "POST" ? backend.post(body) : backend.get(body);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
  });
  return { backend, errors };
}

for (const entrypoint of ["reference", "jobs"]) {
  test(`${entrypoint} CSV automatically connects customers, quick requests and new job details`, async ({ page }) => {
    const { backend, errors } = await sandbox(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(entrypoint === "reference" ? "/#/workspaces?tool=reference" : "/#/jobs");
    if (entrypoint === "reference") {
      await page.getByLabel("Choose customer CSV", { exact: true }).setInputFiles({ name: "jobs.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
      await page.getByRole("button", { name: "Replace knowledge base", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Saved 1 customer/job rows" })).toBeVisible();
    } else {
      await page.getByLabel("Paste job report CSV").fill(csv);
      await page.getByRole("button", { name: "Import 1 job", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("Successfully imported 1 jobs");
    }
    expect(backend.post({ action: "listCustomers" }).customers).toHaveLength(1);
    // Navigate within this app so the upload event, rather than a reload, supplies the lookup.
    await page.getByRole("button", { name: "New request", exact: true }).first().click();
    await page.getByRole("combobox").fill("FW-AUTO-1");
    await expect(page.locator(".sr-summary")).toContainText("260-555-0123");
    await expect(page.locator(".sr-summary")).toContainText("100 Test St");
    await expect(page.locator(".sr-summary")).toContainText("$1,234.56");
    await page.getByLabel("What changed?", { exact: true }).fill("Add the requested pantry shelving.");
    await page.getByRole("button", { name: "Send to estimating", exact: true }).click();
    await expect.poll(() => backend.get({ action: "listRequests" }).requests.length).toBe(1);
    const summary = backend.get({ action: "listRequests" }).requests[0];
    const submitted = backend.get({ action: "openRequest", id: summary.id }).request;
    expect(submitted.job).toMatchObject({
      originalContract: "1234.56", customer: "Automatic Customer", jobNumber: "FW-AUTO-1",
      customerPhone: "260-555-0123", customerEmail: "auto@example.test",
      projectManager: "CSV Foreperson", branchContact: "CSV Estimator",
      carrier: "CSV Carrier", claim: "CLAIM-AUTO-1",
    });
    await page.goto(`/#/requests/${submitted.id}`);
    await page.getByRole("button", { name: "Edit request", exact: true }).click();
    await expect(page.getByLabel("Original contract amount", { exact: true })).toHaveValue("1234.56");
    await page.goto("/#/workspaces");
    await page.getByRole("button", { name: "New job", exact: true }).click();
    await page.getByRole("textbox", { name: "Job number*", exact: true }).fill("FW-AUTO-1");
    await expect(page.getByLabel("Main phone", { exact: true })).toHaveValue("260-555-0123");
    await expect(page.getByLabel("Customer name", { exact: false })).toHaveValue("Automatic Customer");
    await expect(page.getByLabel("Loss address", { exact: false })).toHaveValue("100 Test St, Fort Wayne IN 46802");
    await expect(page.getByLabel("Original contract amount", { exact: true })).toHaveValue("1234.56");
    expect(errors).toEqual([]);
  });
}
