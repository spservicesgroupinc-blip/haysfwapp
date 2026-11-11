import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequest } from "../src/services/requests";

/**
 * The quick request tab is the project manager's phone-first intake: pick the
 * customer, shoot or choose photos, mark them up, dictate a note, and send.
 * These tests pin that path against the same mocked Apps Script the rest of the
 * browser suite uses.
 */
const apiRoute =
  /\/__api__(?:\?|$)|https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?|$)/;

const jobs = [
  {
    id: "job-1",
    jobNumber: "F-26-0366-P",
    customer: "York Ridge Apartments",
    address: "1200 York St, Fort Wayne, IN 46802",
    projectManager: "Dana Whitfield",
    estimator: "QA Estimator",
    status: "Active",
    customerPhone: "260-555-0144",
    customerEmail: "dana@example.com",
    contractAmount: "167045.81",
    active: true,
    updatedAt: "2026-10-01T12:00:00.000Z",
  },
  {
    id: "job-2",
    jobNumber: "F-26-0401-P",
    customer: "Maple Court Duplex",
    address: "88 Maple Ct, Fort Wayne, IN 46805",
    projectManager: "Ray Alvarez",
    estimator: "QA Estimator",
    status: "Active",
    customerPhone: "260-555-0177",
    customerEmail: "ray@example.com",
    contractAmount: "84210.00",
    active: true,
    updatedAt: "2026-10-02T12:00:00.000Z",
  },
];

interface UploadCall {
  kind: string;
  name: string;
  mimeType: string;
  bytes: number;
  attachmentId: string;
  mutationId: string;
  failed: boolean;
}

interface MockApi {
  /** Every action the app asked the Apps Script backend to perform, in order. */
  actions: string[];
  /** The request payloads the app saved, so the test can assert the intake. */
  saved: Record<string, any>[];
  emailed: Record<string, any>[];
  /** One row per upload attempt, including the ones that failed. */
  uploads: UploadCall[];
  transitions: { status: string; id: string; expectedRevision: number }[];
  /** Arm this to make the next attachment upload answer with an error. */
  failNextUpload: boolean;
  holdNextAction?: { action: string; wait: Promise<void> };
}

