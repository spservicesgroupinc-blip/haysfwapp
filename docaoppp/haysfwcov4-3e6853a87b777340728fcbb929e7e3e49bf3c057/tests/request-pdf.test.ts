import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
// @ts-expect-error pdfjs-dist untyped subpath in Node
import pdfjs from "pdfjs-dist/build/pdf.js";
const { getDocument } = pdfjs as any;
import { createRequest, createRequestedChange } from "../src/services/requests";
import {
  generateRequestPdf,
  summaryFilename,
  generateChangeOrderPdf,
  changeOrderFilename,
} from "../src/services/requestPdf";

const fontPath = new URL(
  "../src/assets/fonts/NotoSans-Regular.ttf",
  import.meta.url,
);

async function readPdf(bytes: Uint8Array) {
  const document = await getDocument({ data: bytes, disableFontFace: true })
    .promise;
  const pages: { text: string; items: any[] }[] = [];
  for (let i = 1; i <= document.numPages; i++) {
    const content = await (await document.getPage(i)).getTextContent();
    const items = content.items.filter(
      (item: any) => typeof item.str === "string",
    );
    pages.push({ text: items.map((item: any) => item.str).join(" "), items });
  }
  await document.destroy();
  return pages;
}

test("summary PDF includes contact details, prices, notes and attachment names", async () => {
  const request = createRequest();
  request.id = "qa-request";
  request.requestType = "insurance_supplement";
  request.customerCredits = true;
  request.submittedAt = "2026-10-11T15:00:00Z";
  Object.assign(request.job, {
    customer: "José & Zoë Customer",
    customerPhone: "260-555-0144",
    customerEmail: "customer@example.com",
    address: "123 Sample Street, Fort Wayne, IN",
    jobNumber: "FW-26-001",
    projectManager: "Sample PM",
    originalContract: "167045.81",
    previousChanges: "1250.19",
  });
  request.requestedChanges = [
    {
      ...createRequestedChange(),
      description: "Corrected kitchen note.\nKeep this paragraph.",
      reason: "Hidden damage",
      room: "Kitchen",
      measurements: "12 square feet",
      materials: "Insulation",
      scheduleImpact: "2 working days",
    },
  ];
  request.attachments = [
    {
      id: "a1",
      name: "annotated-photo.jpg",
      kind: "photo",
      mimeType: "image/jpeg",
      size: 128,
      driveFileId: "d1",
    },
  ];
  const bytes = await generateRequestPdf(
    request,
    new Uint8Array(await readFile(fontPath)),
  );
  await mkdir("tmp/request-summary", { recursive: true });
  await writeFile("tmp/request-summary/short.pdf", bytes);
  const pages = await readPdf(bytes);
  const text = pages.map((page) => page.text).join(" ");
  for (const expected of [
    "Request type: Insurance supplement",
    "Customer credits: Yes",
    "José & Zoë Customer",
    "260-555-0144",
    "customer@example.com",
    "123 Sample Street",
    "FW-26-001",
    "Sample PM",
    "$167,045.81",
    "$1,250.19",
    "$168,296.00",
    "Corrected kitchen note.",
    "Keep this paragraph.",
    "Hidden damage",
    "12 square feet",
    "Insulation",
    "2 working days",
    "annotated-photo.jpg",
  ])
    assert.ok(text.includes(expected), expected);
  assert.equal(summaryFilename(request), "request-summary-FW-26-001.pdf");
});

