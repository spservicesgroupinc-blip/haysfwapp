import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist";
import { resolve } from "node:path";

/**
 * The review page is where an estimator receives a quick request: they read
 * the intake, download the photos and files, start work, and mark the order
 * prepare a customer document, and mark the request complete. These tests pin that flow.
 */
const apiRoute =
  /\/__api__(?:\?|$)|https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?|$)/;

const baseRequest = {
  id: "r1",
  revision: 1,
  createdAt: "",
  updatedAt: "2026-10-01T12:00:00.000Z",
  status: "submitted",
  estimatorName: "",
  submittedAt: "2026-10-01T12:00:00.000Z",
  informationQuestion: "",
  job: {
    customer: "York Ridge Apartments",
    customerPhone: "260-555-0144",
    customerEmail: "dana@example.com",
    address: "1200 York St, Fort Wayne, IN 46802",
    jobNumber: "F-26-0366-P",
    projectManager: "Dana Whitfield",
    branchName: "Hays + Sons Complete Restoration",
    branchAddress: "909 Production Road, Fort Wayne, IN 46808",
    branchPhone: "1-260-471-9110",
    branchContact: "",
    carrier: "",
    claim: "",
    orderNumber: "CO-01",
    date: "2026-10-01",
    insuranceRelated: true,
    originalContract: "167045.81",
    previousChanges: "0.00",
    addedDays: "0",
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
  attachments: [
    {
      id: "a1",
      kind: "photo",
      name: "photo1.jpg",
      mimeType: "image/jpeg",
      size: 128,
      driveFileId: "drive-a1",
    },
    {
      id: "a2",
      kind: "document",
      name: "note.pdf",
      mimeType: "application/pdf",
      size: 64,
      driveFileId: "drive-a2",
    },
  ],
};

function summarize(r: any) {
  return {
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
  };
}

async function installMockApi(
  page: Page,
  overrides: Record<string, any> = {},
  failures: {
    save?: string;
    upload?: boolean;
    afterSave?: boolean;
    download?: boolean;
  } = {},
) {
  const requests = new Map<string, any>();
  const seed = { ...structuredClone(baseRequest), ...overrides };
  requests.set(seed.id, seed);
  const actions: string[] = [];
  const uploads: Record<string, any>[] = [];
  const uploaded = new Map<string, any>();
  const fileBytes = new Map<string, string>();
  const mutations = new Map<string, any>();
  const commit = (next: any) => {
    const previous = requests.get(next.id);
    const updated = {
      ...next,
      revision: (previous?.revision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    requests.set(updated.id, updated);
    return updated;
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
    actions.push(action);
    const respond = (obj: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(obj),
      });
    const id = url.searchParams.get("id") ?? body.id;
    const current = requests.get(id);
    switch (action) {
      case "bootstrap":
      case "listRequests":
        return respond({
          ok: true,
          requests: [...requests.values()].map(summarize),
          jobs: [],
        });
      case "listJobs":
        return respond({ ok: true, jobs: [] });
      case "openRequest":
        return respond({ ok: true, request: current });
      case "saveRequest": {
        if (mutations.has(body.mutationId))
          return respond({ ok: true, request: mutations.get(body.mutationId) });
        if (failures.save) {
          const code = failures.save;
          delete failures.save;
          return respond({
            ok: false,
            code,
            error:
              code === "CONFLICT"
                ? "A newer revision exists."
                : "Save failed. Retry.",
          });
        }
        const saved = commit(body.request);
        mutations.set(body.mutationId, saved);
        if (failures.afterSave) {
          delete failures.afterSave;
          return respond({
            ok: false,
            error: "Save response lost. Retry.",
            code: "SERVICE_ERROR",
          });
        }
        return respond({ ok: true, request: saved });
      }
      case "uploadAttachment": {
        uploads.push(body);
        if (failures.upload) {
          delete failures.upload;
          return respond({
            ok: false,
            code: "UPLOAD_FAILED",
            error: "Upload failed. Retry.",
          });
        }
        if (!uploaded.has(body.attachmentId))
          uploaded.set(body.attachmentId, {
            id: body.attachmentId,
            driveFileId: `drive-${body.attachmentId}`,
            name: body.file.name,
            mimeType: body.file.mimeType,
            size: body.file.size,
            kind: body.file.kind,
          });
        fileBytes.set(body.attachmentId, body.file.data);
        return respond({
          ok: true,
          attachment: uploaded.get(body.attachmentId),
        });
      }
      case "claimRequest":
        return respond({
          ok: true,
          request: commit({
            ...current,
            estimatorName: String(body.estimatorName ?? ""),
            status: "in_review",
          }),
        });
      case "transitionRequest": {
        const target = String(body.status ?? "");
        const status =
          target === "submitted" && current?.estimatorName
            ? "in_review"
            : target;
        return respond({
          ok: true,
          request: commit({
            ...current,
            status,
            informationQuestion:
              target === "needs_information" ? String(body.question ?? "") : "",
          }),
        });
      }
      case "fetchAttachment": {
        if (failures.download) {
          delete failures.download;
          return respond({
            ok: false,
            code: "SERVICE_ERROR",
            error: "File download failed.",
          });
        }
        const current = requests.get(url.searchParams.get("requestId") ?? "");
        const attachment = current?.attachments?.find(
          (item: any) => item.id === url.searchParams.get("attachmentId"),
        );
        const data =
          attachment?.mimeType === "application/pdf" ? "%PDF-1.4\n" : "fakejpg";
        return respond({
          ok: true,
          name: attachment?.name ?? "file",
          mimeType: attachment?.mimeType ?? "application/octet-stream",
          data:
            fileBytes.get(attachment?.id) ??
            Buffer.from(data).toString("base64"),
        });
      }
      default:
        return respond({ ok: true });
    }
  });
  return { requests, actions, uploads, uploaded };
}

test("customer form edits PDF fields, saves the exact PDF and preserves source attachments", async ({
  page,
}) => {
  const api = await installMockApi(page, {
    status: "in_review",
    estimatorName: "Jamie Estimator",
  });
  await page.goto("/#/requests/r1");
  await page
    .getByRole("button", { name: "Prepare change order", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Customer change order" });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Customer name", { exact: true })).toHaveValue(
    "York Ridge Apartments",
  );
  await expect(
    editor.getByLabel("Original contract amount", { exact: true }),
  ).toHaveValue("167045.81");
  await expect(
    editor.getByLabel("Final customer scope", { exact: true }),
  ).toHaveValue("Wet insulation behind the kitchen wall");
  await expect(
    editor.getByLabel("Final change amount", { exact: true }),
  ).toHaveValue("");
  await editor
    .getByLabel("Final change amount", { exact: true })
    .fill("250.10");
  await editor.getByRole("button", { name: "Credit", exact: true }).click();
  await expect(
    editor.getByText("New contract total: $166,795.71", { exact: true }),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "Generate & save PDF", exact: true })
    .click();
  await expect(
    editor.getByRole("status").filter({ hasText: "saved" }),
  ).toBeVisible();
  const saved = api.requests.get("r1");
  expect(saved.customerDocument.attachmentId).toBeTruthy();
  expect(saved.attachments).toHaveLength(3);
  const downloadEvent = page.waitForEvent("download");
  await editor
    .getByRole("button", { name: "Download saved PDF", exact: true })
    .click();
  const download = await downloadEvent;
  const bytes = await readFile((await download.path())!);
  expect(bytes.toString("base64")).toBe(api.uploads[0].file.data);
  expect(download.suggestedFilename()).toBe(
    "change-order-F-26-0366-P-CO-01.pdf",
  );
});