async function installMockApi(
  page: Page,
  directory: typeof jobs = jobs,
  seedRequests: Record<string, any>[] = [],
  customers: Record<string, any>[] = [],
): Promise<MockApi> {
  const requests = new Map<string, any>(
    seedRequests.map((request) => [request.id, request]),
  );
  // Files the upload endpoint is holding, keyed the way the Apps Script does.
  const uploadedFiles = new Map<
    string,
    { mutationId: string; attachment: Record<string, unknown> }
  >();
  const api: MockApi = {
    actions: [],
    saved: [],
    emailed: [],
    uploads: [],
    transitions: [],
    failNextUpload: false,
  };
  const summarize = (r: any) => ({
    id: r.id,
    revision: r.revision,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    status: r.status,
    estimatorName: r.estimatorName,
    changesCount: r.requestedChanges.length,
    attachmentsCount: r.attachments.length,
    job: {
      customer: r.job.customer,
      jobNumber: r.job.jobNumber,
      projectManager: r.job.projectManager,
      orderNumber: r.job.orderNumber,
      address: r.job.address,
    },
  });
  const commit = (request: any) => {
    const previous = requests.get(request.id);
    const next = {
      ...request,
      revision: (previous?.revision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    requests.set(next.id, next);
    return next;
  };
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
    api.actions.push(action);
    if (api.holdNextAction?.action === action) {
      const hold = api.holdNextAction;
      api.holdNextAction = undefined;
      await hold.wait;
    }
    const respond = (obj: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(obj),
      });
    const id = url.searchParams.get("id") ?? body.id;
    switch (action) {
      case "bootstrap":
        return respond({
          ok: true,
          requests: [...requests.values()].map(summarize),
          drafts: [],
          jobs: directory,
        });
      case "listRequests":
        return respond({
          ok: true,
          requests: [...requests.values()].map(summarize),
        });
      case "listDrafts":
      case "list":
        return respond({ ok: true, drafts: [] });
      case "listJobs":
        return respond({ ok: true, jobs: directory });
      case "listCustomers":
        return respond({ ok: true, customers });
      case "saveRequest":
        api.saved.push(body.request);
        return respond({ ok: true, request: commit(body.request) });
      case "openRequest":
        return respond({ ok: true, request: requests.get(id) });
      case "uploadAttachment": {
        const file = body.file ?? {};
        const call: UploadCall = {
          kind: String(file.kind ?? ""),
          name: String(file.name ?? ""),
          mimeType: String(file.mimeType ?? ""),
          bytes: String(file.data ?? "").length,
          attachmentId: String(body.attachmentId ?? ""),
          mutationId: String(body.mutationId ?? ""),
          failed: false,
        };
        if (api.failNextUpload) {
          api.failNextUpload = false;
          call.failed = true;
          api.uploads.push(call);
          return respond({ ok: false, error: "Upload failed. Try again." });
        }
        api.uploads.push(call);
        // Mirrors the Apps Script endpoint: the same (attachmentId, mutationId)
        // pair returns the file already stored instead of adding another copy.
        const stored = uploadedFiles.get(call.attachmentId);
        const attachment: Record<string, unknown> =
          stored && stored.mutationId === call.mutationId
            ? stored.attachment
            : {
                id: call.attachmentId,
                kind: file.kind,
                name: file.name,
                mimeType: file.mimeType,
                size: file.size,
                driveFileId: `drive-${call.attachmentId}`,
              };
        uploadedFiles.set(call.attachmentId, {
          mutationId: call.mutationId,
          attachment,
        });
        return respond({ ok: true, attachment });
      }
      case "transitionRequest": {
        api.transitions.push({
          status: String(body.status),
          id: String(body.id ?? ""),
          expectedRevision: Number(body.expectedRevision ?? 0),
        });
        const current = requests.get(id);
        return respond({
          ok: true,
          request: commit({ ...current, status: body.status }),
        });
      }
      case "sendEmail":
        api.emailed.push(body.request);
        return respond({ ok: true });
      default:
        return respond({ ok: true });
    }
  });
  return api;
}

/** Types into the customer field and takes the matching directory row. */
async function pickCustomer(page: Page, customer: string) {
  await page.getByLabel("Customer / job", { exact: true }).fill(customer);
  await page
    .getByRole("button", { name: new RegExp(`for ${customer}$`) })
    .first()
    .click();
}

/**
 * Customer-directory traffic (loading the customer list behind the picker and
 * the background sync of uploaded jobs) runs alongside the request workflow.
 * Tests that pin the request actions filter it out.
 */
const CRM_ACTIONS = new Set([
  "listCustomers",
  "openCustomer",
  "saveCustomer",
  "mergeCustomers",
  "listActivities",
  "addActivity",
  "listTasks",
  "saveTask",
]);

const requestActions = (api: MockApi) =>
  api.actions.filter(
    (action) => action !== "bootstrap" && !CRM_ACTIONS.has(action),
  );

test("submission returns home before saving and notifies on the current screen after confirmation", async ({
  page,
}) => {
  const api = await installMockApi(page);
  let release!: () => void;
  api.holdNextAction = {
    action: "saveRequest",
    wait: new Promise<void>((resolve) => {
      release = resolve;
    }),
  };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await pickCustomer(page, "York Ridge Apartments");
  await page
    .getByLabel("What changed?", { exact: true })
    .fill("Replace flooring");
  await page
    .getByRole("button", { name: "Send to estimating", exact: true })
    .click();
  try {
    await expect(
      page.getByRole("heading", { name: "Change orders", exact: true }),
    ).toBeVisible({ timeout: 1500 });
    expect(new URL(page.url()).hash).toBe("#/review");
    await expect(page.getByText(/Sent to estimating/)).toHaveCount(0);
    await page
      .getByRole("button", { name: "New request", exact: true })
      .click();
    await page
      .getByLabel("What changed?", { exact: true })
      .fill("Next request still in progress");
  } finally {
    release();
  }
  await expect(page.locator(".submission-notification.success")).toContainText(
    "Sent to estimating: York Ridge Apartments",
  );
  expect(new URL(page.url()).hash).toBe("#/simple");
  await expect(page.getByLabel("What changed?", { exact: true })).toHaveValue(
    "Next request still in progress",
  );
  expect(api.saved).toHaveLength(1);
  expect(errors).toEqual([]);
});

