import { test, expect, type Page } from "@playwright/test";

/**
 * The UI is installed as a standalone PWA, so a phone gives the user exactly
 * two ways out of a screen: the in-app controls and the system back gesture.
 * These tests pin both, for the simplified app: the dashboard, the quick
 * request form, and a single change-order review page.
 */
const apiRoute =
  /\/__api__(?:\?|$)|https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?|$)/;

const queuedRequest = {
  id: "r1",
  revision: 1,
  createdAt: "",
  updatedAt: "2026-10-01T12:00:00.000Z",
  status: "submitted",
  estimatorName: "",
  changesCount: 1,
  attachmentsCount: 0,
  job: {
    customer: "York Ridge Apartments",
    jobNumber: "F-26-0366-P",
    projectManager: "Dana Whitfield",
    orderNumber: "",
    address: "1200 York St",
  },
  requestedChanges: [
    {
      id: "c1",
      room: "",
      action: "add",
      description: "Wet insulation behind the kitchen wall",
      reason: "",
      measurements: "",
      materials: "",
      scheduleImpact: "",
    },
  ],
  attachments: [],
};

async function installMockApi(page: Page) {
  // The admin's job directory, replaced wholesale by each import.
  const directory: Record<string, unknown>[] = [];
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
    const respond = (obj: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(obj),
      });
    if (action === "bootstrap" || action === "listRequests")
      return respond({ ok: true, requests: [queuedRequest], jobs: directory });
    if (action === "listJobs") return respond({ ok: true, jobs: directory });
    if (action === "importJobs") {
      directory.length = 0;
      directory.push(...((body.jobs as Record<string, unknown>[]) ?? []));
      return respond({ ok: true, jobs: directory });
    }
    if (action === "openRequest")
      return respond({ ok: true, request: queuedRequest });
    if (action === "claimRequest")
      return respond({
        ok: true,
        request: {
          ...queuedRequest,
          status: "in_review",
          estimatorName: String(body.estimatorName ?? ""),
        },
      });
    if (action === "transitionRequest")
      return respond({
        ok: true,
        request: {
          ...queuedRequest,
          status: String(body.status ?? "submitted"),
        },
      });
    return respond({ ok: true });
  });
}

test.beforeEach(async ({ page }) => {
  await installMockApi(page);
});

const dashboard = (page: Page) =>
  page.getByRole("heading", { name: "Change orders", exact: true });

test("the quick request form opens from the header and the home button", async ({
  page,
}) => {
  await page.goto("/");
  await expect(dashboard(page)).toBeVisible();

  await page
    .getByRole("button", { name: "Quick request", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Quick request", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/simple");

  await page
    .getByRole("button", { name: "Back to requests", exact: true })
    .click();
  await expect(dashboard(page)).toBeVisible();

  await page.getByRole("button", { name: "New request", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Quick request", exact: true }),
  ).toBeVisible();
});

test("a phone can open the menu, find the sections, and Escape closes it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const menu = page.getByRole("button", { name: "Menu", exact: true });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("button", { name: "Quick request", exact: true }),
  ).toBeVisible();
  const box = await page
    .getByRole("button", { name: "Quick request", exact: true })
    .boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
});

test("the back gesture returns to the request list instead of leaving the app", async ({
  page,
}) => {
  await page.goto("/");
  await expect(dashboard(page)).toBeVisible();

  await page
    .getByRole("button", { name: /^In queue York Ridge Apartments/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "In queue", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toMatch(/^#\/requests\//);

  await page.goBack();
  await expect(dashboard(page)).toBeVisible();
});

test("cold launch opens the dashboard and the brand returns home from a section", async ({
  page,
}) => {
  await page.goto("/#/simple");
  await expect(dashboard(page)).toBeVisible();
  await page
    .getByRole("button", { name: "Quick request", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Quick request", exact: true }),
  ).toBeVisible();

  await page
    .getByRole("link", { name: "Hays + Sons change orders home" })
    .click();
  await expect(dashboard(page)).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/review");

  await page.reload();
  await expect(dashboard(page)).toBeVisible();
});

test("the header switches between Quick request and Estimator review", async ({
  page,
}) => {
  await page.goto("/");
  await expect(dashboard(page)).toBeVisible();

  await page
    .getByRole("button", { name: "Quick request", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Quick request", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/simple");

  await page
    .getByRole("button", { name: "Estimator review", exact: true })
    .click();
  await expect(dashboard(page)).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/review");
});

test("the import jobs page opens from the header and cold launch returns home", async ({
  page,
}) => {
  await page.goto("/#/jobs");
  await expect(dashboard(page)).toBeVisible();
  await page.getByRole("button", { name: "Import jobs", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Import jobs for auto-complete",
      exact: true,
    }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/jobs");
  await page.reload();
  await expect(dashboard(page)).toBeVisible();
});
