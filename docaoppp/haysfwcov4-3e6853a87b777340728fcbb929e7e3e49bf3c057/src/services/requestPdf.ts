import { PDFDocument, PageSizes, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { ChangeRequest } from "../types";
import { contractAmounts } from "./contract";
import { requestTypeLabel, customerCreditsLabel } from "./dashNote";
import {
  finalDocumentError,
  finalContractTotal,
  signedAmountLabel,
} from "./changeOrder";

export function summaryFilename(request: ChangeRequest): string {
  const identifier = (request.job.jobNumber.trim() || request.id)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 100);
  return `request-summary-${identifier || "request"}.pdf`;
}
export function changeOrderFilename(request: ChangeRequest): string {
  return summaryFilename(request).replace("request-summary-", "change-order-");
}

export async function generateChangeOrderPdf(
  request: ChangeRequest,
  fontBytes: Uint8Array,
): Promise<Uint8Array> {
  const error = finalDocumentError(request);
  if (error) throw new Error(error);
  return generateRequestPdf(request, fontBytes, true);
}

/** Generate from a saved snapshot. Font bytes are injected for browser and Node QA. */
export async function generateRequestPdf(
  request: ChangeRequest,
  fontBytes: Uint8Array,
  customerDocument = false,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const supported = new Set(font.getCharacterSet());
  // Make unsupported characters explicit instead of dropping text or crashing.
  const printable = (text: string) =>
    Array.from(text.replace(/\r\n?/g, "\n").replace(/\t/g, "    "))
      .map((char) =>
        char === "\n" || supported.has(char.codePointAt(0)!)
          ? char
          : `[U+${char.codePointAt(0)!.toString(16).toUpperCase()}]`,
      )
      .join("");
  const [width, height] = PageSizes.Letter;
  const margin = 48;
  const available = width - 2 * margin;
  let page = pdf.addPage(PageSizes.Letter);
  let y = height - margin;
  const documentLabel = customerDocument
    ? "Change order / Addendum"
    : "Request summary";
  // Vector geometry from the app's existing Hays + Sons brand mark.
  const letterhead = () => {
    const scale = 0.7;
    const top = height - margin;
    for (const [x, markY, markWidth, markHeight, color] of [
      [0, 0, 14, 42, rgb(0.86, 0.15, 0.15)],
      [36, 0, 14, 42, rgb(0.1, 0.1, 0.1)],
      [14, 14, 51, 14, rgb(0.1, 0.1, 0.1)],
    ] as const)
      page.drawRectangle({
        x: margin + x * scale,
        y: top - (markY + markHeight) * scale,
        width: markWidth * scale,
        height: markHeight * scale,
        color,
      });
    page.drawText("Hays + Sons", {
      x: margin + 60,
      y: top - 20,
      size: 22,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
    page.drawText("COMPLETE RESTORATION", {
      x: margin + 60,
      y: top - 34,
      size: 8,
      font,
    });
    page.drawLine({
      start: { x: margin, y: top - 44 },
      end: { x: width - margin, y: top - 44 },
      thickness: 2,
      color: rgb(0.86, 0.15, 0.15),
    });
    y = top - 62;
  };
  const nextPage = () => {
    page = pdf.addPage(PageSizes.Letter);
    letterhead();
    page.drawText(`${documentLabel} (continued)`, {
      x: margin,
      y,
      size: 10,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
    y -= 28;
  };
  const ensure = (space: number) => {
    if (y - space < margin + 18) nextPage();
  };
  const line = (text: string, size = 11, color = rgb(0.12, 0.12, 0.12)) => {
    ensure(size + 5);
    if (text) page.drawText(text, { x: margin, y, size, font, color });
    y -= size + 5;
  };
  const paragraph = (text: string, size = customerDocument ? 10 : 11) => {
    for (const block of printable(text).split("\n")) {
      let current = "";
      for (const char of block) {
        if (font.widthOfTextAtSize(current + char, size) > available) {
          const lastSpace = current.lastIndexOf(" ");
          if (lastSpace > 0) {
            line(current.slice(0, lastSpace).trimEnd(), size);
            current = current.slice(lastSpace + 1) + char;
          } else {
            line(current, size);
            current = char;
          }
        } else current += char;
      }
      line(current.trimEnd(), size);
    }
  };
  const section = (title: string) => {
    ensure(60);
    y -= 12;
    line(title, 13, rgb(0.7, 0.1, 0.1));
    y -= 3;
  };
  const field = (label: string, value: string | undefined) =>
    paragraph(`${label}: ${value?.trim() ? value : "Not provided"}`);
  const finish = () => {
    const pages = pdf.getPages();
    pages.forEach((item, index) =>
      item.drawText(`${documentLabel} | Page ${index + 1} of ${pages.length}`, {
        x: margin,
        y: 28,
        size: 9,
        font,
        color: rgb(0.4, 0.4, 0.4),
      }),
    );
    return pdf.save();
  };
  pdf.setTitle(
    `${documentLabel} - ${request.job.jobNumber || request.job.customer || request.id}`,
  );
  pdf.setAuthor("Hays + Sons");
  letterhead();
  paragraph(request.job.branchName || "Hays + Sons Complete Restoration", 9);
  if (request.job.branchAddress?.trim())
    paragraph(request.job.branchAddress, 9);
  if (request.job.branchPhone?.trim()) paragraph(request.job.branchPhone, 9);
  y -= 6;
  line(
    customerDocument ? "Change Order / Addendum" : "Change request summary",
    15,
  );
  if (customerDocument) {
    const job = request.job;
    field("Customer", job.customer);
    field("Property address", job.address);
    if (job.customerPhone?.trim()) field("Customer phone", job.customerPhone);
    if (job.customerEmail?.trim()) field("Customer email", job.customerEmail);
    field("Job number", job.jobNumber);
    field("Change-order number", job.orderNumber);
    field("Change-order date", job.date);
    if (job.projectManager?.trim())
      field("Project manager", job.projectManager);
    if (job.carrier?.trim()) field("Insurance carrier", job.carrier);
    if (job.claim?.trim()) field("Claim number", job.claim);
    field("Insurance-related work", job.insuranceRelated ? "Yes" : "No");
    section("This contract is changed as follows");
    paragraph(request.finalChangeOrder!.scope);
    if (request.lineNumbers?.trim())
      field("Estimate line references (+ add / - remove)", request.lineNumbers);
    ensure(150);
    section("Contract price and time");
    const amounts = contractAmounts(job);
    field("Original contract", amounts.original);
    field("Previous authorized changes", amounts.previous);
    field("Contract total before this change", amounts.total);
    field(
      "This change (increase + / credit -)",
      signedAmountLabel(request.finalChangeOrder!.amount),
    );
    paragraph(`New contract total: ${finalContractTotal(request)}`, 14);
    field("Contract time increased by (days)", job.addedDays);
    // Wording reused from the existing Hays documents change-order template.
    ensure(190);
    section("Approval");
    if (!job.insuranceRelated)
      paragraph(
        "Non-insurance changes require 100% of the Change Order to be paid before work is started.",
        9,
      );
    paragraph(
      "Not valid until signed by owner and contractor and paid in full for non-insured work.",
      9,
    );
    if (job.branchContact?.trim())
      field("Contractor representative", job.branchContact);
    y -= 25;
    line(
      "Owner signature: __________________________    Date: ______________",
      10,
    );
    y -= 20;
    line(
      "Contractor signature: ______________________    Date: ______________",
      10,
    );
    return finish();
  }
  field("Request ID", request.id);
  field(
    "Submitted",
    request.submittedAt
      ? new Date(request.submittedAt).toLocaleString("en-US", {
          timeZone: "America/Indianapolis",
        })
      : undefined,
  );
  field("Status", request.status.replace(/_/g, " "));
  field("Assigned estimator", request.estimatorName);
  field("Request type", requestTypeLabel(request.requestType));
  field("Customer credits", customerCreditsLabel(request.customerCredits));
  field("Estimate line numbers", request.lineNumbers);
  section("Customer and job details");
  const job = request.job;
  for (const [label, value] of [
    ["Customer", job.customer],
    ["Property address", job.address],
    ["Customer phone", job.customerPhone],
    ["Customer email", job.customerEmail],
    ["Job number", job.jobNumber],
    ["Project manager", job.projectManager],
  ])
    field(label!, value);
  for (const [label, value] of [
    ["Change-order number", job.orderNumber],
    ["Insurance carrier", job.carrier],
    ["Claim number", job.claim],
  ]) {
    if (value?.trim()) field(label, value);
  }
  section("Contract price");
  const amounts = contractAmounts(job);
  field("Original contract", amounts.original);
  field("Previous authorized changes", amounts.previous);
  paragraph(`Total contract price: ${amounts.total}`, 14);
  paragraph(
    "Total includes previous authorized changes and excludes this requested change.",
    9,
  );
  section("Submitted changes");
  if (!request.requestedChanges.length)
    paragraph("No written description was provided.");
  request.requestedChanges.forEach((change, index) => {
    ensure(50);
    paragraph(
      `Change ${index + 1}${change.room ? ` - ${change.room}` : ""} (${change.action})`,
      12,
    );
    paragraph(change.description || "No description provided.");
    for (const [label, value] of [
      ["Reason", change.reason],
      ["Measurements", change.measurements],
      ["Materials", change.materials],
      ["Schedule impact", change.scheduleImpact],
    ]) {
      if (value?.trim()) field(label, value);
    }
    y -= 8;
  });
  if (request.informationQuestion?.trim()) {
    section("Outstanding information request");
    paragraph(request.informationQuestion);
  }
  if (request.finalChangeOrder) {
    section("Prepared customer change order");
    field("Final customer scope", request.finalChangeOrder.scope);
    field(
      "Final change amount",
      signedAmountLabel(request.finalChangeOrder.amount),
    );
    field("New contract total", finalContractTotal(request));
  }
  section("Attachments");
  if (!request.attachments.length) paragraph("No attachments.");
  request.attachments.forEach((attachment, index) =>
    paragraph(`${index + 1}. ${attachment.name}`),
  );
  return finish();
}