for (const action of ["uploadAttachment", "sendEmail"]) {
  test(`submission stays responsive while waiting for ${action}`, async ({
    page,
  }, testInfo) => {
    const api = await installMockApi(page);
    let release!: () => void;
    api.holdNextAction = {
      action,
      wait: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "New request", exact: true })
      .click();
    await pickCustomer(page, "Maple Court Duplex");
    await page
      .getByLabel("What changed?", { exact: true })
      .fill("Replace siding");
    if (action === "uploadAttachment") {
      await page
        .locator('input[type="file"][accept^="image/jpeg"]')
        .setInputFiles(resolve("tmp/fixtures/photo-800x600.png"));
    } else {
      await page.getByLabel("Recipient email address").fill("qa@example.com");
    }
    await page
      .locator(
        action === "sendEmail"
          ? ".email-input-group button"
          : ".sr-submit-button",
      )
      .click();
    try {
      await expect(
        page.getByRole("heading", { name: "Change orders", exact: true }),
      ).toBeVisible();
      await expect.poll(() => api.actions.includes(action)).toBe(true);
      await expect(
        page.locator(".submission-notification.neutral"),
      ).toContainText("Submitting");
      await expect(
        page.locator(".submission-notification.success"),
      ).toHaveCount(0);
    } finally {
      release();
    }
    const popup = page.locator(".submission-notification.success");
    await expect(popup).toContainText("Sent to estimating");
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const bounds = await popup.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath("submission-popup.png"),
    });
    await page
      .getByRole("button", { name: "Dismiss submission notification" })
      .focus();
    await page.keyboard.press("Enter");
    await expect(popup).toHaveCount(0);
    expect(api.saved[0].job.customer).toBe("Maple Court Duplex");
  });
}

