import { PDFDocument, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { ChangeRequest } from "../types";
import { contractAmounts } from "./contract";
import {
  finalDocumentError,
  finalContractTotal,
  signedAmountLabel,
} from "./changeOrder";
import {
  documentFieldValue,
  type DocumentFieldKey,
} from "./customerDocumentFields";

export interface DocumentFieldSpan {
  key: DocumentFieldKey;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Original Hays form layout, with local spans and decimal-string amounts. */
export async function generateCustomerDocument(
  request: ChangeRequest,
  fontBytes: Uint8Array,
  mode: "draft" | "final",
  boldFontBytes?: Uint8Array,
): Promise<{ bytes: Uint8Array; spans: DocumentFieldSpan[] }> {
  if (mode === "final") {
    const error = finalDocumentError(request);
    if (error) throw new Error(error);
  }
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const bold = boldFontBytes
    ? await pdf.embedFont(boldFontBytes, { subset: true })
    : font;
  const supported = new Set(font.getCharacterSet());
  const printable = (value: string) =>
    Array.from(value.replace(/\r\n?/g, "\n").replace(/\t/g, "    "))
      .map((char) =>
        char === "\n" || supported.has(char.codePointAt(0)!)
          ? char
          : `[U+${char.codePointAt(0)!.toString(16).toUpperCase()}]`,
      )
      .join("");
  const dark = rgb(0.1, 0.1, 0.1),
    red = rgb(0.86, 0.15, 0.15),
    gray = rgb(0.4, 0.4, 0.4);
  const spans: DocumentFieldSpan[] = [];
  let pageNumber = 0;
  let page: PDFPage;
  const text = (
    value: string,
    x: number,
    y: number,
    size = 8.5,
    heading = false,
    width = 500,
  ) => {
    const safe = printable(value).replace(/\n/g, " ");
    const face = heading ? bold : font;
    const measured = face.widthOfTextAtSize(safe, size);
    const fit = measured > width ? (size * width) / measured : size;
    // Bold labels are static ASCII; user-provided values always use Noto Sans.
    page.drawText(safe, { x, y, size: fit, font: face, color: dark });
  };
  const span = (
    key: DocumentFieldKey,
    x: number,
    y: number,
    width: number,
    height = 15,
  ) => {
    spans.push({
      key,
      page: pageNumber,
      x,
      y: 792 - y - height + 3,
      width,
      height,
    });
  };
  const field = (
    key: DocumentFieldKey,
    x: number,
    y: number,
    width: number,
    formatted?: string,
  ) => {
    const raw = documentFieldValue(request, key);
    text(
      formatted ?? (String(raw).trim() || "Not provided"),
      x,
      y,
      8.5,
      false,
      width,
    );
    span(key, x, y, width);
  };
  const line = (x: number, y: number, width: number) =>
    page.drawLine({
      start: { x, y },
      end: { x: x + width, y },
      thickness: 0.75,
      color: gray,
    });
  const box = (
    x: number,
    top: number,
    width: number,
    height: number,
    highlight = false,
  ) =>
    page.drawRectangle({
      x,
      y: top - height,
      width,
      height,
      borderColor: dark,
      borderWidth: 0.75,
      color: highlight ? rgb(1, 0.97, 0.65) : rgb(1, 1, 1),
    });
  const addPage = () => {
    page = pdf.addPage([612, 792]);
    pageNumber += 1;
    for (const [x, y, w, h, color] of [
      [40, 739, 7.3, 22, red],
      [58.9, 739, 7.3, 22, dark],
      [47.3, 746.3, 26.7, 7.3, dark],
    ] as const)
      page.drawRectangle({ x, y, width: w, height: h, color });
    text("Hays+Sons", 81, 746, 18, true, 230);
    text("PROPERTY REPAIR SPECIALISTS", 81, 731, 7, true, 230);
    field("job.branchName", 340, 755, 220);
    field("job.branchAddress", 340, 741, 220);
    field("job.branchPhone", 340, 727, 220);
    text(
      `${request.job.jobNumber}  |  ${request.job.orderNumber}  |  Page ${pageNumber}`,
      50,
      35,
      7,
      false,
      400,
    );
    if (mode === "draft")
      page.drawText("DRAFT - NOT FOR SIGNATURE", {
        x: 50,
        y: 59,
        size: 9,
        font: bold,
        color: red,
      });
  };
  addPage();
  text("Change Order / Addendum", 205, 680, 14, true, 350);
  text("Project Owner:", 50, 654, 8.5, true, 75);
  field("job.customer", 125, 654, 180);
  line(120, 652, 185);
  text("Change Order Number:", 330, 654, 8.5, true, 110);
  field("job.orderNumber", 445, 654, 105);
  line(440, 652, 110);
  text("Job Number:", 50, 636, 8.5, true, 75);
  field("job.jobNumber", 125, 636, 180);
  line(120, 634, 185);
  text("Change Order Date:", 330, 636, 8.5, true, 110);
  field("job.date", 445, 636, 105);
  line(440, 634, 110);
  text("Property Address:", 50, 618, 8.5, true, 85);
  field("job.address", 140, 618, 410);
  line(135, 616, 415);
  text("Insurance:", 50, 600, 8, true, 45);
  field("job.carrier", 100, 600, 100);
  text("Claim #:", 208, 600, 8, true, 40);
  field("job.claim", 250, 600, 90);
  text(
    `${request.job.insuranceRelated ? "[X]" : "[ ]"} Insurance Related`,
    350,
    600,
    7,
    false,
    96,
  );
  text(
    `${request.job.insuranceRelated ? "[ ]" : "[X]"} Non Insurance Related*`,
    448,
    600,
    6.5,
    false,
    103,
  );
  span("job.insuranceRelated", 350, 600, 200);

  const wrap = (value: string, width: number, size: number) => {
    const lines: string[] = [];
    for (const paragraph of printable(value).split("\n")) {
      if (!paragraph) {
        lines.push("");
        continue;
      }
      let current = "";
      for (const char of paragraph) {
        if (font.widthOfTextAtSize(current + char, size) > width && current) {
          const space = current.lastIndexOf(" ");
          if (space > 0) {
            lines.push(current.slice(0, space));
            current = current.slice(space + 1);
          } else {
            lines.push(current);
            current = "";
          }
        }
        current += char;
      }
      if (current) lines.push(current);
    }
    return lines;
  };
  const scopeLines = wrap(
    request.finalChangeOrder?.scope || "Not provided",
    480,
    8.5,
  );
  const drawScope = (
    top: number,
    height: number,
    label: string,
    lines: string[],
  ) => {
    box(50, top, 500, 18, true);
    text(label, 60, top - 13, 9, true, 480);
    box(50, top - 18, 500, height);
    lines.forEach((value, index) =>
      text(value, 60, top - 35 - index * 13, 8.5, false, 480),
    );
    span("finalChangeOrder.scope", 60, top - height - 6, 480, height - 12);
  };
  const firstScope = scopeLines.splice(0, 9);
  drawScope(575, 142, "This contract is changed as follows:", firstScope);
  if (scopeLines.length)
    text("Scope continues on the following pages.", 60, 419, 7, false, 480);

  box(50, 391, 500, 30, true);
  text(
    "*Non-Insurance changes require 100% of the Change Order to be paid before work is started.",
    60,
    377,
    7.5,
    true,
    480,
  );
  text(
    "Not valid until signed by owner and contractor and paid in full for non-insured work.",
    60,
    366,
    7.5,
    true,
    480,
  );
  const amounts = contractAmounts(request.job);
  const financial = (
    label: string,
    value: string,
    y: number,
    key?: DocumentFieldKey,
  ) => {
    text(label, 50, y, 8, false, 360);
    line(50, y - 5, 500);
    text(value, 435, y, 8.5, false, 115);
    if (key) span(key, 435, y, 115);
  };
  financial(
    "The original contract sum was:",
    amounts.original,
    343,
    "job.originalContract",
  );
  financial(
    "Net changes by previous authorized change orders:",
    amounts.previous,
    321,
    "job.previousChanges",
  );
  financial("The contract sum prior to this change was:", amounts.total, 299);
  financial(
    "The contract sum will change by this signed amount:",
    signedAmountLabel(request.finalChangeOrder?.amount),
    277,
    "finalChangeOrder.amount",
  );
  financial(
    "The new contract sum including this change order will be:",
    finalContractTotal(request),
    255,
  );
  text("The contract time will be increased by:", 50, 233, 8, true, 220);
  field("job.addedDays", 275, 233, 35);
  text("days.", 315, 233, 8);
  text("Contractor", 50, 195, 9, true);
  text("Owner", 330, 195, 9, true);
  line(50, 172, 200);
  line(330, 172, 220);
  text("Signature", 50, 160, 7.5);
  text("Signature", 330, 160, 7.5);
  text("Hays + Sons", 50, 145, 7.5);
  field("job.branchContact", 115, 145, 135);
  text(request.job.customer, 330, 145, 7.5, false, 220);
  line(50, 118, 200);
  line(330, 118, 220);
  text("Date", 50, 106, 7.5);
  text("Date", 330, 106, 7.5);
  text("Hays + Sons - Property Repair Specialists", 190, 83, 8, true, 365);
  while (scopeLines.length) {
    addPage();
    text("Change Order / Addendum - continued scope", 50, 682, 13, true, 500);
    text(
      `${request.job.customer} | ${request.job.address}`,
      50,
      661,
      9,
      false,
      500,
    );
    drawScope(
      640,
      533,
      "This contract is changed as follows (continued):",
      scopeLines.splice(0, 39),
    );
  }
  return { bytes: await pdf.save(), spans };
}