test("an estimator reviews, starts work, and marks the request complete", async ({
  page,
}) => {
  await installMockApi(page);
  await page.goto("/#/requests/r1");

  await expect(
    page.getByRole("heading", { name: "In queue", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Wet insulation behind the kitchen wall"),
  ).toBeVisible();

  await page.getByLabel("Estimator name").fill("Jamie Estimator");
  await page.getByRole("button", { name: "Start work" }).click();

  await expect(
    page.getByRole("heading", { name: "Estimator review", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mark complete" }).click();

  await expect(
    page.getByText(
      "This change order is finished and kept in the log for reference.",
    ),
  ).toBeVisible();
});

test("an estimator can send a request back for information and the PM responds", async ({
  page,
}) => {
  await installMockApi(page, {
    status: "in_review",
    estimatorName: "Jamie Estimator",
  });
  await page.goto("/#/requests/r1");

  await page.getByRole("button", { name: "Request more information" }).click();
  await page
    .getByLabel("Information request")
    .fill("What is the exact square footage?");
  await page.getByRole("button", { name: "Send request" }).click();

  await expect(
    page.getByRole("heading", { name: "More information needed", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("What is the exact square footage?"),
  ).toBeVisible();

  await page
    .getByLabel("Response")
    .fill("The affected area is 120 square feet.");
  await page.getByRole("button", { name: "Send response" }).click();

  // The response lands back with the estimator who asked for it.
  await expect(
    page.getByRole("heading", { name: "Estimator review", exact: true }),
  ).toBeVisible();
});

test("estimator edits the PDF, saves a credit, and downloads the stored document after completion", async ({
  page,
}) => {
  const api = await installMockApi(page, {
    status: "in_review",
    estimatorName: "Jamie Estimator",
    lineNumbers: "+12, -34",
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/requests/r1");
  await page
    .getByRole("button", { name: "Prepare change order", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Customer change order" });
  await expect(
    page.getByRole("button", { name: "Mark complete", exact: true }),
  ).toBeDisabled();
  await expect(
    editor.getByLabel("Contractor representative", { exact: true }),
  ).toHaveValue("Jamie Estimator");
  await editor.getByLabel("Change-order number", { exact: true }).fill("CO-02");
  await editor
    .getByLabel("Change-order date", { exact: true })
    .fill("2026-10-11");
  await editor.getByLabel("Added days", { exact: true }).fill("2");
  await editor
    .getByLabel("Final customer scope", { exact: true })
    .fill("Agreed replacement of kitchen insulation.\nCredit for unused trim.");
  await editor
    .getByLabel("Final change amount", { exact: true })
    .fill("250.10");
  await editor.getByRole("button", { name: "Credit", exact: true }).click();
  await editor
    .getByLabel("Previous authorized changes", { exact: true })
    .fill("25.09");
  await expect(
    editor.getByRole("button", {
      name: "Edit Customer name on PDF",
      exact: true,
    }),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "Edit Customer name on PDF", exact: true })
    .click();
  const inline = editor.getByRole("group", { name: "Inline PDF field editor" });
  await inline
    .getByLabel("Customer name", { exact: true })
    .fill("Corrected customer");
  await inline.getByRole("button", { name: "Done editing field" }).click();
  await expect(editor.getByLabel("Customer name", { exact: true })).toHaveValue(
    "Corrected customer",
  );
  await expect(
    editor.getByText("New contract total: $166,820.80", { exact: true }),
  ).toBeVisible();
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(
      editor.getByText("Updating preview…", { exact: true }),
    ).toHaveCount(0);
    await expect(editor.locator(".document-canvas")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `tmp/customer-document/editor-${width}.png`,
    });
  }
  await editor
    .getByRole("button", { name: "Generate & save PDF", exact: true })
    .click();
  await expect(
    editor.getByText("Change order and customer PDF saved.", { exact: true }),
  ).toBeVisible();
  const saved = api.requests.get("r1");
  expect(saved.finalChangeOrder.amount).toBe("-250.10");
  expect(saved.lineNumbers).toBe("+12, -34");
  await editor.getByRole("button", { name: "Close change order" }).click();
  await page
    .getByRole("button", { name: "View saved PDF", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", {
      name: "change-order-F-26-0366-P-CO-02.pdf",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close preview", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Prepare change order", exact: true })
    .click();
  await expect(editor.getByLabel("Customer name", { exact: true })).toHaveValue(
    "Corrected customer",
  );
  await expect(
    editor.getByLabel("Final change amount", { exact: true }),
  ).toHaveValue("250.10");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Mark complete", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Prepare change order", exact: true }),
  ).toHaveCount(0);
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download saved PDF", exact: true })
    .click();
  const download = await pending;
  const bytes = new Uint8Array(await readFile((await download.path())!));
  const pdf = await getDocument({ data: bytes, disableFontFace: true }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++)
    text += (await (await pdf.getPage(i)).getTextContent()).items
      .map((item: any) => item.str)
      .join(" ");
  for (const expected of [
    "CO-02",
    "2026-10-11",
    "Corrected customer",
    "Agreed replacement of kitchen insulation.",
    "Credit for unused trim.",
    "-$250.10",
    "$166,820.80",
    "Signature",
  ])
    expect(text).toContain(expected);
  expect(text).not.toContain("DRAFT");
  expect(text).not.toContain("photo1.jpg");
  await pdf.destroy();
  expect(errors).toEqual([]);
});

test("submitted amount fills the estimator price and new contract total", async ({
  page,
}) => {
  const api = await installMockApi(page, {
    status: "in_review",
    estimatorName: "Jamie Estimator",
    lineNumbers: "+12, -34",
    knownChangeAmount: "+999.00",
  });
  await page.goto("/#/requests/r1");
  await page
    .getByRole("button", { name: "Prepare change order", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Customer change order" });
  await expect(
    editor.getByLabel("Final customer scope", { exact: true }),
  ).toHaveValue(baseRequest.requestedChanges[0].description);
  await expect(
    editor.getByLabel("Final change amount", { exact: true }),
  ).toHaveValue("999.00");
  await expect(
    editor.getByRole("button", { name: "Increase", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    editor.getByText("New contract total: $168,044.81", { exact: true }),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "Generate & save PDF", exact: true })
    .click();
  await expect(
    editor.getByText("Change order and customer PDF saved.", { exact: true }),
  ).toBeVisible();
  expect(api.requests.get("r1").lineNumbers).toBe("+12, -34");
  expect(api.requests.get("r1").finalChangeOrder.amount).toBe("+999.00");
});

for (const failure of ["save", "upload", "afterSave"] as const) {
  test(`customer PDF generation retries ${failure} failures without duplicate uploads`, async ({
    page,
  }) => {
    const failures: { save?: string; upload?: boolean; afterSave?: boolean } =
      {};
    if (failure === "save") failures.save = "SERVICE_ERROR";
    else failures[failure] = true;
    const api = await installMockApi(
      page,
      { status: "in_review", estimatorName: "Estimator" },
      failures,
    );
    await page.goto("/#/requests/r1");
    await page
      .getByRole("button", { name: "Prepare change order", exact: true })
      .click();
    const editor = page.getByRole("dialog", { name: "Customer change order" });
    await editor
      .getByLabel("Final change amount", { exact: true })
      .fill("0.00");
    await editor
      .getByRole("button", { name: "Generate & save PDF", exact: true })
      .dblclick();
    await expect(editor.getByRole("alert")).toBeVisible();
    await editor.getByRole("button", { name: "Retry save" }).click();
    await expect(
      editor.getByText("Change order and customer PDF saved.", { exact: true }),
    ).toBeVisible();
    expect(api.uploaded.size).toBe(1);
    expect(api.requests.get("r1").revision).toBe(2);
    expect(new Set(api.uploads.map((body) => body.attachmentId)).size).toBe(1);
  });
}

test("PDF edits are retained after conflicts and warn before discarding", async ({
  page,
}) => {
  const api = await installMockApi(
    page,
    { status: "in_review", estimatorName: "Estimator" },
    { save: "CONFLICT" },
  );
  await page.goto("/#/requests/r1");
  await page
    .getByRole("button", { name: "Prepare change order", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Customer change order" });
  await editor
    .getByLabel("Final change amount", { exact: true })
    .fill("125.00");
  await editor
    .getByRole("button", { name: "Generate & save PDF", exact: true })
    .click();
  await expect(editor.getByRole("alert")).toContainText("newer revision");
  await expect(
    editor.getByLabel("Final change amount", { exact: true }),
  ).toHaveValue("125.00");
  await expect(editor.getByRole("button", { name: "Retry save" })).toHaveCount(
    0,
  );
  page.once("dialog", (dialog) => dialog.dismiss());
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await editor.getByRole("button", { name: "Reload latest request" }).click();
  await expect(
    editor.getByLabel("Final change amount", { exact: true }),
  ).toHaveValue("");
  expect(api.requests.get("r1").revision).toBe(1);
});

test("editing printed details removes the stale PDF, and generating again links only the new version", async ({
  page,
}) => {
  const api = await installMockApi(page, {
    status: "in_review",
    estimatorName: "Estimator",
  });
  await page.goto("/#/requests/r1");
  await page
    .getByRole("button", { name: "Prepare change order", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Customer change order" });
  await editor.getByLabel("Final change amount", { exact: true }).fill("0.00");
  await editor
    .getByRole("button", { name: "Generate & save PDF", exact: true })
    .click();
  await expect(
    editor.getByText("Change order and customer PDF saved.", { exact: true }),
  ).toBeVisible();
  const first = api.requests.get("r1").customerDocument.attachmentId;
  await editor
    .getByRole("button", { name: "Generate & save PDF", exact: true })
    .click();
  await expect.poll(() => api.requests.get("r1").revision).toBe(3);
  expect(api.uploads).toHaveLength(1);
  await editor
    .getByLabel("Original contract amount", { exact: true })
    .fill("170000.01");
  await expect(
    editor.getByRole("button", { name: "Download saved PDF", exact: true }),
  ).toBeDisabled();
  await editor
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(editor.getByText(/changes saved/)).toBeVisible();
  expect(api.requests.get("r1").customerDocument).toBeUndefined();
  expect(api.requests.get("r1").attachments).toHaveLength(2);
  await editor
    .getByRole("button", { name: "Generate & save PDF", exact: true })
    .click();
  await expect(
    editor.getByText("Change order and customer PDF saved.", { exact: true }),
  ).toBeVisible();
  const saved = api.requests.get("r1");
  expect(saved.customerDocument.attachmentId).not.toBe(first);
  expect(saved.attachments).toHaveLength(3);
  expect(api.uploaded.has(first)).toBe(true);
  await editor.getByRole("button", { name: "Close change order" }).click();
  await page.getByRole("button", { name: "Edit request", exact: true }).click();
  await page
    .getByLabel("Property address", { exact: true })
    .fill("Corrected property address");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit request", exact: true }),
  ).toBeVisible();
  expect(api.requests.get("r1").customerDocument).toBeUndefined();
});

test("font loading during rapid edits renders the latest draft and preserves keyboard focus", async ({
  page,
}) => {
  await installMockApi(page, {
    status: "in_review",
    estimatorName: "Estimator",
  });
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let blocked = false;
  await page.route(
    /NotoSans-Regular(?:-[^/?]+)?\.ttf(?:\?|$)/,
    async (route) => {
      if (route.request().resourceType() === "fetch") {
        blocked = true;
        await hold;
      }
      await route.continue();
    },
  );
  await page.goto("/#/requests/r1");
  await page
    .getByRole("button", { name: "Prepare change order", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Customer change order" });
  try {
    await expect.poll(() => blocked).toBe(true);
    await editor
      .getByLabel("Customer name", { exact: true })
      .fill("Intermediate name");
    await editor
      .getByLabel("Customer name", { exact: true })
      .fill("Latest draft customer");
  } finally {
    release();
  }
  await expect(
    editor.getByText("Updating preview…", { exact: true }),
  ).toHaveCount(0);
  await expect(editor.locator(".document-canvas")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await editor
    .getByRole("button", { name: "Edit Customer name on PDF", exact: true })
    .click();
  const inline = editor.getByRole("group", { name: "Inline PDF field editor" });
  const name = inline.getByLabel("Customer name", { exact: true });
  await expect(name).toHaveValue("Latest draft customer");
  await name.press("End");
  await name.pressSequentially(" final", { delay: 80 });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("Latest draft customer final");
  await inline.getByRole("button", { name: "Done editing field" }).click();
  await expect(
    editor.getByText("Updating preview…", { exact: true }),
  ).toHaveCount(0);
  await expect(editor.locator(".document-canvas")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.screenshot({ path: "tmp/customer-document/latest-preview.png" });
  await editor.getByRole("button", { name: "Cancel", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(
    editor.getByRole("button", { name: "Fields", exact: true }),
  ).toBeFocused();
  page.once("dialog", (dialog) => dialog.accept());
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Prepare change order", exact: true }),
  ).toBeFocused();
});

test("the review page previews a photo and downloads an attachment", async ({
  page,
}) => {
  await installMockApi(page);
  await page.goto("/#/requests/r1");

  // Preview the photo in the shared modal.
  await page
    .getByRole("button", { name: "Preview photo1.jpg", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "photo1.jpg" })).toBeVisible();
  await page.getByRole("button", { name: "Close preview" }).click();

  // Download the PDF; the browser receives the file under its stored name.
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download note.pdf", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("note.pdf");
});

test("edit details and separate notes, then download the saved summary PDF", async ({
  page,
}) => {
  const api = await installMockApi(page, {
    requestedChanges: [
      ...structuredClone(baseRequest.requestedChanges),
      {
        ...structuredClone(baseRequest.requestedChanges[0]),
        id: "c2",
        room: "Bathroom",
        description: "Second change",
        measurements: "12 square feet",
        reason: "Hidden damage",
      },
    ],
  });
  await page.goto("/#/requests/r1");
  await page.getByRole("button", { name: "Edit request", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Download summary PDF" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Start work", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Customer name", { exact: true }).fill("José Customer");
  await page
    .getByLabel("Previous authorized changes", { exact: true })
    .fill("1250.19");
  await page
    .getByLabel("Description 1", { exact: true })
    .fill("Corrected kitchen note\nKeep this paragraph.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit request", exact: true }),
  ).toBeVisible();
  expect(api.requests.get("r1").requestedChanges[1].measurements).toBe(
    "12 square feet",
  );
  expect(api.requests.get("r1").status).toBe("submitted");
  await expect(page.getByText("$168,296.00", { exact: true })).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download summary PDF" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("request-summary-F-26-0366-P.pdf");
  const bytes = await readFile((await download.path())!);
  const pdf = await getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
  }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++)
    text += (await (await pdf.getPage(i)).getTextContent()).items
      .map((item: any) => item.str)
      .join(" ");
  for (const expected of [
    "José Customer",
    "260-555-0144",
    "dana@example.com",
    "$168,296.00",
    "Corrected kitchen note",
    "Keep this paragraph",
    "Second change",
    "12 square feet",
    "photo1.jpg",
    "note.pdf",
  ])
    expect(text).toContain(expected);
  await pdf.destroy();
});

test("failed edits retain text, retry, and completed requests stay read only", async ({
  page,
}) => {
  await installMockApi(
    page,
    { status: "in_review", estimatorName: "Jamie Estimator" },
    { save: "SERVICE_ERROR" },
  );
  await page.goto("/#/requests/r1");
  await page.getByRole("button", { name: "Edit request", exact: true }).click();
  await page.getByLabel("Description 1", { exact: true }).fill("Keep my edit");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Save failed");
  await expect(page.getByLabel("Description 1", { exact: true })).toHaveValue(
    "Keep my edit",
  );
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(page.getByText("Keep my edit", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Mark complete", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit request", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Download summary PDF" }),
  ).toBeEnabled();
});

test("unsaved edits warn on Cancel, app navigation, and browser back", async ({
  page,
}) => {
  await installMockApi(page);
  await page.goto("/#/requests/r1");
  await page.getByRole("button", { name: "Edit request", exact: true }).click();
  await page
    .getByLabel("Description 1", { exact: true })
    .fill("Unsaved correction");
  page.on("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("Description 1", { exact: true })).toHaveValue(
    "Unsaved correction",
  );
  await page
    .getByRole("button", { name: "Back to requests", exact: true })
    .click();
  await expect(page.getByLabel("Description 1", { exact: true })).toHaveValue(
    "Unsaved correction",
  );
  await page.goBack();
  await expect(page.getByLabel("Description 1", { exact: true })).toHaveValue(
    "Unsaved correction",
  );
  await expect(page).toHaveURL(/#\/requests\/r1$/);
  page.removeAllListeners("dialog");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByText("Wet insulation behind the kitchen wall", { exact: true }),
  ).toBeVisible();
});

test("conflicting edits retain the draft and offer reload without a blind retry", async ({
  page,
}) => {
  await installMockApi(page, {}, { save: "CONFLICT" });
  await page.goto("/#/requests/r1");
  await page.getByRole("button", { name: "Edit request", exact: true }).click();
  await page
    .getByLabel("Description 1", { exact: true })
    .fill("Conflicting edit");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByLabel("Description 1", { exact: true })).toHaveValue(
    "Conflicting edit",
  );
  await expect(
    page.getByRole("button", { name: "Reload latest request" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeDisabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Reload latest request" }).click();
  await expect(page.getByLabel("Description 1", { exact: true })).toHaveValue(
    "Conflicting edit",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reload latest request" }).click();
  await expect(
    page.getByText("Wet insulation behind the kitchen wall", { exact: true }),
  ).toBeVisible();
});

test("attachment edits retry on stable identities and preserve the information request", async ({
  page,
}) => {
  const api = await installMockApi(
    page,
    {
      status: "needs_information",
      estimatorName: "Jamie Estimator",
      informationQuestion: "Send a photo.",
    },
    { upload: true },
  );
  await page.goto("/#/requests/r1");
  await page.getByRole("button", { name: "Edit request", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove note.pdf", exact: true })
    .click();
  await page
    .getByLabel("Add photos or PDFs", { exact: true })
    .setInputFiles([
      resolve("tmp/fixtures/photo-800x600.png"),
      resolve("tmp/fixtures/no-text.pdf"),
    ]);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Upload failed");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit request", exact: true }),
  ).toBeVisible();
  const saved = api.requests.get("r1");
  expect(saved.status).toBe("needs_information");
  expect(saved.estimatorName).toBe("Jamie Estimator");
  expect(saved.informationQuestion).toBe("Send a photo.");
  expect(saved.attachments.map((item: any) => item.name)).toEqual([
    "photo1.jpg",
    "photo-800x600.png",
    "no-text.pdf",
  ]);
  expect(api.uploads[0].attachmentId).toBe(api.uploads[1].attachmentId);
  expect(api.uploads[0].mutationId).toBe(api.uploads[1].mutationId);
  expect(api.uploaded.size).toBe(2);
});

test("a lost save response retries the committed revision instead of duplicating it", async ({
  page,
}) => {
  const api = await installMockApi(page, {}, { afterSave: true });
  await page.goto("/#/requests/r1");
  await page.getByRole("button", { name: "Edit request", exact: true }).click();
  await page.getByLabel("Description 1", { exact: true }).fill("Commit once");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Save response lost");
  expect(api.requests.get("r1").revision).toBe(2);
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(page.getByText("Commit once", { exact: true })).toBeVisible();
  expect(api.requests.get("r1").revision).toBe(2);
});

test("legacy requests show unavailable information and validate money before saving", async ({
  page,
}) => {
  const api = await installMockApi(page, {
    job: {
      ...baseRequest.job,
      customerPhone: undefined,
      customerEmail: undefined,
      originalContract: "",
      previousChanges: "",
    },
    attachments: [],
  });
  await page.goto("/#/requests/r1");
  await expect(page.locator(".receipt-total")).toContainText("Not provided");
  await page.getByRole("button", { name: "Edit request", exact: true }).click();
  await page
    .getByLabel("Original contract amount", { exact: true })
    .fill("NaN");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "at most two decimal places",
  );
  expect(api.requests.get("r1").revision).toBe(1);
  await page.getByLabel("Original contract amount", { exact: true }).fill("0");
  await page.getByLabel("Customer phone", { exact: true }).fill("555-0100");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".receipt-total")).toContainText("$0.00");
  expect(api.requests.get("r1").job.customerPhone).toBe("555-0100");
});

test("individual attachment downloads can be retried after a failure", async ({
  page,
}) => {
  await installMockApi(page, {}, { download: true });
  await page.goto("/#/requests/r1");
  await page
    .getByRole("button", { name: "Download note.pdf", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("File download failed");
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download note.pdf", exact: true })
    .click();
  expect((await pending).suggestedFilename()).toBe("note.pdf");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test.describe("production layout with service worker registration", () => {
  // This read-only layout test permits registration so Playwright's deliberate
  // blocking warnings do not count as application console errors. Mutation and
  // recovery tests keep workers blocked to ensure their API interception works.
  test.use({ serviceWorkers: "allow" });

  test("review and editor fit narrow and wide screens without browser errors", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning")
        errors.push(message.text());
    });
    await installMockApi(page);
    await page.goto("/#/requests/r1");
    await expect(
      page.getByRole("button", { name: "Download summary PDF" }),
    ).toBeVisible();
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    await page.screenshot({
      path: "tmp/request-summary/review-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 900 });
    await page.screenshot({
      path: "tmp/request-summary/review-mobile.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Edit request", exact: true })
      .click();
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    await page.screenshot({
      path: "tmp/request-summary/editor-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 900 });
    await page.screenshot({
      path: "tmp/request-summary/editor-mobile.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
});

test("estimators copy saved answers and text, including after corrections", async ({
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
  await installMockApi(page, {
    requestType: "insurance_supplement",
    customerCredits: true,
  });
  await page.goto("/#/requests/r1");
  await page
    .getByRole("button", { name: "Copy Dash note", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Copied");
  for (const expected of [
    "Insurance supplement",
    "Customer credits: Yes",
    "Wet insulation behind the kitchen wall",
    "York Ridge Apartments",
    "photo1.jpg",
    "note.pdf",
  ])
    expect(copied[0]).toContain(expected);
  await page.getByRole("button", { name: "Edit request", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Copy Dash note", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("radio", { name: "Change order", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Yes, customer credits", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit request", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Copy Dash note", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Copied");
  expect(copied[1]).toContain("Request type: Change order");
  expect(copied[1]).toContain("Customer credits: No");
});

test("blocked clipboard access offers selectable note text on completed requests", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error("Clipboard blocked")),
      },
    }),
  );
  await installMockApi(page, {
    status: "completed",
    requestType: "change_order",
    customerCredits: false,
  });
  await page.goto("/#/requests/r1");
  await page
    .getByRole("button", { name: "Copy Dash note", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Clipboard access is unavailable",
  );
  await expect(page.getByLabel("Dash note to copy manually")).toHaveValue(
    /Wet insulation behind the kitchen wall/,
  );
  await expect(page.getByLabel("Dash note to copy manually")).toHaveValue(
    /Customer credits: No/,
  );
});