test("a network failure shows a retry notification instead of reporting backend success", async ({
  page,
}) => {
  const api = await installMockApi(page);
  const attempts: Record<string, any>[] = [];
  await page.route(apiRoute, async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    if (body.action === "saveRequest") {
      attempts.push(body);
      if (attempts.length === 1) return route.abort("failed");
    }
    return route.fallback();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await pickCustomer(page, "Maple Court Duplex");
  await page
    .getByLabel("What changed?", { exact: true })
    .fill("Replace siding");
  await page
    .getByRole("button", { name: "Send to estimating", exact: true })
    .click();
  await expect(page.locator(".submission-notification.danger")).toContainText(
    "Submission could not be completed",
  );
  await expect(page.locator(".submission-notification.success")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry submission" }).dblclick();
  await expect(page.locator(".submission-notification.success")).toContainText(
    "Sent to estimating",
  );
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(api.saved).toHaveLength(1);
});

for (const [sign, button] of [
  ["+", "Plus — increase"],
  ["-", "Minus — deduction"],
]) {
  test(`the quick request emails its optional ${sign} dollar amount`, async ({
    page,
  }) => {
    const api = await installMockApi(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await page
      .getByRole("button", { name: "New request", exact: true })
      .click();
    await pickCustomer(page, "York Ridge Apartments");
    await page
      .getByLabel("What changed?", { exact: true })
      .fill("Flooring change");
    const amount = page.getByLabel("Known change amount", { exact: true });
    await amount.fill("1250.19");
    const direction = page.getByRole("button", { name: button });
    await direction.focus();
    await page.keyboard.press("Space");
    await expect(direction).toHaveAttribute("aria-pressed", "true");
    await expect(amount).toHaveValue("1250.19");
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    await page.setViewportSize({ width: 320, height: 1000 });
    await page.locator(".sr-amount-section").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `tmp/quick-request-amount-${sign === "+" ? "plus" : "minus"}.png`,
    });
    await page.getByLabel("Recipient email address").fill("review@example.com");
    if (sign === "+")
      await page
        .locator(".email-input-group")
        .getByRole("button", {
          name: "Send email & submit to estimating",
          exact: true,
        })
        .click();
    else await page.locator(".sr-submit-button").click();
    await expect(page.getByText(/Sent to estimating/)).toBeVisible();
    expect(api.saved[0].knownChangeAmount).toBe(`${sign}1250.19`);
    expect(api.saved[0].finalChangeOrder).toBeUndefined();
    expect(api.emailed[0].knownChangeAmount).toBe(`${sign}1250.19`);
    expect(errors).toEqual([]);
  });
}

test("a second quick request continues the job's previous change total", async ({
  page,
}) => {
  const first = {
    ...createRequest(),
    id: "prior-change",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  first.job.jobNumber = "F-26-0366-P";
  first.job.customer = "York Ridge Apartments";
  first.job.orderNumber = "CO-01";
  first.job.previousChanges = "0.00";
  first.finalChangeOrder = { scope: "First change", amount: "+100.00" };
  const api = await installMockApi(page, jobs, [first]);
  await page.goto("/");
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await pickCustomer(page, "York Ridge Apartments");
  await page
    .getByLabel("What changed?", { exact: true })
    .fill("Second change order");
  await page
    .getByRole("button", { name: "Send to estimating", exact: true })
    .click();
  await expect(page.getByText(/Sent to estimating/)).toBeVisible();
  expect(api.saved).toHaveLength(1);
  expect(api.saved[0].job.previousChanges).toBe("100.00");
  expect(api.saved[0].job.orderNumber).toBe("CO-02");
});

test("invalid known amounts block saving, and clearing the amount leaves it optional", async ({
  page,
}) => {
  const api = await installMockApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await pickCustomer(page, "York Ridge Apartments");
  await page
    .getByLabel("What changed?", { exact: true })
    .fill("Flooring change");
  const amount = page.getByLabel("Known change amount", { exact: true });
  for (const invalid of ["abc", "-12", "1.001"]) {
    await amount.fill(invalid);
    await page
      .getByRole("button", { name: "Send to estimating", exact: true })
      .click();
    await expect(amount).toHaveAttribute("aria-invalid", "true");
    expect(api.saved).toHaveLength(0);
  }
  await amount.fill("");
  await page.getByRole("button", { name: "Minus — deduction" }).click();
  await page
    .getByRole("button", { name: "Send to estimating", exact: true })
    .click();
  await expect(page.getByText(/Sent to estimating/)).toBeVisible();
  expect(api.saved[0].knownChangeAmount).toBeUndefined();
});

test("the quick request tab opens from the header and reload returns home", async ({
  page,
}) => {
  await installMockApi(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Quick request", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Quick request", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/simple");

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Change orders", exact: true }),
  ).toBeVisible();
});

test("voice input degrades to typing when the browser has no speech API", async ({
  page,
}) => {
  await installMockApi(page);
  // Chromium exposes the constructor even when no speech service is reachable,
  // so remove both spellings to model a browser that genuinely cannot listen.
  await page.addInitScript(() => {
    Object.defineProperty(window, "SpeechRecognition", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      value: undefined,
      configurable: true,
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Quick request", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".sr-mic")).toHaveCount(0);
  await expect(page.getByText(/voice input is not available/i)).toBeVisible();
});

test("a spoken note is appended to whatever the PM already typed", async ({
  page,
}) => {
  await installMockApi(page);
  // Headless Chromium has no Speech Recognition, so stand one in that delivers a
  // single final transcript the moment recording starts.
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        const scope = window as unknown as { __speechStarts?: number };
        scope.__speechStarts = (scope.__speechStarts ?? 0) + 1;
        this.onresult?.({
          resultIndex: 0,
          results: [
            Object.assign([{ transcript: "Insulation is wet" }], {
              isFinal: true,
            }),
          ],
        });
      }
      stop() {}
      abort() {}
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition =
      FakeRecognition;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New request", exact: true }).click();
  const note = page.getByLabel("What changed?", { exact: true });
  await note.fill("Kitchen wall");
  await page.getByRole("button", { name: "Speak the note" }).click();
  await expect(note).toHaveValue("Kitchen wall Insulation is wet");
  await expect(
    page.getByRole("button", { name: "Stop listening" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () => (window as unknown as { __speechStarts?: number }).__speechStarts,
    ),
  ).toBe(1);
});

test("an empty quick request is refused with a specific reason", async ({
  page,
}) => {
  const api = await installMockApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await page.getByRole("button", { name: "Send to estimating" }).click();
  await expect(
    page.getByText("Type a customer or pick a job from the list."),
  ).toBeVisible();

  await pickCustomer(page, "Maple Court Duplex");
  await page.getByRole("button", { name: "Send to estimating" }).click();
  await expect(
    page.getByText("Add a note or at least one photo before sending."),
  ).toBeVisible();
  expect(api.actions).not.toContain("saveRequest");
});

test("a project manager sends a text-only quick request", async ({ page }) => {
  const api = await installMockApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await pickCustomer(page, "York Ridge Apartments");
  await expect(page.locator(".sr-summary")).toContainText("F-26-0366-P");
  await page
    .getByLabel("What changed?", { exact: true })
    .fill("Added insulation to the open kitchen wall");
  await page.getByRole("button", { name: "Send to estimating" }).click();

  // Back on the dashboard with the confirmation the quick form handed over.
  await expect(page.getByText(/Sent to estimating/)).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/review");
  await expect(page.locator(".request-row")).toContainText(
    "York Ridge Apartments",
  );

  expect(api.saved).toHaveLength(1);
  expect(api.saved[0].status).toBe("submitted");
  expect(api.saved[0].job).toMatchObject({
    customer: "York Ridge Apartments",
    jobNumber: "F-26-0366-P",
    address: "1200 York St, Fort Wayne, IN 46802",
    projectManager: "Dana Whitfield",
    originalContract: "167045.81",
    customerPhone: "260-555-0144",
    customerEmail: "dana@example.com",
  });
  expect(api.saved[0].jobDirectoryId).toBe("job-1");
  expect(api.saved[0].requestedChanges).toHaveLength(1);
  expect(api.saved[0].requestedChanges[0].description).toBe(
    "Added insulation to the open kitchen wall",
  );
  // A text-only request saves once, already in the queue.
  expect(requestActions(api)).toEqual(["saveRequest"]);
  expect(api.transitions).toHaveLength(0);
});

test("checkbox answers are copied for Dash before submission and saved with the request", async ({
  page,
}) => {
  const copied: string[] = [];
  await page.exposeFunction("captureDashCopy", (text: string) =>
    copied.push(text),
  );
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => (window as any).captureDashCopy(text),
      },
    }),
  );
  const api = await installMockApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await pickCustomer(page, "York Ridge Apartments");
  await page
    .getByRole("checkbox", { name: "Change order", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Insurance supplement", exact: true })
    .check();
  await expect(
    page.getByRole("checkbox", { name: "Change order", exact: true }),
  ).not.toBeChecked();
  await page
    .getByRole("checkbox", { name: "Yes, customer credits", exact: true })
    .check();
  await page
    .getByLabel("What changed?", { exact: true })
    .fill("Credit for unused flooring.\nKeep this text.");
  // Estimate lines remain estimator-only; the known amount is optional.
  await expect(
    page.getByLabel("Estimate line number 1", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Known change amount", { exact: true }),
  ).toBeVisible();
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 1400 });
    await page.keyboard.press("Control+Home");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page
    .getByRole("button", { name: "Copy Dash note", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Copied" }),
  ).toBeVisible();
  expect(api.saved).toHaveLength(0);
  expect(copied).toHaveLength(1);
  for (const expected of [
    "Insurance supplement",
    "Customer credits: Yes",
    "York Ridge Apartments",
    "F-26-0366-P",
    "Credit for unused flooring.\nKeep this text.",
  ])
    expect(copied[0]).toContain(expected);
  await page
    .getByRole("button", { name: "Send to estimating", exact: true })
    .click();
  await expect(page.getByText(/Sent to estimating/)).toBeVisible();
  expect(api.saved[0].requestType).toBe("insurance_supplement");
  expect(api.saved[0].customerCredits).toBe(true);
  expect(api.saved[0].lineNumbers).toBeUndefined();
});

test("a photo is marked up before it is sent, with an optional PDF", async ({
  page,
}) => {
  const api = await installMockApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await pickCustomer(page, "York Ridge Apartments");
  await page
    .locator('input[type="file"][accept^="image/jpeg"]')
    .setInputFiles(resolve("tmp/fixtures/photo-800x600.png"));
  await expect(page.getByRole("img", { name: "Photo 1" })).toBeVisible();

  await page.getByRole("button", { name: "Edit photo 1" }).click();
  const editor = page.getByRole("dialog", { name: "Annotate photo" });
  await expect(editor).toBeVisible();
  const canvas = page.locator("canvas.photo-annotator-canvas");
  // The canvas only has a usable box once the photo has decoded.
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeGreaterThan(80);
  await page.getByRole("button", { name: "Arrow tool" }).click();
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, {
      steps: 8,
    });
    await page.mouse.up();
  }
  await page.getByRole("button", { name: "Save annotated photo" }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByText("Marked up")).toBeVisible();

  await page
    .locator('input[type="file"][accept="application/pdf,.pdf"]')
    .setInputFiles(resolve("tmp/fixtures/no-text.pdf"));
  await expect(page.locator(".sr-file-name")).toContainText("no-text.pdf");

  await page
    .getByLabel("What changed?", { exact: true })
    .fill("Kitchen wall is wet");
  await page.getByRole("button", { name: "Send to estimating" }).click();
  await expect(page.getByText(/Sent to estimating/)).toBeVisible();

  // The annotated JPEG is uploaded first, then the PDF as a plain document —
  // never as an "estimate", which would trigger extraction.
  expect(api.uploads.map((upload) => upload.kind)).toEqual([
    "photo",
    "document",
  ]);
  expect(api.uploads[0].bytes).toBeGreaterThan(1000);
  expect(api.uploads[1].name).toBe("no-text.pdf");
  // The upload endpoint stores files in Drive but never edits the request, so
  // the returned rows must be saved onto the request before it lands in the queue.
  expect(requestActions(api)).toEqual([
    "saveRequest",
    "uploadAttachment",
    "uploadAttachment",
    "saveRequest",
  ]);
  expect(api.saved).toHaveLength(2);
  expect(api.saved[0].attachments).toHaveLength(0);
  expect(api.saved[1].attachments.map((row: any) => row.kind)).toEqual([
    "photo",
    "document",
  ]);
  expect(api.transitions).toHaveLength(0);
});

test("the annotator keeps a labelled Save control on a phone", async ({
  page,
}) => {
  // On a phone the header folds the buttons to their icons (max-width: 430px).
  // The Save control must survive that fold with its dot and its label: hiding
  // both left a bare red rectangle, so a PM marking up a photo had no visible
  // way to keep the marks.
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await pickCustomer(page, "York Ridge Apartments");
  await page
    .locator('input[type="file"][accept^="image/jpeg"]')
    .setInputFiles(resolve("tmp/fixtures/photo-800x600.png"));
  await expect(page.getByRole("img", { name: "Photo 1" })).toBeVisible();
  await page.getByRole("button", { name: "Edit photo 1" }).click();

  const editor = page.getByRole("dialog", { name: "Annotate photo" });
  await expect(editor).toBeVisible();
  const save = page.getByRole("button", { name: "Save annotated photo" });
  await expect(save.locator(".photo-annotator-save-dot")).toBeVisible();
  const saveLabel = save.locator("span").last();
  await expect(saveLabel).toHaveText("Save");
  await expect(saveLabel).toBeVisible();

  // Mark up the photo, then save it the way the flow is actually used.
  const canvas = page.locator("canvas.photo-annotator-canvas");
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeGreaterThan(80);
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55, {
      steps: 8,
    });
    await page.mouse.up();
  }
  // The control stays visible and usable once there are marks to keep.
  await expect(saveLabel).toBeVisible();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByText("Marked up")).toBeVisible();
});

