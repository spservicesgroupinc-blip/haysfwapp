import { test, expect, type Page } from "@playwright/test";

/**
 * Customer directory happy path: create, timeline notes, communication log,
 * tasks, and merge — all against the same mocked Apps Script the rest of the
 * browser suite uses. serviceWorkers are blocked by the shared config.
 */
const apiRoute =
  /\/__api__(?:\?|$)|https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?|$)/;

async function installMockApi(page: Page) {
  const customers = new Map<string, Record<string, any>>();
  const activities = new Map<string, Record<string, any>[]>();
  const tasks = new Map<string, Record<string, any>[]>();

  const summarize = (c: Record<string, any>) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    address: c.address,
    tags: c.tags,
    jobCount: 0,
    openTaskCount: (tasks.get(c.id) ?? []).filter(
      (t) => t.status === "open",
    ).length,
    updatedAt: c.updatedAt,
  });

  await page.route(apiRoute, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let action = url.searchParams.get("action") ?? "";
    let body: Record<string, any> = {};
    if (request.method() === "POST") {
      try {
        body = JSON.parse(request.postData() ?? "{}");
      } catch {
        body = {};
      }
      action = String(body.action ?? action);
    }
    const respond = (obj: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(obj),
      });

    switch (action) {
      case "bootstrap":
      case "listRequests":
        return respond({ ok: true, requests: [] });
      case "listJobs":
        return respond({ ok: true, jobs: [] });
      case "listWorkspaces":
        return respond({ ok: true, workspaces: [] });
      case "listCustomers":
        return respond({
          ok: true,
          customers: [...customers.values()].map(summarize),
        });
      case "openCustomer": {
        const customerId = String(body.customerId ?? url.searchParams.get("customerId"));
        const found = customers.get(customerId);
        return found
          ? respond({ ok: true, customer: found })
          : respond({ ok: false, error: "Customer not found" }, 404);
      }
      case "saveCustomer": {
        const incoming = body.customer ?? {};
        const previous = customers.get(incoming.id);
        const next = {
          ...previous,
          ...incoming,
          revision: Number(body.expectedRevision ?? (previous?.revision ?? 0)) + 1,
          updatedAt: new Date().toISOString(),
        };
        customers.set(next.id, next);
        return respond({ ok: true, customer: next });
      }
      case "mergeCustomers": {
        const target = customers.get(String(body.targetId));
        const source = customers.get(String(body.sourceId));
        if (!target || !source)
          return respond({ ok: false, error: "Customer not found" }, 404);
        target.mergedFromIds = [...(target.mergedFromIds ?? []), source.id];
        target.revision = (target.revision ?? 0) + 1;
        target.updatedAt = new Date().toISOString();
        customers.delete(source.id);
        activities.set(target.id, [
          ...(activities.get(target.id) ?? []),
          ...(activities.get(source.id) ?? []),
        ]);
        tasks.set(target.id, [
          ...(tasks.get(target.id) ?? []),
          ...(tasks.get(source.id) ?? []),
        ]);
        activities.delete(source.id);
        tasks.delete(source.id);
        return respond({ ok: true, customer: target });
      }
      case "listActivities": {
        const customerId = String(body.customerId ?? url.searchParams.get("customerId"));
        return respond({ ok: true, activities: activities.get(customerId) ?? [] });
      }
      case "addActivity": {
        const activity = body.activity ?? {};
        const list = activities.get(activity.customerId) ?? [];
        if (!list.some((a) => a.id === activity.id)) {
          list.push(activity);
          activities.set(activity.customerId, list);
        }
        return respond({ ok: true, activity });
      }
      case "listTasks": {
        const customerId = String(body.customerId ?? url.searchParams.get("customerId"));
        return respond({ ok: true, tasks: tasks.get(customerId) ?? [] });
      }
      case "saveTask": {
        const task = body.task ?? {};
        const list = tasks.get(task.customerId) ?? [];
        const next = { ...task, revision: Number(body.expectedRevision ?? 0) + 1 };
        const index = list.findIndex((t) => t.id === task.id);
        if (index >= 0) list[index] = next;
        else list.push(next);
        tasks.set(task.customerId, list);
        return respond({ ok: true, task: next });
      }
      default:
        return respond({ ok: true });
    }
  });
}

test.beforeEach(async ({ page }) => {
  await installMockApi(page);
});

test("customer directory: create, timeline, tasks, and merge", async ({ page }) => {
  await page.goto("/#/customers");
  await expect(
    page.getByRole("heading", { name: "Customers", exact: true }),
  ).toBeVisible();

  // Create the first customer.
  await page.getByRole("button", { name: "New customer", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Acme Roofing");
  await page.getByLabel("Phone", { exact: true }).fill("260-555-0101");
  await page.getByLabel("Email", { exact: true }).fill("office@acme.example");
  await page.getByLabel("Address", { exact: true }).fill("100 Red Oak Dr");
  await page
    .getByRole("button", { name: "Create customer", exact: true })
    .click();

  await expect(
    page.getByRole("button", { name: /Acme Roofing/ }),
  ).toBeVisible();

  // Open the detail page.
  await page.getByRole("button", { name: /Acme Roofing/ }).click();
  await expect(
    page.getByRole("heading", { name: "Acme Roofing", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toMatch(/^#\/customers\//);

  // Add a note.
  await page
    .getByLabel("Add a note")
    .fill("Followed up with the adjuster about the supplement.");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(
    page.getByText("Followed up with the adjuster about the supplement."),
  ).toBeVisible();

  // Log a call.
  await page
    .getByRole("button", { name: "Log communication", exact: true })
    .click();
  await page.getByLabel("Type", { exact: true }).selectOption("call");
  await page.getByLabel("Direction", { exact: true }).selectOption("outbound");
  await page.getByLabel("Summary", { exact: true }).fill("Discussed scope with the owner.");
  await page
    .getByRole("button", { name: "Add to timeline", exact: true })
    .click();
  await expect(page.getByText("Discussed scope with the owner.")).toBeVisible();

  // Add a task and mark it done.
  await page.getByLabel("Task", { exact: true }).fill("Send proposal");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  const toggle = page.getByRole("checkbox", { name: /Send proposal/ });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toBeChecked();

  // Back to the directory and create a second customer.
  await page
    .getByRole("button", { name: "Back to customers", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Customers", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New customer", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Beta Plumbing");
  await page
    .getByRole("button", { name: "Create customer", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Beta Plumbing/ }),
  ).toBeVisible();

  // Open Acme and merge Beta into it.
  await page.getByRole("button", { name: /Acme Roofing/ }).click();
  await expect(
    page.getByRole("heading", { name: "Acme Roofing", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Merge", exact: true }).click();
  await page
    .getByLabel("Customer to merge", { exact: true })
    .selectOption({ label: "Beta Plumbing" });
  await page
    .getByRole("button", { name: "Merge into this customer", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Acme Roofing", exact: true }),
  ).toBeVisible();

  // Back to the directory: Beta is gone, Acme remains.
  await page
    .getByRole("button", { name: "Back to customers", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Acme Roofing/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Beta Plumbing/ })).toHaveCount(0);
});