test("customer change order has letterhead, agreed scope, exact revised total and signature lines", async () => {
  const request = createRequest();
  Object.assign(request.job, {
    customer: "José Customer",
    customerPhone: "260-555-0144",
    customerEmail: "customer@example.com",
    address: "123 Sample Street",
    jobNumber: "FW-26-001",
    date: "2026-10-11",
    originalContract: "1000.01",
    previousChanges: "25.09",
    insuranceRelated: false,
    addedDays: "2",
    branchContact: "Jamie Estimator",
  });
  request.lineNumbers = "+12, -34";
  request.finalChangeOrder = {
    scope: "Remove selected trim.\nInstall agreed replacement material.",
    amount: "-250.10",
  };
  request.requestedChanges = [
    {
      ...createRequestedChange(),
      description: "INTERNAL NOTE SHOULD NOT PRINT",
    },
  ];
  const font = new Uint8Array(await readFile(fontPath));
  const bytes = await generateChangeOrderPdf(request, font);
  await mkdir("tmp/request-summary", { recursive: true });
  await writeFile("tmp/request-summary/customer-short.pdf", bytes);
  const pages = await readPdf(bytes);
  const text = pages.map((page) => page.text).join(" ");
  for (const expected of [
    "Hays + Sons",
    "909 Production Road",
    "Change Order / Addendum",
    "José Customer",
    "260-555-0144",
    "customer@example.com",
    "FW-26-001",
    "CO-01",
    "2026-10-11",
    "Remove selected trim.",
    "Install agreed replacement material.",
    "$1,025.10",
    "-$250.10",
    "$775.00",
    "Owner signature",
    "Contractor signature",
    "paid before work",
    "Jamie Estimator",
  ])
    assert.ok(text.includes(expected), expected);
  assert.ok(!text.includes("INTERNAL NOTE"));
  assert.equal(changeOrderFilename(request), "change-order-FW-26-001.pdf");
  request.finalChangeOrder.scope = Array.from(
    { length: 60 },
    (_, i) =>
      `Scope paragraph ${i}: Fully retain agreed customer work and materials. José approves these details.`,
  ).join("\n\n");
  const longBytes = await generateChangeOrderPdf(request, font);
  await writeFile("tmp/request-summary/customer-long.pdf", longBytes);
  const longPages = await readPdf(longBytes);
  const longText = longPages.map((page) => page.text).join(" ");
  assert.ok(longPages.length >= 3);
  for (let i = 0; i < 60; i++)
    assert.ok(longText.includes(`Scope paragraph ${i}:`));
  assert.ok(longText.includes("Owner signature"));
  for (const page of [...pages, ...longPages])
    for (const item of page.items) {
      assert.ok(
        item.transform[4] >= 47 && item.transform[4] + item.width <= 565,
        item.str,
      );
      assert.ok(item.transform[5] >= 27 && item.transform[5] <= 745, item.str);
    }
  request.finalChangeOrder.amount = "";
  await assert.rejects(
    generateChangeOrderPdf(request, font),
    /final change amount/,
  );
});

test("long PDF notes wrap and paginate without losing the final text or crossing margins", async () => {
  const request = createRequest();
  request.id = "long-request";
  request.job.customer = "Long Customer";
  request.job.jobNumber = "../bad/name:*";
  request.requestedChanges = [
    {
      ...createRequestedChange(),
      description: `${Array.from({ length: 80 }, (_, i) => `Paragraph ${i}: Keep every note in the summary, including accented names José and Zoë.`).join("\n\n")}\n${"X".repeat(200)}\nLAST NOTE: complete ✅`,
      reason: "Last reason",
    },
  ];
  const bytes = await generateRequestPdf(
    request,
    new Uint8Array(await readFile(fontPath)),
  );
  await mkdir("tmp/request-summary", { recursive: true });
  await writeFile("tmp/request-summary/long.pdf", bytes);
  const pages = await readPdf(bytes);
  const text = pages.map((page) => page.text).join(" ");
  assert.ok(pages.length >= 4);
  for (let i = 0; i < 80; i++)
    assert.ok(text.includes(`Paragraph ${i}:`), `paragraph ${i}`);
  assert.ok(text.includes("LAST NOTE: complete"));
  assert.ok(text.includes("Last reason"));
  assert.ok(text.includes("Total contract price: Not provided"));
  for (const page of pages)
    for (const item of page.items) {
      assert.ok(item.transform[4] >= 47);
      assert.ok(item.transform[4] + item.width <= 565, item.str);
      assert.ok(item.transform[5] >= 27 && item.transform[5] <= 745, item.str);
    }
  assert.equal(summaryFilename(request), "request-summary-bad-name.pdf");
});