test("a photo the endpoint cannot accept (HEIC pick) is converted before upload", async ({
  page,
}) => {
  const api = await installMockApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await pickCustomer(page, "York Ridge Apartments");
  // A library pick that still arrives as HEIC: the form is handed image/heic,
  // which the Apps Script endpoint rejects outright ("Choose a supported file
  // smaller than 15 MB"). It must be converted to a JPEG before uploading.
  await page.locator('input[type="file"][accept^="image/jpeg"]').setInputFiles({
    name: "IMG_1234.HEIC",
    mimeType: "image/heic",
    buffer: readFileSync(resolve("tmp/fixtures/photo-800x600.png")),
  });
  await expect(page.getByRole("img", { name: "Photo 1" })).toBeVisible();
  await page
    .getByLabel("What changed?", { exact: true })
    .fill("Water stain behind the cabinet");
  await page.getByRole("button", { name: "Send to estimating" }).click();
  await expect(page.getByText(/Sent to estimating/)).toBeVisible();

  // Uploaded as a JPEG under a .jpg name, with real encoded bytes — not the
  // rejected HEIC type.
  expect(api.uploads).toHaveLength(1);
  expect(api.uploads[0].kind).toBe("photo");
  expect(api.uploads[0].mimeType).toBe("image/jpeg");
  expect(api.uploads[0].name).toBe("IMG_1234.jpg");
  expect(api.uploads[0].bytes).toBeGreaterThan(1000);
  expect(api.saved[1].attachments[0].mimeType).toBe("image/jpeg");
  expect(api.transitions).toHaveLength(0);
});

