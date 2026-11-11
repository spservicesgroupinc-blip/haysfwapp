import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequest } from "../src/services/requests";
import { generateCustomerDocument } from "../src/services/customerDocumentPdf";
import { PDFDocument } from "pdf-lib";
// @ts-expect-error pdfjs-dist untyped subpath in Node
import pdfjs from "pdfjs-dist/build/pdf.js";

test("original customer form uses exact totals, local spans, Unicode and scope continuation", async () => {
  const request = createRequest();
  Object.assign(request.job, {
    customer: "José & Zoë",
    address: "123 Example Street",
    jobNumber: "QA-1",
    originalContract: "1000.01",
    previousChanges: "20.09",
  });
  request.finalChangeOrder = {
    amount: "-30.10",
    scope:
      Array.from(
        { length: 100 },
        (_, i) => `Work ${i + 1}: Replacement insulation and trim`,
      ).join("\n") + "\nEND OF AGREED SCOPE",
  };
  const font = new Uint8Array(
    await readFile(
      new URL("../src/assets/fonts/NotoSans-Regular.ttf", import.meta.url),
    ),
  );
  const result = await generateCustomerDocument(request, font, "final");
  const pdf = await pdfjs.getDocument({
    data: result.bytes.slice(),
    disableFontFace: true,
  }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++)
    text += (await (await pdf.getPage(i)).getTextContent()).items
      .map((item: any) => item.str)
      .join(" ");
  assert.ok(pdf.numPages > 1);
  for (const value of [
    "Change Order / Addendum",
    "José & Zoë",
    "$1,020.10",
    "-$30.10",
    "$990.00",
    "END OF AGREED SCOPE",
    "Contractor",
    "Owner",
    "Signature",
    "100%",
  ])
    assert.ok(text.includes(value), value);
  assert.ok(!text.includes("DRAFT"));
  for (const span of result.spans) {
    assert.ok(span.page >= 1 && span.page <= pdf.numPages);
    assert.ok(
      span.x >= 0 &&
        span.y >= 0 &&
        span.x + span.width <= 612 &&
        span.y + span.height <= 792,
      span.key,
    );
  }
  assert.ok(
    result.spans.some(
      (span) => span.key === "finalChangeOrder.scope" && span.page > 1,
    ),
  );
  assert.equal(
    (await PDFDocument.load(result.bytes)).getForm().getFields().length,
    0,
  );
  await mkdir("tmp/customer-document", { recursive: true });
  await writeFile("tmp/customer-document/long.pdf", result.bytes);
  await pdf.destroy();
  request.finalChangeOrder.scope =
    "Replace kitchen insulation.\nCredit unused trim.";
  const short = await generateCustomerDocument(request, font, "final");
  await writeFile("tmp/customer-document/short.pdf", short.bytes);
});

test("incomplete previews are drafts and final generation refuses missing values", async () => {
  const request = createRequest();
  const font = new Uint8Array(
    await readFile(
      new URL("../src/assets/fonts/NotoSans-Regular.ttf", import.meta.url),
    ),
  );
  const draft = await generateCustomerDocument(request, font, "draft");
  const pdf = await pdfjs.getDocument({
    data: draft.bytes.slice(),
    disableFontFace: true,
  }).promise;
  const text = (await (await pdf.getPage(1)).getTextContent()).items
    .map((item: any) => item.str)
    .join(" ");
  assert.ok(text.includes("DRAFT"));
  assert.ok(text.includes("Not provided"));
  await assert.rejects(
    generateCustomerDocument(request, font, "final"),
    /customer name/,
  );
  await pdf.destroy();
});