test("the customer field falls back to a typed name when the directory is empty", async ({
  page,
}) => {
  await installMockApi(page, []);
  await page.goto("/");
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await expect(page.locator(".sr-matches")).toHaveCount(0);
  await page.getByLabel("Customer / project owner").fill("Walk-in customer");
  await page
    .getByLabel("What changed?", { exact: true })
    .fill("Replace the damaged siding");
  await page.getByRole("button", { name: "Send to estimating" }).click();
  await expect(page.locator(".notice.success")).toContainText(
    "Sent to estimating: Walk-in customer.",
  );
});

test("a failed upload is retried on the same request, never a duplicate", async ({
  page,
}) => {
  const api = await installMockApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await pickCustomer(page, "Maple Court Duplex");
  await page
    .getByLabel("What changed?", { exact: true })
    .fill("Replace the damaged siding");
  await page
    .locator('input[type="file"][accept^="image/jpeg"]')
    .setInputFiles(resolve("tmp/fixtures/photo-800x600.png"));
  await expect(page.getByRole("img", { name: "Photo 1" })).toBeVisible();

  api.failNextUpload = true;
  await page.getByRole("button", { name: "Send to estimating" }).click();
  await expect(page.getByText(/Upload failed. Try again./)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Change orders", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry submission" }).click();
  await expect(page.getByText(/Sent to estimating/)).toBeVisible();

  // The retry resumes uploads without repeating the confirmed initial save.
  expect(api.saved).toHaveLength(2);
  expect(new Set(api.saved.map((request) => request.id)).size).toBe(1);
  expect(api.saved[1].attachments).toHaveLength(1);
  expect(api.transitions).toHaveLength(0);
  // The failed attempt's upload identity is reused, so the endpoint returns the
  // file it already holds instead of storing a second copy of the photo.
  expect(api.uploads.map((upload) => upload.failed)).toEqual([true, false]);
  expect(api.uploads[0].attachmentId).toBe(api.uploads[1].attachmentId);
  expect(api.uploads[0].mutationId).toBe(api.uploads[1].mutationId);
});

test("typing finds the customer instead of scrolling a long list", async ({
  page,
}) => {
  const api = await installMockApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "New request", exact: true }).click();
  const field = page.getByLabel("Customer / job", { exact: true });

  // Part of a name or a job number both find the row — and only that row.
  await field.fill("F-26-0366");
  await expect(
    page.getByRole("button", {
      name: "Use job F-26-0366-P for York Ridge Apartments",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Use job F-26-0401-P for Maple Court Duplex",
    }),
  ).toHaveCount(0);

  await field.fill("maple");
  await page
    .getByRole("button", {
      name: "Use job F-26-0401-P for Maple Court Duplex",
    })
    .click();
  await expect(field).toHaveValue("Maple Court Duplex — F-26-0401-P");
  await expect(page.locator(".sr-summary")).toContainText("Ray Alvarez");
  await expect(page.locator(".sr-matches")).toHaveCount(0);

  // Typing over the pick releases it, and a name outside the directory is still
  // sendable with whatever the PM typed.
  await field.fill("Walk-in customer");
  await expect(page.locator(".sr-summary")).toHaveCount(0);
  await expect(page.locator(".sr-match-empty")).toContainText(
    "No customer or job matches",
  );
  await page
    .getByLabel("What changed?", { exact: true })
    .fill("Siding damage on the north wall");
  await page.getByRole("button", { name: "Send to estimating" }).click();
  await expect(page.locator(".notice.success")).toContainText(
    "Sent to estimating: Walk-in customer.",
  );
  expect(api.saved[0].job.customer).toBe("Walk-in customer");
  expect(api.saved[0].job.jobNumber).toBe("");
});

test("typing autocompletes an uploaded customer and links the change order to it", async ({
  page,
}) => {
  // This customer came from a job upload but has no active job in the current
  // directory, so only the loaded customer list can offer it.
  const api = await installMockApi(page, jobs, [], [
    {
      id: "cust-lakeside",
      name: "Lakeside Medical Group",
      phone: "260-555-0900",
      email: "facilities@lakeside.example.com",
      address: "40 Lakeside Dr, Fort Wayne, IN 46804",
      jobCount: 2,
      openTaskCount: 0,
      updatedAt: "2026-10-10T12:00:00.000Z",
    },
  ]);
  await page.goto("/");
  await page.getByRole("button", { name: "New request", exact: true }).click();
  const field = page.getByLabel("Customer / job", { exact: true });

  await field.fill("lakeside");
  const option = page.getByRole("button", {
    name: "Use customer Lakeside Medical Group",
  });
  await expect(option).toBeVisible();
  await option.click();

  // The loaded details fill the request instead of being retyped.
  await expect(field).toHaveValue("Lakeside Medical Group");
  await expect(page.locator(".sr-summary")).toContainText("260-555-0900");
  await expect(page.locator(".sr-summary")).toContainText(
    "facilities@lakeside.example.com",
  );

  await page
    .getByLabel("What changed?", { exact: true })
    .fill("Replace wet ceiling tiles");
  await page.getByRole("button", { name: "Send to estimating" }).click();
  await expect(page.locator(".notice.success")).toContainText(
    "Sent to estimating: Lakeside Medical Group.",
  );
  expect(api.saved[0].customerId).toBe("cust-lakeside");
  expect(api.saved[0].job.customer).toBe("Lakeside Medical Group");
  expect(api.saved[0].job.customerPhone).toBe("260-555-0900");
  expect(api.saved[0].job.customerEmail).toBe(
    "facilities@lakeside.example.com",
  );
  expect(api.saved[0].jobDirectoryId).toBeUndefined();
});
