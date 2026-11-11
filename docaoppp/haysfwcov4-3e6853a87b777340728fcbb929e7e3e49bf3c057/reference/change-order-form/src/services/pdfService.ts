import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from 'pdf-lib';
import { RestorationJobData } from '../types/jobData';

// -------------------------------------------------------------
// Text sanitisation (WinAnsi safety)
// -------------------------------------------------------------

/**
 * Sanitises input text so pdf-lib can never throw a WinAnsi encoding error.
 * Common typographic / symbolic characters are transliterated to sensible ASCII
 * equivalents; anything still outside the WinAnsi range (emoji, CJK, ...) is
 * replaced with a literal '?' rather than being silently deleted.
 */
export function cleanTextForPdf(text: string | null | undefined): string {
  if (text == null) return '';
  let s = String(text);
  // Collapse control characters that pdf-lib cannot encode.
  s = s.replace(/\r\n?/g, ' ').replace(/[\n\t\f\v]/g, ' ');
  // Check markers (listed first so they survive the generic tick handling).
  s = s.replace(/\[\u2713\]/g, '[X]').replace(/\[\u2714\]/g, '[X]');
  s = s.replace(/[\u2713\u2714\u2611\u2612\u2705]/g, '[X]');
  s = s.replace(/[\u2610\u25A1\u25FB]/g, '[ ]');
  // Quotes / primes / guillemets
  s = s.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");
  s = s.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
  s = s.replace(/[\u2039]/g, '<').replace(/[\u203A]/g, '>');
  s = s.replace(/[\u00AB]/g, '<<').replace(/[\u00BB]/g, '>>');
  // Dashes
  s = s.replace(/[\u2012\u2013\u2014\u2015\u2212]/g, '-');
  // Bullets / list markers
  s = s.replace(/[\u2022\u2023\u25AA\u25AB\u25CF\u25E6\u2043\u2219\u25FE\u25FC\u25C6]/g, '-');
  // Ellipsis
  s = s.replace(/\u2026/g, '...');
  // Fractions
  s = s.replace(/\u00BD/g, '1/2').replace(/\u00BC/g, '1/4').replace(/\u00BE/g, '3/4');
  s = s.replace(/\u2153/g, '1/3').replace(/\u2154/g, '2/3');
  // Fancy / non breaking spaces and misc symbols
  s = s.replace(/[\u00A0\u2007\u202F\u2009\u200A]/g, ' ');
  s = s.replace(/\u2122/g, '(TM)').replace(/\u00AE/g, '(R)').replace(/\u00A9/g, '(C)');
  s = s.replace(/\u20AC/g, 'EUR').replace(/\u00A3/g, 'GBP').replace(/\u00A5/g, 'JPY');
  // Anything left outside WinAnsi (emoji, CJK, ...) becomes a visible placeholder.
  return s.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

// -------------------------------------------------------------
// Defensive prototype patches
// -------------------------------------------------------------
// pdf-lib throws when asked to encode a character outside the font's WinAnsi
// encoding. Rather than trusting every call site we sanitise centrally. The
// overrides are signature-safe so every pdf-lib overload (and `tsc`) is happy.
type AnyFunction = (...args: any[]) => any;

const originalDrawText = PDFPage.prototype.drawText as unknown as AnyFunction;
(PDFPage.prototype as unknown as { drawText: AnyFunction }).drawText = function (...args: any[]) {
  if (typeof args[0] === 'string') args[0] = cleanTextForPdf(args[0]);
  return originalDrawText.apply(this, args);
};

const originalWidthOfTextAtSize = PDFFont.prototype.widthOfTextAtSize as unknown as AnyFunction;
(PDFFont.prototype as unknown as { widthOfTextAtSize: AnyFunction }).widthOfTextAtSize = function (...args: any[]) {
  if (typeof args[0] === 'string') args[0] = cleanTextForPdf(args[0]);
  return originalWidthOfTextAtSize.apply(this, args);
};

// -------------------------------------------------------------
// Field-span capture (click-to-edit PDF preview)
// -------------------------------------------------------------
// While a document is being generated inside `generateDocWithSpans`, every
// data-field draw call records the exact PDF-space rectangle of the value it
// drew. The editable preview overlays click targets on the rendered page using
// these rectangles so a user can click any value on the PDF and edit it in
// place. Capture is opt-in and never active during normal generation (e.g. the
// merged complete packet).
export interface PdfFieldSpan {
  /** Dot-path of the jobData field, e.g. 'insurance.carrier'. Matches pdfFieldSchema keys. */
  key: string;
  /** 1-based page number within the document. */
  page: number;
  /** Left edge in PDF points (72 dpi). */
  x: number;
  /** Top edge in PDF points, measured from the TOP of the page. */
  y: number;
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
  /** Font size in points — used to style the inline editor. */
  size: number;
  bold: boolean;
}

interface PendingFieldSpan {
  key: string;
  page: PDFPage;
  x: number;
  /** Top edge of the hit box, in bottom-origin PDF points (converted later). */
  yTop: number;
  width: number;
  height: number;
  size: number;
  bold: boolean;
}

interface FieldCaptureState {
  enabled: boolean;
  doc: PDFDocument | null;
  pageIndex: WeakMap<PDFPage, number>;
  pageCount: number;
  spans: PendingFieldSpan[];
}

const fieldCapture: FieldCaptureState = {
  enabled: false,
  doc: null,
  pageIndex: new WeakMap(),
  pageCount: 0,
  spans: [],
};

// Track page creation order so spans can report 1-based page numbers without
// every generator having to thread an index through its helpers. Mirrors the
// sanitisation patches above: signature-safe and inert while capture is off.
const originalAddPage = PDFDocument.prototype.addPage as unknown as AnyFunction;
(PDFDocument.prototype as unknown as { addPage: AnyFunction }).addPage = function (...args: any[]) {
  const page = originalAddPage.apply(this, args);
  if (fieldCapture.enabled) {
    fieldCapture.doc = this as unknown as PDFDocument;
    fieldCapture.pageIndex.set(page as PDFPage, fieldCapture.pageCount++);
  }
  return page;
};

function captureFieldSpan(span: PendingFieldSpan) {
  if (!fieldCapture.enabled) return;
  fieldCapture.spans.push(span);
}

export function beginFieldCapture(): void {
  fieldCapture.enabled = true;
  fieldCapture.doc = null;
  fieldCapture.pageCount = 0;
  fieldCapture.spans = [];
}

export function endFieldCapture(): PdfFieldSpan[] {
  fieldCapture.enabled = false;
  const doc = fieldCapture.doc;
  const spans: PdfFieldSpan[] = [];
  for (const s of fieldCapture.spans) {
    const pageIndex = doc ? (fieldCapture.pageIndex.get(s.page) ?? -1) : -1;
    spans.push({
      key: s.key,
      page: pageIndex + 1,
      x: s.x,
      y: Math.max(0, s.page.getHeight() - s.yTop),
      width: s.width,
      height: s.height,
      size: s.size,
      bold: s.bold,
    });
  }
  fieldCapture.doc = null;
  fieldCapture.spans = [];
  return spans;
}

/**
 * Generates a single document while recording the clickable span of every data
 * field it draws. Used by the editable PDF preview; never called for the
 * merged complete packet (spans would be invalid after page copying).
 */
export async function generateDocWithSpans(
  generator: (data: RestorationJobData) => Promise<Uint8Array>,
  data: RestorationJobData
): Promise<{ bytes: Uint8Array; spans: PdfFieldSpan[] }> {
  beginFieldCapture();
  try {
    const bytes = await generator(data);
    const spans = endFieldCapture();
    return { bytes, spans };
  } catch (err) {
    endFieldCapture();
    throw err;
  }
}

/**
 * Records a clickable span for a data field that renders BLANK in the current
 * document (nothing is drawn). Lets the editor offer a click target on the
 * empty box so a blank field can be filled without a side panel.
 */
export function captureEmptyFieldSpan(
  page: PDFPage,
  options: { key: string; x: number; y: number; size: number; width?: number; bold?: boolean }
) {
  captureFieldSpan({
    key: options.key,
    page,
    x: options.x,
    yTop: options.y + options.size * 1.05,
    width: options.width ?? 48,
    height: options.size * 1.25,
    size: options.size,
    bold: options.bold ?? false,
  });
}

// -------------------------------------------------------------
// Page geometry (US Letter @ 72 dpi)
// -------------------------------------------------------------
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 40;
const CONTENT_W = 532; // printable width: x = 40 .. 572
const CONTENT_RIGHT = MARGIN_X + CONTENT_W;
const HEADER_RULE_Y = 720;
const FOOTER_RULE_Y = 40;
const ELLIPSIS = '\u2026';

// Hays + Sons brand palette — one brand red, one ink. Mirrors the tokens in
// index.css (`--color-brand` / `--color-ink`) and components/BrandLogo.tsx.
// COLOR_RED used to be rgb(0.85, 0.1, 0.1) (#D91A1A), which is why the printed
// packet never quite matched the app; it is now the same #DC2626 the UI uses.
const COLOR_RED = rgb(220 / 255, 38 / 255, 38 / 255); // #DC2626
const COLOR_DARK = rgb(26 / 255, 26 / 255, 26 / 255); // #1A1A1A — text ink and the logo plus
const COLOR_GRAY = rgb(0.4, 0.4, 0.4);
const COLOR_BORDER = rgb(0.65, 0.65, 0.65);
const COLOR_HIGHLIGHT = rgb(1, 0.96, 0.55); // Yellow highlight seen in original documents
const COLOR_CYAN = rgb(0.7, 0.92, 0.98);
const COLOR_GREEN = rgb(0.1, 0.6, 0.2);
const COLOR_LINE = rgb(0.6, 0.6, 0.6);
const COLOR_WHITE = rgb(1, 1, 1);
const COLOR_PANEL = rgb(0.98, 0.98, 0.98);

/**
 * Utility to format currency values cleanly
 */
export function formatCurrency(amount: number | '' | undefined | null): string {
  if (amount === '' || amount === undefined || amount === null || isNaN(Number(amount))) {
    return '$0.00';
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(Number(amount));
}

/**
 * Triggers a browser file download of PDF bytes
 */
export function downloadPdf(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Creates an in-memory Object URL for in-app PDF previewing in an iframe/modal
 */
export function createPdfBlobUrl(bytes: Uint8Array): string {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
  return URL.createObjectURL(blob);
}

// -------------------------------------------------------------
// Common PDF Drawing Helpers
// -------------------------------------------------------------

/**
 * Coerces any value into a trimmed, PDF-safe string. Returns `fallback`
 * when the value is null / undefined / an empty (or whitespace) string so a
 * document can never render the literal text "undefined".
 */
function val(value: unknown, fallback: string = ''): string {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  return s.length ? s : fallback;
}

/**
 * Readability alias for `val()` — used where a default is supplied inline.
 */
function txt(value: unknown, fallback: string = ''): string {
  return val(value, fallback);
}

/**
 * Draws a single line of text right-aligned to `rightX`. The font size is
 * progressively reduced (down to `minSize`) to make the text fit between
 * `minX` and `rightX`; if it still does not fit it is truncated with an
 * ellipsis. This guarantees header/field values can never overflow the page.
 */
function drawRightAligned(
  page: PDFPage,
  text: string,
  options: {
    rightX: number;
    minX?: number;
    y: number;
    size: number;
    font: PDFFont;
    color?: any;
    minSize?: number;
    /** When set, records a clickable field span for the PDF editor. */
    key?: string;
    bold?: boolean;
  }
) {
  const raw = cleanTextForPdf(text ?? '');
  if (!raw) return;

  const minX = options.minX ?? MARGIN_X;
  const minSize = options.minSize ?? options.size;
  const available = Math.max(1, options.rightX - minX);

  let size = options.size;
  let width = options.font.widthOfTextAtSize(raw, size);
  while (width > available && size > minSize) {
    size = Math.max(minSize, size - 0.25);
    width = options.font.widthOfTextAtSize(raw, size);
  }

  let out = raw;
  if (width > available) {
    while (out.length > 1 && options.font.widthOfTextAtSize(out + ELLIPSIS, size) > available) {
      out = out.slice(0, -1);
    }
    out += ELLIPSIS;
    width = options.font.widthOfTextAtSize(out, size);
  }

  page.drawText(out, {
    x: options.rightX - width,
    y: options.y,
    size,
    font: options.font,
    color: options.color ?? COLOR_DARK,
  });

  if (options.key) {
    captureFieldSpan({
      key: options.key,
      page,
      x: options.rightX - width,
      yTop: options.y + size * 1.05,
      width: Math.max(width, 24),
      height: size * 1.25,
      size,
      bold: options.bold ?? false,
    });
  }
}

/**
 * Draws a tracked data-field value and records its clickable span. This is the
 * workhorse the editable preview relies on: every value drawn through it is
 * click-to-edit on the PDF. Empty values still record a small span so blank
 * fields remain clickable.
 */
function drawFieldValue(
  page: PDFPage,
  options: {
    key: string;
    value: unknown;
    x: number;
    y: number;
    size: number;
    font: PDFFont;
    color?: any;
    bold?: boolean;
    fallback?: string;
    minWidth?: number;
  }
) {
  const raw = cleanTextForPdf(val(options.value, options.fallback ?? ''));
  const height = options.size * 1.25;
  const yTop = options.y + options.size * 1.05;
  if (raw) {
    const width = options.font.widthOfTextAtSize(raw, options.size);
    page.drawText(raw, {
      x: options.x,
      y: options.y,
      size: options.size,
      font: options.font,
      color: options.color ?? COLOR_DARK,
    });
    captureFieldSpan({
      key: options.key,
      page,
      x: options.x,
      yTop,
      width: Math.max(width, options.minWidth ?? 24),
      height,
      size: options.size,
      bold: options.bold ?? false,
    });
  } else {
    captureFieldSpan({
      key: options.key,
      page,
      x: options.x,
      yTop,
      width: options.minWidth ?? 48,
      height,
      size: options.size,
      bold: options.bold ?? false,
    });
  }
}

/** Records one span covering a multi-line block (wrapped text / line groups). */
function captureBoxSpan(
  page: PDFPage,
  key: string,
  x: number,
  firstBaselineY: number,
  lastBaselineY: number,
  size: number,
  width: number,
  bold: boolean
) {
  captureFieldSpan({
    key,
    page,
    x,
    yTop: firstBaselineY + size * 1.05,
    width: Math.max(width, 24),
    height: Math.max(size * 1.25, firstBaselineY + size * 1.05 - (lastBaselineY - size * 0.3)),
    size,
    bold,
  });
}

function drawHeaderLogo(
  page: PDFPage,
  fontBold: PDFFont,
  fontReg: PDFFont,
  branchInfo: RestorationJobData['branch']
) {
  // Brand mark: red bar + heavy black plus at the same height, whose crossbar
  // runs flush into the bar — no gap — so bar + crossbar + stem also read as an
  // "H". The geometry is the web mark (components/BrandLogo.tsx, a 65 x 42
  // canvas) scaled to a 22pt height, so the packet header and the app header are
  // literally the same art.
  const markBaseY = 735.4;
  const markHeight = 22;
  const markStroke = 7.3; // 14/42 of the mark height — bar width equals plus stroke width.
  page.drawRectangle({ x: 40, y: markBaseY, width: markStroke, height: markHeight, color: COLOR_RED });
  page.drawRectangle({ x: 58.9, y: markBaseY, width: markStroke, height: markHeight, color: COLOR_DARK });
  // Crossbar: starts exactly where the red bar ends (x = 40 + markStroke) so the
  // two shapes touch, and runs 26.7pt to the right edge of the mark.
  page.drawRectangle({ x: 47.3, y: markBaseY + 7.3, width: 26.7, height: markStroke, color: COLOR_DARK });

  // Wordmark — set tight, with no spaces around the "+", and spaced off the
  // mark's right edge (74.0) by the same 6.5pt gap the app lockup uses.
  page.drawText('Hays+Sons', { x: 81, y: 746, size: 18, font: fontBold, color: COLOR_DARK });
  page.drawText('Your Disaster Recovery Professionals', {
    x: 81,
    y: 734,
    size: 7.5,
    font: fontReg,
    color: COLOR_GRAY,
  });

  // Branch contact block - genuinely right aligned, and every value guarded so
  // no `undefined` can ever reach the page.
  const rightX = CONTENT_RIGHT;
  const rightMinX = 300;
  const division = txt(branchInfo?.division, 'Hays and Sons - Fort Wayne');
  const addressLine = [val(branchInfo?.address), val(branchInfo?.cityStateZip)].filter(Boolean).join(', ');
  const phoneFaxBits: string[] = [];
  const phone = val(branchInfo?.phone);
  const fax = val(branchInfo?.fax);
  if (phone) phoneFaxBits.push(`Phone: ${phone}`);
  if (fax) phoneFaxBits.push(`Fax: ${fax}`);
  const contactLine = phoneFaxBits.join('  |  ');

  drawRightAligned(page, division, { rightX, minX: rightMinX, y: 756, size: 8.5, font: fontBold, color: COLOR_DARK, minSize: 6 });
  if (addressLine) {
    drawRightAligned(page, addressLine, { rightX, minX: rightMinX, y: 745, size: 7.5, font: fontReg, color: COLOR_GRAY, minSize: 5.5 });
  }
  if (contactLine) {
    drawRightAligned(page, contactLine, { rightX, minX: rightMinX, y: 734, size: 7.5, font: fontReg, color: COLOR_GRAY, minSize: 5.5 });
  }

  // Header separator line
  page.drawLine({ start: { x: MARGIN_X, y: HEADER_RULE_Y }, end: { x: CONTENT_RIGHT, y: HEADER_RULE_Y }, thickness: 1, color: COLOR_DARK });
}

/**
 * Cleanly wraps text across multiple lines inside a bounding box
 */
function drawWrappedText(
  page: PDFPage,
  text: string,
  options: {
    x: number;
    y: number;
    maxWidth: number;
    lineHeight: number;
    font: PDFFont;
    size: number;
    color?: any;
    maxLines?: number;
    /** When set, records a clickable field span covering the whole block. */
    key?: string;
    bold?: boolean;
  }
) {
  if (!text) return;
  const words = text.split(/\s+/);
  let currentLine = '';
  let currentY = options.y;
  let linesDrawn = 0;
  const maxLines = options.maxLines || 10;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = options.font.widthOfTextAtSize(testLine, options.size);
    if (testWidth > options.maxWidth && currentLine) {
      page.drawText(currentLine, {
        x: options.x,
        y: currentY,
        size: options.size,
        font: options.font,
        color: options.color || COLOR_DARK,
      });
      linesDrawn++;
      if (linesDrawn >= maxLines) {
        if (options.key) {
          captureBoxSpan(page, options.key, options.x, options.y, currentY, options.size, options.maxWidth, options.bold ?? false);
        }
        return;
      }
      currentLine = word;
      currentY -= options.lineHeight;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine && linesDrawn < maxLines) {
    page.drawText(currentLine, {
      x: options.x,
      y: currentY,
      size: options.size,
      font: options.font,
      color: options.color || COLOR_DARK,
    });
    if (options.key) {
      captureBoxSpan(page, options.key, options.x, options.y, currentY, options.size, options.maxWidth, options.bold ?? false);
    }
  }
}

/**
 * Splits a string into lines that fit within `maxWidth` at the given font and
 * size, breaking on word boundaries only. Unlike a fixed character count this
 * never splits a word in half and never silently drops content.
 */
function wrapLines(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const clean = cleanTextForPdf(text ?? '').trim();
  if (!clean) return [];

  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Draws pre-wrapped lines downward from `y`, using `indentX` for continuation
 * lines. Returns the y coordinate of the last line that was drawn.
 */
function drawLines(
  page: PDFPage,
  lines: string[],
  options: {
    x: number;
    y: number;
    lineHeight: number;
    size: number;
    font: PDFFont;
    color?: any;
    indentX?: number;
    /** When set, records a clickable field span covering the whole block. */
    key?: string;
    bold?: boolean;
  }
): number {
  let y = options.y;
  lines.forEach((line, index) => {
    page.drawText(line, {
      x: index === 0 ? options.x : options.indentX ?? options.x,
      y,
      size: options.size,
      font: options.font,
      color: options.color ?? COLOR_DARK,
    });
    if (index < lines.length - 1) y -= options.lineHeight;
  });
  if (options.key && lines.length > 0) {
    const widest = Math.max(...lines.map((l) => options.font.widthOfTextAtSize(cleanTextForPdf(l), options.size)));
    captureBoxSpan(page, options.key, options.x, options.y, y, options.size, widest, options.bold ?? false);
  }
  return y;
}

// -------------------------------------------------------------
// 1. PRELIMINARY REPORT GENERATOR
// -------------------------------------------------------------
export async function generatePreliminaryReport(data: RestorationJobData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Official Hays + Sons Header & Division Branding
  drawHeaderLogo(page, fontBold, font, data.branch);

  // Title Banner
  page.drawRectangle({ x: 40, y: 708, width: 532, height: 16, color: COLOR_RED });
  page.drawText('PRELIMINARY REPORT — INSURANCE RESTORATION DATA', {
    x: 155,
    y: 712,
    size: 9,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  // Section 1: Insurance Details
  page.drawText('Insurance Details', {
    x: 40,
    y: 692,
    size: 9.5,
    font: fontBold,
    color: COLOR_DARK,
  });

  // Table boxes for Insurance
  const insBoxX = 170;
  const insBoxW = 402;
  const insY = 684;

  // Carrier
  page.drawText('Insurance Carrier:', { x: 40, y: insY - 10, size: 8, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: insBoxX, y: insY - 14, width: insBoxW, height: 16, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, { key: 'insurance.carrier', value: data.insurance.carrier, x: insBoxX + 4, y: insY - 10, size: 8.5, font, color: COLOR_DARK });

  // Primary Adjuster
  page.drawText('Primary Adjuster:', { x: 40, y: insY - 26, size: 8, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: insBoxX, y: insY - 30, width: insBoxW, height: 16, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, { key: 'insurance.primaryAdjuster', value: data.insurance.primaryAdjuster, x: insBoxX + 4, y: insY - 26, size: 8.5, font, color: COLOR_DARK });

  // Independent Adjuster
  page.drawText('Independent Adjuster:', { x: 40, y: insY - 42, size: 8, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: insBoxX, y: insY - 46, width: insBoxW, height: 16, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, { key: 'insurance.independentAdjuster', value: data.insurance.independentAdjuster, x: insBoxX + 4, y: insY - 42, size: 8.5, font, color: COLOR_DARK });

  // Broker / Agent
  page.drawText('Broker/Agent:', { x: 40, y: insY - 58, size: 8, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: insBoxX, y: insY - 62, width: insBoxW, height: 16, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, { key: 'insurance.brokerAgent', value: data.insurance.brokerAgent, x: insBoxX + 4, y: insY - 58, size: 8.5, font, color: COLOR_DARK });

  // Policy Number & Customer Claim Number Split Row
  page.drawText('Policy Number:', { x: 40, y: insY - 74, size: 7.5, font: fontBold, color: COLOR_DARK });
  page.drawText('Customer Claim Number:', { x: 40, y: insY - 86, size: 7.5, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: insBoxX, y: insY - 92, width: 170, height: 28, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, { key: 'insurance.policyNumber', value: data.insurance.policyNumber, x: insBoxX + 4, y: insY - 76, size: 8, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'insurance.claimNumber', value: data.insurance.claimNumber, x: insBoxX + 4, y: insY - 88, size: 8, font, color: COLOR_DARK });

  page.drawText('Reported By:', { x: 350, y: insY - 74, size: 7.5, font: fontBold, color: COLOR_DARK });
  page.drawText('Referred By:', { x: 350, y: insY - 86, size: 7.5, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: 420, y: insY - 92, width: 152, height: 28, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, { key: 'insurance.reportedBy', value: data.insurance.reportedBy, x: 424, y: insY - 76, size: 8, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'insurance.referredBy', value: data.insurance.referredBy, x: 424, y: insY - 88, size: 8, font, color: COLOR_DARK });

  // Section 2: Customer Details
  const custY = 576;
  page.drawText('Customer Details', { x: 40, y: custY, size: 9.5, font: fontBold, color: COLOR_DARK });

  // Job Number & Job Name
  page.drawText('Job Number:', { x: 40, y: custY - 16, size: 7.5, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: insBoxX, y: custY - 20, width: 160, height: 16, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, { key: 'customer.jobNumber', value: data.customer.jobNumber, x: insBoxX + 4, y: custY - 16, size: 8, font, color: COLOR_DARK });

  page.drawText('Job Name:', { x: 345, y: custY - 16, size: 7.5, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: 400, y: custY - 20, width: 172, height: 16, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, {
    key: 'customer.jobName',
    value: data.customer.jobName,
    fallback: data.customer.customerName + ' Restoration',
    x: 404,
    y: custY - 16,
    size: 8,
    font,
    color: COLOR_DARK,
  });

  // Customer Name
  page.drawText('Customer Name:', { x: 40, y: custY - 36, size: 7.5, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: insBoxX, y: custY - 40, width: insBoxW, height: 16, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, { key: 'customer.customerName', value: data.customer.customerName, x: insBoxX + 4, y: custY - 36, size: 8.5, font, color: COLOR_DARK });

  // Mailing Address
  page.drawText('Mailing Address:', { x: 40, y: custY - 56, size: 7.5, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: insBoxX, y: custY - 60, width: insBoxW, height: 16, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, {
    key: 'customer.mailingLine',
    value: `${data.customer.mailingAddress || ''}, ${data.customer.mailingCityStateZip || ''}`,
    x: insBoxX + 4,
    y: custY - 56,
    size: 8,
    font,
    color: COLOR_DARK,
  });

  // Phones & Email Row
  page.drawText('Main Phone Number:', { x: 40, y: custY - 74, size: 7, font: fontBold, color: COLOR_DARK });
  page.drawText('Home Phone:', { x: 40, y: custY - 86, size: 7, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: insBoxX, y: custY - 92, width: 160, height: 28, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, { key: 'customer.mainPhone', value: data.customer.mainPhone, x: insBoxX + 4, y: custY - 76, size: 7.5, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'customer.homePhone', value: data.customer.homePhone, x: insBoxX + 4, y: custY - 88, size: 7.5, font, color: COLOR_DARK });

  page.drawText('EMAIL:', { x: 340, y: custY - 74, size: 7, font: fontBold, color: COLOR_DARK });
  page.drawText('Mobile Number:', { x: 340, y: custY - 86, size: 7, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: 420, y: custY - 92, width: 152, height: 28, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, { key: 'customer.email', value: data.customer.email, x: 424, y: custY - 76, size: 7.5, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'customer.mobilePhone', value: data.customer.mobilePhone, x: 424, y: custY - 88, size: 7.5, font, color: COLOR_DARK });

  // Loss Address & Contact
  page.drawText('Loss Address:', { x: 40, y: custY - 106, size: 7.5, font: fontBold, color: COLOR_DARK });
  page.drawText('Loss Contact:', { x: 40, y: custY - 118, size: 7.5, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: insBoxX, y: custY - 122, width: 220, height: 26, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, { key: 'customer.lossAddress', value: data.customer.lossAddress, x: insBoxX + 4, y: custY - 106, size: 7.5, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'customer.lossContact', value: data.customer.lossContact, x: insBoxX + 4, y: custY - 118, size: 7.5, font, color: COLOR_DARK });

  page.drawText('Mobile:', { x: 400, y: custY - 112, size: 8, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: 440, y: custY - 122, width: 132, height: 26, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, { key: 'customer.mobilePhone', value: data.customer.mobilePhone, x: 444, y: custY - 112, size: 8, font, color: COLOR_DARK });

  // Section 3: Job Details
  const jobY = 445;
  page.drawText('Job Details', { x: 40, y: jobY, size: 10, font: fontBold, color: COLOR_DARK });

  // Dates row
  page.drawText('Date Received:', { x: 40, y: jobY - 14, size: 7.5, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: insBoxX, y: jobY - 18, width: 160, height: 14, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, { key: 'insurance.dateReceived', value: data.insurance.dateReceived, x: insBoxX + 4, y: jobY - 14, size: 7.5, font, color: COLOR_DARK });

  page.drawText('Date of Loss:', { x: 340, y: jobY - 14, size: 7.5, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: 420, y: jobY - 18, width: 152, height: 14, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, { key: 'insurance.dateOfLoss', value: data.insurance.dateOfLoss, x: 424, y: jobY - 14, size: 7.5, font, color: COLOR_DARK });

  // Time row
  page.drawText('Time Received:', { x: 40, y: jobY - 32, size: 7.5, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: insBoxX, y: jobY - 36, width: 160, height: 14, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, { key: 'insurance.timeReceived', value: data.insurance.timeReceived, x: insBoxX + 4, y: jobY - 32, size: 7.5, font, color: COLOR_DARK });

  page.drawText('Time of Loss:', { x: 340, y: jobY - 32, size: 7.5, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: 420, y: jobY - 36, width: 152, height: 14, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, { key: 'insurance.timeOfLoss', value: data.insurance.timeOfLoss, x: 424, y: jobY - 32, size: 7.5, font, color: COLOR_DARK });

  // Insured Contacted
  page.drawText('Date Insured Contacted:', { x: 40, y: jobY - 50, size: 7.5, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: insBoxX, y: jobY - 54, width: 160, height: 14, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, { key: 'insurance.dateInsuredContacted', value: data.insurance.dateInsuredContacted, x: insBoxX + 4, y: jobY - 50, size: 7.5, font, color: COLOR_DARK });

  page.drawText('Time Insured Contacted:', { x: 40, y: jobY - 68, size: 7.5, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: insBoxX, y: jobY - 72, width: 160, height: 14, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, { key: 'insurance.timeInsuredContacted', value: data.insurance.timeInsuredContacted, x: insBoxX + 4, y: jobY - 68, size: 7.5, font, color: COLOR_DARK });

  page.drawText('Date Inspected:', { x: 40, y: jobY - 86, size: 7.5, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: insBoxX, y: jobY - 90, width: 160, height: 14, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, { key: 'insurance.dateInspected', value: data.insurance.dateInspected, x: insBoxX + 4, y: jobY - 86, size: 7.5, font, color: COLOR_DARK });

  page.drawText('Type of Loss:', { x: 40, y: jobY - 104, size: 7.5, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: insBoxX, y: jobY - 108, width: 160, height: 14, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, { key: 'insurance.typeOfLoss', value: data.insurance.typeOfLoss, x: insBoxX + 4, y: jobY - 104, size: 7.5, font, color: COLOR_DARK });

  page.drawText('Type of Loss Secondary:', { x: 40, y: jobY - 122, size: 7.5, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: insBoxX, y: jobY - 126, width: 160, height: 14, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, { key: 'insurance.typeOfLossSecondary', value: data.insurance.typeOfLossSecondary, x: insBoxX + 4, y: jobY - 122, size: 7.5, font, color: COLOR_DARK });

  // Deductible & Rough Estimate
  page.drawText('Deductible:', { x: 40, y: jobY - 140, size: 7.5, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: insBoxX, y: jobY - 144, width: 160, height: 14, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, { key: 'financials.deductible', value: formatCurrency(data.financials.deductible), x: insBoxX + 4, y: jobY - 140, size: 7.5, font: fontBold, color: COLOR_DARK, bold: true });

  page.drawText('Rough Estimate Amount:', { x: 40, y: jobY - 158, size: 7.5, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: insBoxX, y: jobY - 162, width: 160, height: 14, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawFieldValue(page, { key: 'insurance.roughEstimateAmount', value: formatCurrency(data.insurance.roughEstimateAmount), x: insBoxX + 4, y: jobY - 158, size: 7.5, font, color: COLOR_DARK });

  // Participants Box (Right Side)
  const partBoxX = 345;
  const partBoxY = jobY - 126;
  page.drawRectangle({
    x: partBoxX,
    y: partBoxY,
    width: 227,
    height: 88,
    borderColor: COLOR_DARK,
    borderWidth: 1,
    color: rgb(0.98, 0.98, 0.98),
  });
  page.drawText('Participants', { x: partBoxX + 80, y: partBoxY + 74, size: 9, font: fontBold, color: COLOR_DARK });
  page.drawLine({ start: { x: partBoxX, y: partBoxY + 70 }, end: { x: partBoxX + 227, y: partBoxY + 70 }, thickness: 0.75, color: COLOR_BORDER });

  const drawParticipant = (label: string, value: unknown, fallback: string, key: string, y: number) => {
    page.drawText(label, { x: partBoxX + 8, y, size: 7.5, font, color: COLOR_DARK });
    drawFieldValue(page, {
      key,
      value,
      fallback,
      x: partBoxX + 8 + font.widthOfTextAtSize(label, 7.5),
      y,
      size: 7.5,
      font,
      color: COLOR_DARK,
    });
  };

  drawParticipant('Estimator: ', data.team.estimator, 'Russell Shive', 'team.estimator', partBoxY + 56);
  drawParticipant('Supervisor: ', data.team.supervisor, 'Kenny Belford', 'team.supervisor', partBoxY + 44);
  drawParticipant('Coordinator: ', data.team.coordinator, 'Rhnea Schinbeckler', 'team.coordinator', partBoxY + 32);
  drawParticipant('Foreman: ', data.team.foreman, 'To be determined', 'team.foreman', partBoxY + 20);
  drawParticipant('Marketing Person: ', data.team.marketingPerson, 'Cecilia Rolf', 'team.marketingPerson', partBoxY + 8);
  drawParticipant('Accounting Person: ', data.team.accountingPerson, 'Jami Hillock', 'team.accountingPerson', partBoxY - 4);

  // Loss Description
  const noteY = 260;
  page.drawText('Loss Description:', { x: 40, y: noteY, size: 8, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: 40, y: noteY - 50, width: 532, height: 46, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawWrappedText(page, data.insurance.lossDescription || '', {
    x: 46,
    y: noteY - 14,
    maxWidth: 518,
    lineHeight: 10,
    font,
    size: 7.5,
    maxLines: 4,
    key: 'insurance.lossDescription',
  });
  if (!val(data.insurance.lossDescription)) {
    captureEmptyFieldSpan(page, { key: 'insurance.lossDescription', x: 46, y: noteY - 14, size: 7.5, width: 518 });
  }

  // Special Instructions
  const instY = 195;
  page.drawText('Special Instructions:', { x: 40, y: instY, size: 8, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: 40, y: instY - 40, width: 532, height: 36, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawWrappedText(page, data.insurance.specialInstructions || '', {
    x: 46,
    y: instY - 14,
    maxWidth: 518,
    lineHeight: 10,
    font,
    size: 7.5,
    maxLines: 3,
    key: 'insurance.specialInstructions',
  });
  if (!val(data.insurance.specialInstructions)) {
    captureEmptyFieldSpan(page, { key: 'insurance.specialInstructions', x: 46, y: instY - 14, size: 7.5, width: 518 });
  }

  // Detailed Findings
  const findY = 140;
  page.drawText('Detailed Findings:', { x: 40, y: findY, size: 8, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({ x: 40, y: findY - 50, width: 532, height: 46, borderColor: COLOR_BORDER, borderWidth: 0.75 });
  drawWrappedText(page, data.insurance.detailedFindings || '', {
    x: 46,
    y: findY - 14,
    maxWidth: 518,
    lineHeight: 10,
    font,
    size: 7.5,
    maxLines: 4,
    key: 'insurance.detailedFindings',
  });
  if (!val(data.insurance.detailedFindings)) {
    captureEmptyFieldSpan(page, { key: 'insurance.detailedFindings', x: 46, y: findY - 14, size: 7.5, width: 518 });
  }

  return pdfDoc.save();
}

// -------------------------------------------------------------
// 2. WELCOME LETTER (CUSTOMER REGRETS) GENERATOR
// -------------------------------------------------------------
export async function generateWelcomeLetter(data: RestorationJobData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  drawHeaderLogo(page, fontBold, font, data.branch);

  const curDate = new Date().toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });

  let curY = 690;
  page.drawText(curDate, { x: 50, y: curY, size: 9.5, font, color: COLOR_DARK });

  curY -= 25;
  drawFieldValue(page, { key: 'customer.customerName', value: data.customer.customerName, fallback: 'Valued Customer', x: 50, y: curY, size: 10, font: fontBold, color: COLOR_DARK, bold: true });
  curY -= 14;
  drawFieldValue(page, { key: 'customer.mailingLine', value: data.customer.mailingAddress || data.customer.lossAddress || '', x: 50, y: curY, size: 9.5, font, color: COLOR_DARK });
  curY -= 14;
  drawFieldValue(page, { key: 'customer.mailingLine', value: data.customer.mailingCityStateZip, x: 50, y: curY, size: 9.5, font, color: COLOR_DARK });

  curY -= 18;
  const rePrefix = 'RE: Job # ';
  const reSep = '   |   Claim # ';
  page.drawText(rePrefix, { x: 50, y: curY, size: 8.5, font: fontBold, color: COLOR_RED });
  let reX = 50 + fontBold.widthOfTextAtSize(rePrefix, 8.5);
  drawFieldValue(page, { key: 'customer.jobNumber', value: data.customer.jobNumber, x: reX, y: curY, size: 8.5, font: fontBold, color: COLOR_RED, bold: true });
  reX += fontBold.widthOfTextAtSize(val(data.customer.jobNumber), 8.5);
  page.drawText(reSep, { x: reX, y: curY, size: 8.5, font: fontBold, color: COLOR_RED });
  reX += fontBold.widthOfTextAtSize(reSep, 8.5);
  drawFieldValue(page, { key: 'insurance.claimNumber', value: data.insurance.claimNumber, fallback: 'Pending', x: reX, y: curY, size: 8.5, font: fontBold, color: COLOR_RED, bold: true });

  curY -= 12;
  const propAddrPrefix = 'Property Address: ';
  page.drawText(propAddrPrefix, { x: 50, y: curY, size: 8, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'customer.lossAddress', value: data.customer.lossAddress, x: 50 + font.widthOfTextAtSize(propAddrPrefix, 8), y: curY, size: 8, font, color: COLOR_DARK });

  curY -= 20;
  page.drawText('Dear ', { x: 50, y: curY, size: 10, font: fontBold, color: COLOR_DARK });
  let dearX = 50 + fontBold.widthOfTextAtSize('Dear ', 10);
  drawFieldValue(page, { key: 'customer.customerName', value: data.customer.customerName, fallback: 'Valued Customer', x: dearX, y: curY, size: 10, font: fontBold, color: COLOR_DARK, bold: true });
  dearX += fontBold.widthOfTextAtSize(val(data.customer.customerName, 'Valued Customer'), 10);
  page.drawText(',', { x: dearX, y: curY, size: 10, font: fontBold, color: COLOR_DARK });

  curY -= 22;
  page.drawText('Hays + Sons would like to extend our regrets concerning the recent misfortune to your property. We are', {
    x: 50,
    y: curY,
    size: 8.5,
    font,
    color: COLOR_DARK,
  });
  curY -= 13;
  page.drawText('committed to assisting you throughout the entire process of restoring your property to its pre-loss', {
    x: 50,
    y: curY,
    size: 8.5,
    font,
    color: COLOR_DARK,
  });
  curY -= 13;
  page.drawText('condition. Successful communication is an important factor for any project. Please feel free to contact', {
    x: 50,
    y: curY,
    size: 8.5,
    font,
    color: COLOR_DARK,
  });
  curY -= 13;
  page.drawText('me personally at our office at your convenience ', {
    x: 50,
    y: curY,
    size: 8.5,
    font,
    color: COLOR_DARK,
  });
  // Highlighted email
  page.drawRectangle({
    x: 235,
    y: curY - 2,
    width: 172,
    height: 12,
    color: COLOR_HIGHLIGHT,
  });
  page.drawText(`or via email at ${data.branch.managerEmail}`, {
    x: 237,
    y: curY,
    size: 8.5,
    font: fontBold,
    color: COLOR_DARK,
  });

  curY -= 22;
  page.drawText('Our mission is to provide exceptional service to our customers during their time of need, while sustaining a culture of excellence.', {
    x: 50,
    y: curY,
    size: 8.5,
    font: fontItalic,
    color: COLOR_DARK,
  });

  // PHASE I
  curY -= 26;
  page.drawText('PHASE I - EMERGENCY SERVICES', { x: 180, y: curY, size: 10, font: fontBold, color: COLOR_RED });
  curY -= 13;
  page.drawText('Temporary Board Ups, Water Extractions/Dry Outs', { x: 170, y: curY, size: 8.5, font: fontBold, color: COLOR_RED });

  const phase1Items = [
    'Hays will document loss through photos, sketch, and measurements',
    'Upon successful completion of the emergency services, Hays will send our estimate to your insurance company for approval',
    'Once our estimate is approved by your insurance company, Hays will bill and collect for services provided',
    'Depending on the severity of the loss, Hays may utilize the services of plumbers, electricians, etc. to prevent additional damage',
    'After all necessary equipment is set, Hays will inspect the affected areas on a regular basis until it is determined to be dry',
  ];

  phase1Items.forEach((item) => {
    curY -= 15;
    page.drawText('[X]', { x: 58, y: curY + 1, size: 8, font: fontBold, color: rgb(0.1, 0.6, 0.2) });
    page.drawText(item, { x: 80, y: curY + 1, size: 8, font, color: COLOR_DARK });
  });

  // PHASE II
  curY -= 24;
  page.drawText('PHASE II - STRUCTURAL ESTIMATE', { x: 185, y: curY, size: 10, font: fontBold, color: COLOR_RED });
  curY -= 15;
  page.drawRectangle({ x: 60, y: curY + 1, width: 6, height: 6, color: COLOR_DARK });
  const estPrefix = 'The Structural estimator (';
  const estSuffix = ') will assess the damage and give you an overview of repairs needed.';
  page.drawText(estPrefix, { x: 76, y: curY, size: 8, font, color: COLOR_DARK });
  let estX = 76 + font.widthOfTextAtSize(estPrefix, 8);
  drawFieldValue(page, { key: 'team.estimator', value: data.team.estimator, fallback: 'our estimator', x: estX, y: curY, size: 8, font, color: COLOR_DARK });
  estX += font.widthOfTextAtSize(val(data.team.estimator, 'our estimator'), 8);
  page.drawText(estSuffix, { x: estX, y: curY, size: 8, font, color: COLOR_DARK });
  curY -= 12;
  page.drawText("We'll then write an estimate and submit the estimate for approval to your insurance adjuster for repairs approval.", {
    x: 76,
    y: curY,
    size: 8,
    font,
    color: COLOR_DARK,
  });
  curY -= 12;
  page.drawText("Once approved, we'll have you sign the repair authorization to proceed with putting your job into production.", {
    x: 76,
    y: curY,
    size: 8,
    font,
    color: COLOR_DARK,
  });

  // PHASE III
  curY -= 22;
  page.drawText('PHASE III - PROJECT MANAGER', { x: 190, y: curY, size: 10, font: fontBold, color: COLOR_RED });
  curY -= 15;
  page.drawRectangle({ x: 60, y: curY + 1, width: 6, height: 6, color: COLOR_DARK });
  const pmPrefix = 'Project Manager (';
  const pmSuffix = ') will arrange a pre-construction meeting to review the estimate, collect down payment,';
  page.drawText(pmPrefix, { x: 76, y: curY, size: 8, font, color: COLOR_DARK });
  let pmX = 76 + font.widthOfTextAtSize(pmPrefix, 8);
  drawFieldValue(page, { key: 'team.projectManager', value: data.team.projectManager, fallback: 'our PM', x: pmX, y: curY, size: 8, font, color: COLOR_DARK });
  pmX += font.widthOfTextAtSize(val(data.team.projectManager, 'our PM'), 8);
  page.drawText(pmSuffix, { x: pmX, y: curY, size: 8, font, color: COLOR_DARK });
  curY -= 12;
  page.drawText('obtain any and all selections and discuss the timeline for repairs. We will stay in constant communication throughout.', {
    x: 76,
    y: curY,
    size: 8,
    font,
    color: COLOR_DARK,
  });

  // PHASE IV
  curY -= 22;
  page.drawText('PHASE IV - FINAL WALK THROUGH', { x: 185, y: curY, size: 10, font: fontBold, color: COLOR_RED });
  curY -= 15;
  page.drawRectangle({ x: 60, y: curY + 1, width: 6, height: 6, color: COLOR_DARK });
  page.drawText('Final meeting with Project Manager - review and sign the closing documents, final photos are taken, and final payment is made.', {
    x: 76,
    y: curY,
    size: 8,
    font,
    color: COLOR_DARK,
  });

  // Sign-off
  curY -= 40;
  page.drawText('Sincerely,', { x: 50, y: curY, size: 9, font: fontBold, color: COLOR_DARK });
  curY -= 24;
  page.drawText(`${data.branch.managerName},`, { x: 50, y: curY, size: 9.5, font: fontBold, color: COLOR_DARK });
  curY -= 13;
  page.drawText(`${data.branch.name} - General Manager`, { x: 50, y: curY, size: 8.5, font, color: COLOR_DARK });
  curY -= 13;
  page.drawText(data.branch.managerEmail, { x: 50, y: curY, size: 8.5, font, color: COLOR_DARK });

  return pdfDoc.save();
}

// -------------------------------------------------------------
// 3. MORTGAGE AUTHORIZATION FORM GENERATOR
// -------------------------------------------------------------
export async function generateMortgageAuth(data: RestorationJobData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  drawHeaderLogo(page, fontBold, font, data.branch);

  let curY = 680;
  page.drawText('Mortgage Authorization Form', {
    x: 180,
    y: curY,
    size: 15,
    font: fontBold,
    color: COLOR_DARK,
  });

  curY -= 35;
  const jobIdPrefix = 'Job ID:  ';
  page.drawText(jobIdPrefix, { x: 50, y: curY, size: 9.5, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page, { key: 'customer.jobNumber', value: data.customer.jobNumber, x: 50 + fontBold.widthOfTextAtSize(jobIdPrefix, 9.5), y: curY, size: 9.5, font: fontBold, color: COLOR_DARK, bold: true });
  page.drawLine({ start: { x: 95, y: curY - 2 }, end: { x: 260, y: curY - 2 }, thickness: 0.75, color: COLOR_BORDER });

  curY -= 25;
  const curDate = new Date().toLocaleDateString('en-US');
  page.drawText(`Date:     ${curDate}`, { x: 50, y: curY, size: 9.5, font: fontBold, color: COLOR_DARK });
  page.drawLine({ start: { x: 95, y: curY - 2 }, end: { x: 260, y: curY - 2 }, thickness: 0.75, color: COLOR_BORDER });

  curY -= 35;
  page.drawText('To:', { x: 50, y: curY, size: 9.5, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page, { key: 'mortgage.mortgageCompany', value: data.mortgage.mortgageCompany, fallback: 'Mortgage Company', x: 95, y: curY, size: 9.5, font, color: COLOR_DARK });
  page.drawLine({ start: { x: 95, y: curY - 2 }, end: { x: 550, y: curY - 2 }, thickness: 0.75, color: COLOR_BORDER });

  curY -= 28;
  page.drawText('Regarding:', { x: 50, y: curY, size: 9.5, font: fontBold, color: COLOR_DARK });
  const propOwnerPrefix = 'Property Owner: ';
  page.drawText(propOwnerPrefix, { x: 110, y: curY, size: 9, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'customer.customerName', value: data.customer.customerName, x: 110 + font.widthOfTextAtSize(propOwnerPrefix, 9), y: curY, size: 9, font, color: COLOR_DARK });
  page.drawLine({ start: { x: 110, y: curY - 2 }, end: { x: 550, y: curY - 2 }, thickness: 0.75, color: COLOR_BORDER });

  curY -= 20;
  const addrPrefix = 'Address:           ';
  page.drawText(addrPrefix, { x: 50, y: curY, size: 9, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'customer.lossAddress', value: data.customer.lossAddress, x: 50 + font.widthOfTextAtSize(addrPrefix, 9), y: curY, size: 9, font, color: COLOR_DARK });
  page.drawLine({ start: { x: 110, y: curY - 2 }, end: { x: 550, y: curY - 2 }, thickness: 0.75, color: COLOR_BORDER });

  curY -= 20;
  const insPrefix = 'Insurance:         ';
  const insSep = '   |   Claim #: ';
  page.drawText(insPrefix, { x: 50, y: curY, size: 8.5, font: fontBold, color: COLOR_DARK });
  let insX = 50 + fontBold.widthOfTextAtSize(insPrefix, 8.5);
  drawFieldValue(page, { key: 'insurance.carrier', value: data.insurance.carrier, x: insX, y: curY, size: 8.5, font: fontBold, color: COLOR_DARK, bold: true });
  insX += fontBold.widthOfTextAtSize(val(data.insurance.carrier), 8.5);
  page.drawText(insSep, { x: insX, y: curY, size: 8.5, font: fontBold, color: COLOR_DARK });
  insX += fontBold.widthOfTextAtSize(insSep, 8.5);
  drawFieldValue(page, { key: 'insurance.claimNumber', value: data.insurance.claimNumber, x: insX, y: curY, size: 8.5, font: fontBold, color: COLOR_DARK, bold: true });
  page.drawLine({ start: { x: 110, y: curY - 2 }, end: { x: 550, y: curY - 2 }, thickness: 0.75, color: COLOR_BORDER });

  curY -= 20;
  const isMortgageClaim = data.mortgage.hasMortgage;
  const claimStatusPrefix = 'Claim Status:      [ ';
  const claimStatusSep = ' ] Mortgage / Escrow Claim    [ ';
  const claimStatusSuffix = ' ] Free & Clear (No Lender)';
  page.drawText(claimStatusPrefix, { x: 50, y: curY, size: 8, font: fontBold, color: COLOR_DARK });
  let claimStatusX = 50 + fontBold.widthOfTextAtSize(claimStatusPrefix, 8);
  drawFieldValue(page, { key: 'mortgage.hasMortgage', value: isMortgageClaim ? 'X' : '  ', x: claimStatusX, y: curY, size: 8, font: fontBold, color: COLOR_DARK, bold: true, minWidth: 8 });
  claimStatusX += fontBold.widthOfTextAtSize(isMortgageClaim ? 'X' : '  ', 8);
  page.drawText(claimStatusSep, { x: claimStatusX, y: curY, size: 8, font: fontBold, color: COLOR_DARK });
  claimStatusX += fontBold.widthOfTextAtSize(claimStatusSep, 8);
  drawFieldValue(page, { key: 'mortgage.hasMortgage', value: isMortgageClaim ? '  ' : 'X', x: claimStatusX, y: curY, size: 8, font: fontBold, color: COLOR_DARK, bold: true, minWidth: 8 });
  claimStatusX += fontBold.widthOfTextAtSize(isMortgageClaim ? '  ' : 'X', 8);
  page.drawText(claimStatusSuffix, { x: claimStatusX, y: curY, size: 8, font: fontBold, color: COLOR_DARK });

  curY -= 24;
  page.drawText('Loan#:', { x: 50, y: curY, size: 9.5, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page, { key: 'mortgage.loanNumber', value: data.mortgage.loanNumber, fallback: isMortgageClaim ? 'Pending' : 'N/A - No Mortgage', x: 110, y: curY, size: 9.5, font, color: COLOR_DARK });
  page.drawLine({ start: { x: 110, y: curY - 2 }, end: { x: 300, y: curY - 2 }, thickness: 0.75, color: COLOR_BORDER });

  curY -= 22;
  page.drawText('Mortgage Company Phone #:', { x: 50, y: curY, size: 8.5, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page, { key: 'mortgage.mortgagePhone', value: data.mortgage.mortgagePhone, fallback: isMortgageClaim ? '' : 'N/A', x: 200, y: curY, size: 9, font, color: COLOR_DARK });
  page.drawLine({ start: { x: 200, y: curY - 2 }, end: { x: 550, y: curY - 2 }, thickness: 0.75, color: COLOR_BORDER });

  curY -= 22;
  page.drawText('SSN#:', { x: 50, y: curY, size: 9, font: fontBold, color: COLOR_DARK });
  const ssnPrefix = 'XXX-XX-';
  const ssnSuffix = '   ( last 4 digits only )';
  page.drawText(ssnPrefix, { x: 100, y: curY, size: 9, font, color: COLOR_DARK });
  let ssnX = 100 + font.widthOfTextAtSize(ssnPrefix, 9);
  drawFieldValue(page, { key: 'mortgage.last4Ssn', value: data.mortgage.last4Ssn, fallback: '____', x: ssnX, y: curY, size: 9, font, color: COLOR_DARK });
  ssnX += font.widthOfTextAtSize(val(data.mortgage.last4Ssn, '____'), 9);
  page.drawText(ssnSuffix, { x: ssnX, y: curY, size: 9, font, color: COLOR_DARK });
  page.drawLine({ start: { x: 100, y: curY - 2 }, end: { x: 250, y: curY - 2 }, thickness: 0.75, color: COLOR_BORDER });

  curY -= 22;
  page.drawText('Spouse SSN#:', { x: 50, y: curY, size: 9, font: fontBold, color: COLOR_DARK });
  page.drawText(ssnPrefix, { x: 140, y: curY, size: 9, font, color: COLOR_DARK });
  let spouseSsnX = 140 + font.widthOfTextAtSize(ssnPrefix, 9);
  drawFieldValue(page, { key: 'mortgage.spouseLast4Ssn', value: data.mortgage.spouseLast4Ssn, fallback: '____', x: spouseSsnX, y: curY, size: 9, font, color: COLOR_DARK });
  spouseSsnX += font.widthOfTextAtSize(val(data.mortgage.spouseLast4Ssn, '____'), 9);
  page.drawText(ssnSuffix, { x: spouseSsnX, y: curY, size: 9, font, color: COLOR_DARK });
  page.drawLine({ start: { x: 140, y: curY - 2 }, end: { x: 280, y: curY - 2 }, thickness: 0.75, color: COLOR_BORDER });

  curY -= 30;
  page.drawText(`On behalf of Property Owner, this form is to serve as authorization for Hays + Sons to:`, {
    x: 50,
    y: curY,
    size: 8.5,
    font: fontBold,
    color: COLOR_DARK,
  });

  const bulletPoints = [
    'Be able to communicate with the mortgage company concerning this loss for the life of the claim',
    'Request Inspections',
    'Request checks are made payable to Hays + Sons only and sent to:',
  ];

  bulletPoints.forEach((bp) => {
    curY -= 15;
    page.drawText('-', { x: 70, y: curY, size: 9, font: fontBold, color: COLOR_DARK });
    page.drawText(bp, { x: 85, y: curY, size: 8.5, font, color: COLOR_DARK });
  });

  curY -= 24;
  page.drawText(data.branch.division, { x: 210, y: curY, size: 9.5, font: fontBold, color: COLOR_DARK });
  curY -= 13;
  page.drawText(data.branch.address + ', ' + data.branch.cityStateZip, { x: 185, y: curY, size: 9, font, color: COLOR_DARK });

  // Signature Block
  curY -= 50;
  page.drawLine({ start: { x: 50, y: curY }, end: { x: 300, y: curY }, thickness: 1, color: COLOR_DARK });
  page.drawLine({ start: { x: 360, y: curY }, end: { x: 550, y: curY }, thickness: 1, color: COLOR_DARK });
  page.drawText('Owner/Agent Signature', { x: 50, y: curY - 11, size: 8, font: fontBold, color: COLOR_DARK });
  page.drawText('Date', { x: 360, y: curY - 11, size: 8, font: fontBold, color: COLOR_DARK });
  page.drawText(`Printed: ${data.customer.customerName}`, { x: 50, y: curY - 21, size: 7.5, font, color: COLOR_DARK });

  curY -= 36;
  page.drawLine({ start: { x: 50, y: curY }, end: { x: 300, y: curY }, thickness: 1, color: COLOR_DARK });
  page.drawLine({ start: { x: 360, y: curY }, end: { x: 550, y: curY }, thickness: 1, color: COLOR_DARK });
  page.drawText('Spouse Signature', { x: 50, y: curY - 11, size: 8, font: fontBold, color: COLOR_DARK });
  page.drawText('Date', { x: 360, y: curY - 11, size: 8, font: fontBold, color: COLOR_DARK });

  curY -= 36;
  page.drawLine({ start: { x: 50, y: curY }, end: { x: 300, y: curY }, thickness: 1, color: COLOR_DARK });
  page.drawLine({ start: { x: 360, y: curY }, end: { x: 550, y: curY }, thickness: 1, color: COLOR_DARK });
  page.drawText('Hays + Sons Representative Signature', { x: 50, y: curY - 11, size: 8, font: fontBold, color: COLOR_DARK });
  page.drawText('Date', { x: 360, y: curY - 11, size: 8, font: fontBold, color: COLOR_DARK });
  page.drawText(`Printed: ${data.branch.managerName}`, { x: 50, y: curY - 21, size: 7.5, font, color: COLOR_DARK });

  return pdfDoc.save();
}

// -------------------------------------------------------------
// 4. STRUCTURAL REPAIR AGREEMENT (INDIANA) - 2 PAGES
// -------------------------------------------------------------
export async function generateContract(data: RestorationJobData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // ===================== PAGE 1 =====================
  const page1 = pdfDoc.addPage([612, 792]);
  drawHeaderLogo(page1, fontBold, font, data.branch);

  let y = 688;
  page1.drawText('Structural Repair Agreement (Indiana)', {
    x: 175,
    y,
    size: 13,
    font: fontBold,
    color: COLOR_DARK,
  });

  y -= 22;
  page1.drawText(
    'This is to authorize Hays and Sons Complete Restoration to proceed with necessary professional services at',
    { x: 50, y, size: 8.5, font: fontBold, color: COLOR_DARK }
  );

  // Owner, address, contact block
  y -= 20;
  page1.drawText('Owner / Name of property:', { x: 50, y, size: 8, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page1, { key: 'customer.customerName', value: data.customer.customerName, x: 170, y, size: 8.5, font, color: COLOR_DARK });
  page1.drawLine({ start: { x: 165, y: y - 2 }, end: { x: 550, y: y - 2 }, thickness: 0.75, color: COLOR_BORDER });

  y -= 18;
  page1.drawText('Address:', { x: 50, y, size: 8, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page1, { key: 'customer.lossAddress', value: data.customer.lossAddress, x: 100, y, size: 8.5, font, color: COLOR_DARK });
  page1.drawLine({ start: { x: 95, y: y - 2 }, end: { x: 550, y: y - 2 }, thickness: 0.75, color: COLOR_BORDER });

  y -= 18;
  page1.drawText('City / Zip:', { x: 50, y, size: 8, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page1, { key: 'customer.mailingCityStateZip', value: data.customer.mailingCityStateZip, x: 100, y, size: 8.5, font, color: COLOR_DARK });
  page1.drawLine({ start: { x: 95, y: y - 2 }, end: { x: 300, y: y - 2 }, thickness: 0.75, color: COLOR_BORDER });

  page1.drawText('Phone:', { x: 320, y, size: 8, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page1, { key: 'customer.phoneLine', value: data.customer.mobilePhone || data.customer.mainPhone, x: 360, y, size: 8.5, font, color: COLOR_DARK });
  page1.drawLine({ start: { x: 355, y: y - 2 }, end: { x: 550, y: y - 2 }, thickness: 0.75, color: COLOR_BORDER });

  y -= 18;
  page1.drawText(`Date Submitted:   ${new Date().toLocaleDateString('en-US')}`, {
    x: 50,
    y,
    size: 8,
    font: fontBold,
    color: COLOR_DARK,
  });
  const jobPrefix = 'Job #: ';
  page1.drawText(jobPrefix, { x: 220, y, size: 8, font: fontBold, color: COLOR_RED });
  drawFieldValue(page1, { key: 'customer.jobNumber', value: data.customer.jobNumber, x: 220 + fontBold.widthOfTextAtSize(jobPrefix, 8), y, size: 8, font: fontBold, color: COLOR_RED, bold: true });
  const emailPrefix = 'Email: ';
  page1.drawText(emailPrefix, { x: 340, y, size: 8, font, color: COLOR_DARK });
  drawFieldValue(page1, { key: 'customer.email', value: data.customer.email, x: 340 + font.widthOfTextAtSize(emailPrefix, 8), y, size: 8, font, color: COLOR_DARK });

  y -= 15;
  const contractInsPrefix = 'Insurance: ';
  const contractInsSep1 = '   |   Claim #: ';
  const contractInsSep2 = '   |   Policy #: ';
  page1.drawText(contractInsPrefix, { x: 50, y, size: 7.5, font: fontBold, color: COLOR_DARK });
  let contractInsX = 50 + fontBold.widthOfTextAtSize(contractInsPrefix, 7.5);
  drawFieldValue(page1, { key: 'insurance.carrier', value: data.insurance.carrier, x: contractInsX, y, size: 7.5, font: fontBold, color: COLOR_DARK, bold: true });
  contractInsX += fontBold.widthOfTextAtSize(val(data.insurance.carrier), 7.5);
  page1.drawText(contractInsSep1, { x: contractInsX, y, size: 7.5, font: fontBold, color: COLOR_DARK });
  contractInsX += fontBold.widthOfTextAtSize(contractInsSep1, 7.5);
  drawFieldValue(page1, { key: 'insurance.claimNumber', value: data.insurance.claimNumber, x: contractInsX, y, size: 7.5, font: fontBold, color: COLOR_DARK, bold: true });
  contractInsX += fontBold.widthOfTextAtSize(val(data.insurance.claimNumber), 7.5);
  page1.drawText(contractInsSep2, { x: contractInsX, y, size: 7.5, font: fontBold, color: COLOR_DARK });
  contractInsX += fontBold.widthOfTextAtSize(contractInsSep2, 7.5);
  drawFieldValue(page1, { key: 'insurance.policyNumber', value: data.insurance.policyNumber, x: contractInsX, y, size: 7.5, font: fontBold, color: COLOR_DARK, bold: true });

  // Terms and Conditions header
  y -= 18;
  page1.drawText('Terms and Conditions:', { x: 245, y, size: 9, font: fontBold, color: COLOR_DARK });

  const terms = [
    '* I authorize Hays & Sons Complete Restoration to perform necessary emergency services and/or repairs.',
    '* As the owner of the property or as an agent with authority to bind the owner of the property, I am responsible to pay Hays & Sons for emergency and/or restoration services ("Services") rendered even though I may have insurance that covers all or part of the Services.',
    '* Hays & Sons shall not be liable for damage caused by the event necessitating the Services. Hays & Sons will only be responsible for subsequent damage to the structure and contents of the property that may arise as a result of performing the Services in a negligent manner.',
    '* Limited Power of Attorney: Hays and Sons Complete Restoration is hereby appointed as attorney in fact only to endorse and deposit in its account any insurance company checks or drafts to said work. This power coupled with an interest is given as security for the payment of services rendered by Hays and Sons Complete Restoration hereunder.',
    '* Owner hereby authorizes the insurance company to issue payment directly to Hays and Sons Complete Restoration on any check or draft issued in honor of said claim.',
  ];

  const TERM_MAX_W = CONTENT_RIGHT - 50 - 10; // stay clear of the right margin
  terms.forEach((term) => {
    y -= 22;
    const lines = wrapLines(font, term, 7.2, TERM_MAX_W);
    y = drawLines(page1, lines, {
      x: 50,
      indentX: 62,
      y,
      lineHeight: 10,
      size: 7.2,
      font,
    });
  });

  // Commencement Timeline clause with Highlight
  y -= 22;
  page1.drawText('* Project will begin within', { x: 50, y, size: 7.5, font, color: COLOR_DARK });
  page1.drawRectangle({ x: 155, y: y - 2, width: 30, height: 11, color: COLOR_HIGHLIGHT });
  drawFieldValue(page1, { key: 'financials.commenceDays', value: data.financials.commenceDays, x: 160 + fontBold.widthOfTextAtSize(' ', 8), y, size: 8, font: fontBold, color: COLOR_DARK, bold: true });
  page1.drawText('days of the last to occur of the following (the "Commencement Date"):', {
    x: 190,
    y,
    size: 7.5,
    font,
    color: COLOR_DARK,
  });

  y -= 11;
  page1.drawText('   o insurance company\'s approval of estimate;   o Hays & Sons\' receipt of selections;', {
    x: 65,
    y,
    size: 7,
    font,
    color: COLOR_DARK,
  });
  y -= 10;
  page1.drawText('   o Hays & Sons\' receipt of Down Payment;        o building authority\'s issuance of permits.', {
    x: 65,
    y,
    size: 7,
    font,
    color: COLOR_DARK,
  });

  // Completion Timeline clause with Highlight
  y -= 16;
  page1.drawText('* Project will be completed within', { x: 50, y, size: 7.5, font, color: COLOR_DARK });
  page1.drawRectangle({ x: 178, y: y - 2, width: 30, height: 11, color: COLOR_HIGHLIGHT });
  drawFieldValue(page1, { key: 'financials.completeDays', value: data.financials.completeDays, x: 183 + fontBold.widthOfTextAtSize(' ', 8), y, size: 8, font: fontBold, color: COLOR_DARK, bold: true });
  page1.drawText('days of the Commencement Date. See below for contingencies that may extend.', {
    x: 213,
    y,
    size: 7.5,
    font,
    color: COLOR_DARK,
  });

  y -= 16;
  const ackLines = wrapLines(
    font,
    '* I acknowledge that I have the right to cancel this Agreement within three (3) days from the signature date below and that I have received a "Notice of Cancellation" form from Hays & Sons.',
    7,
    CONTENT_RIGHT - 50
  );
  y = drawLines(page1, ackLines, {
    x: 50,
    indentX: 58,
    y,
    lineHeight: 9.5,
    size: 7,
    font,
  });

  // Payment Agreement with INITIAL boxes
  y -= 26;
  page1.drawText('Payment Agreement:', { x: 250, y, size: 9, font: fontBold, color: COLOR_DARK });

  // Clause 1: RCV
  y -= 22;
  page1.drawRectangle({ x: 50, y: y - 4, width: 34, height: 16, color: COLOR_HIGHLIGHT, borderColor: COLOR_DARK, borderWidth: 0.75 });
  page1.drawText('Initial', { x: 57, y: y + 1, size: 7.5, font: fontBold, color: COLOR_DARK });

  page1.drawText('The total amount of the contract/repairs will be', { x: 92, y, size: 7.5, font, color: COLOR_DARK });
  drawFieldValue(page1, { key: 'financials.totalApprovedRcv', value: formatCurrency(data.financials.totalApprovedRcv), x: 275 + fontBold.widthOfTextAtSize(' ', 8), y, size: 8, font: fontBold, color: COLOR_RED, bold: true });
  page1.drawLine({ start: { x: 270, y: y - 2 }, end: { x: 340, y: y - 2 }, thickness: 0.75, color: COLOR_DARK });
  page1.drawText('per the approved estimate', { x: 345, y, size: 7.5, font, color: COLOR_DARK });
  // Cyan highlight for plus all supplements
  page1.drawRectangle({ x: 440, y: y - 2, width: 120, height: 11, color: COLOR_CYAN });
  page1.drawText('plus all supplements at RCV', { x: 442, y, size: 7.5, font: fontBold, color: COLOR_DARK });

  // Clause 2: Detailed estimate
  y -= 22;
  page1.drawRectangle({ x: 50, y: y - 4, width: 34, height: 16, color: COLOR_HIGHLIGHT, borderColor: COLOR_DARK, borderWidth: 0.75 });
  page1.drawText('Initial', { x: 57, y: y + 1, size: 7.5, font: fontBold, color: COLOR_DARK });
  page1.drawText('A detailed estimate will be provided to the owner of the property for approval and sign off before work begins.', {
    x: 92,
    y,
    size: 7.5,
    font,
    color: COLOR_DARK,
  });

  // Clause 3: Insurance net and Deductible
  y -= 22;
  page1.drawRectangle({ x: 50, y: y - 4, width: 34, height: 16, color: COLOR_HIGHLIGHT, borderColor: COLOR_DARK, borderWidth: 0.75 });
  page1.drawText('Initial', { x: 57, y: y + 1, size: 7.5, font: fontBold, color: COLOR_DARK });
  page1.drawText(`${formatCurrency(data.financials.netClaimValue)}`, { x: 92, y, size: 8, font: fontBold, color: COLOR_DARK });
  page1.drawLine({ start: { x: 92, y: y - 2 }, end: { x: 155, y: y - 2 }, thickness: 0.75, color: COLOR_DARK });
  page1.drawText('will be paid by your insurance company;', { x: 160, y, size: 7.5, font, color: COLOR_DARK });
  drawFieldValue(page1, { key: 'financials.deductible', value: formatCurrency(data.financials.deductible), x: 320, y, size: 8, font: fontBold, color: COLOR_DARK, bold: true });
  page1.drawLine({ start: { x: 320, y: y - 2 }, end: { x: 380, y: y - 2 }, thickness: 0.75, color: COLOR_DARK });
  page1.drawText('is the amount of your deductible.', { x: 385, y, size: 7.5, font, color: COLOR_DARK });

  // Payment Schedule
  y -= 24;
  page1.drawText('Payment Schedule:', { x: 255, y, size: 9, font: fontBold, color: COLOR_DARK });

  y -= 18;
  page1.drawText(`${formatCurrency(data.financials.downPayment)}`, { x: 50, y, size: 8, font: fontBold, color: COLOR_DARK });
  page1.drawLine({ start: { x: 50, y: y - 2 }, end: { x: 110, y: y - 2 }, thickness: 0.75, color: COLOR_DARK });
  page1.drawText('will be required as down payment to start repair process, which represents 50% of the total estimate.', {
    x: 115,
    y,
    size: 7.5,
    font,
    color: COLOR_DARK,
  });

  y -= 18;
  page1.drawText(`${formatCurrency(data.financials.midProgressPayment)}`, { x: 50, y, size: 8, font: fontBold, color: COLOR_DARK });
  page1.drawLine({ start: { x: 50, y: y - 2 }, end: { x: 110, y: y - 2 }, thickness: 0.75, color: COLOR_DARK });
  page1.drawText('will be required when 50% of the scope has been completed, which represents 25% of the total estimate.', {
    x: 115,
    y,
    size: 7.5,
    font,
    color: COLOR_DARK,
  });

  y -= 18;
  page1.drawText('Any change orders will be due upon approval.', { x: 50, y, size: 7.5, font: fontBold, color: COLOR_DARK });

  y -= 16;
  page1.drawText(`Balance (${formatCurrency(data.financials.balancePayment)}) will be required upon substantial completion of the scope.`, {
    x: 50,
    y,
    size: 7.5,
    font: fontBold,
    color: COLOR_DARK,
  });

  // ===================== PAGE 2 =====================
  const page2 = pdfDoc.addPage([612, 792]);
  page2.drawText(`Job #: ${data.customer.jobNumber}   |   Customer: ${data.customer.customerName}   |   Page 2 of 2`, {
    x: 50,
    y: 752,
    size: 7.5,
    font: fontBold,
    color: COLOR_GRAY,
  });

  let y2 = 740;

  const legalClauses = [
    '- A finance charge of 1.5% per month will be added to any unpaid balance over 30 days past due, an annual % rate of 18%. To the extent that payment to Hays and Sons by the OWNER has been delayed pending payment by the OWNER\'S insurance company, Hays and Sons shall waive finance charges only for the period of delay caused by insurance.',
    '- In the event that any party initiates litigation against the other relating to this Agreement or the Project, upon prevailing, Hays and Sons shall be entitled to recover, as part of any judgment, its costs incurred in litigation, including reasonable attorney\'s fees.',
    '- The CONTRACTOR reserves the right to STOP WORK if the OWNER fails to timely pay any amount due.',
    '- Neither Hays & Sons nor its suppliers or subcontractors may initiate or pursue a claim with your insurance company.',
  ];

  const CLAUSE_MAX_W = CONTENT_RIGHT - 50 - 10;
  legalClauses.forEach((clause) => {
    const lines = wrapLines(font, clause, 7.5, CLAUSE_MAX_W);
    y2 = drawLines(page2, lines, {
      x: 50,
      indentX: 58,
      y: y2,
      lineHeight: 11,
      size: 7.5,
      font,
    });
    y2 -= 16;
  });

  y2 -= 15;
  page2.drawText('Adjuster/Agent:', { x: 50, y: y2, size: 8, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page2, { key: 'insurance.primaryAdjuster', value: data.insurance.primaryAdjuster, x: 130, y: y2, size: 8, font, color: COLOR_DARK });
  page2.drawLine({ start: { x: 125, y: y2 - 2 }, end: { x: 300, y: y2 - 2 }, thickness: 0.75, color: COLOR_BORDER });

  page2.drawText('Claim #:', { x: 330, y: y2, size: 8, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page2, { key: 'insurance.claimNumber', value: data.insurance.claimNumber, x: 375, y: y2, size: 8, font, color: COLOR_DARK });
  page2.drawLine({ start: { x: 370, y: y2 - 2 }, end: { x: 550, y: y2 - 2 }, thickness: 0.75, color: COLOR_BORDER });

  y2 -= 18;
  page2.drawText('Insurance Company:', { x: 50, y: y2, size: 8, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page2, { key: 'insurance.carrier', value: data.insurance.carrier, x: 145, y: y2, size: 8, font, color: COLOR_DARK });
  page2.drawLine({ start: { x: 140, y: y2 - 2 }, end: { x: 300, y: y2 - 2 }, thickness: 0.75, color: COLOR_BORDER });

  page2.drawText('Policy #:', { x: 330, y: y2, size: 8, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page2, { key: 'insurance.policyNumber', value: data.insurance.policyNumber, x: 375, y: y2, size: 8, font, color: COLOR_DARK });
  page2.drawLine({ start: { x: 370, y: y2 - 2 }, end: { x: 550, y: y2 - 2 }, thickness: 0.75, color: COLOR_BORDER });

  y2 -= 18;
  page2.drawText('Estimator:', { x: 50, y: y2, size: 8, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page2, { key: 'team.estimator', value: data.team.estimator, x: 110, y: y2, size: 8, font, color: COLOR_DARK });
  page2.drawLine({ start: { x: 105, y: y2 - 2 }, end: { x: 300, y: y2 - 2 }, thickness: 0.75, color: COLOR_BORDER });

  page2.drawText('Project Manager:', { x: 330, y: y2, size: 8, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page2, { key: 'team.projectManager', value: data.team.projectManager, x: 415, y: y2, size: 8, font, color: COLOR_DARK });
  page2.drawLine({ start: { x: 410, y: y2 - 2 }, end: { x: 550, y: y2 - 2 }, thickness: 0.75, color: COLOR_BORDER });

  // Signatures on Page 2
  y2 -= 32;
  page2.drawLine({ start: { x: 50, y: y2 }, end: { x: 300, y: y2 }, thickness: 1, color: COLOR_DARK });
  page2.drawLine({ start: { x: 360, y: y2 }, end: { x: 550, y: y2 }, thickness: 1, color: COLOR_DARK });
  page2.drawText('Owner/Agents Signature', { x: 50, y: y2 - 11, size: 8, font: fontBold, color: COLOR_DARK });
  page2.drawText('Date', { x: 360, y: y2 - 11, size: 8, font: fontBold, color: COLOR_DARK });
  page2.drawText(`Printed: ${data.customer.customerName}`, { x: 50, y: y2 - 20, size: 7.5, font, color: COLOR_DARK });

  y2 -= 30;
  page2.drawLine({ start: { x: 50, y: y2 }, end: { x: 300, y: y2 }, thickness: 1, color: COLOR_DARK });
  page2.drawLine({ start: { x: 360, y: y2 }, end: { x: 550, y: y2 }, thickness: 1, color: COLOR_DARK });
  page2.drawText('Owner/Agents Signature', { x: 50, y: y2 - 11, size: 8, font: fontBold, color: COLOR_DARK });
  page2.drawText('Date', { x: 360, y: y2 - 11, size: 8, font: fontBold, color: COLOR_DARK });

  y2 -= 30;
  page2.drawLine({ start: { x: 50, y: y2 }, end: { x: 300, y: y2 }, thickness: 1, color: COLOR_DARK });
  page2.drawLine({ start: { x: 360, y: y2 }, end: { x: 550, y: y2 }, thickness: 1, color: COLOR_DARK });
  page2.drawText('Hays & Sons Authorization', { x: 50, y: y2 - 11, size: 8, font: fontBold, color: COLOR_DARK });
  page2.drawText('Date', { x: 360, y: y2 - 11, size: 8, font: fontBold, color: COLOR_DARK });

  y2 -= 25;
  page2.drawText(`Hays & Sons Printed Name:  ${data.branch.managerName}`, { x: 50, y: y2, size: 8, font: fontBold, color: COLOR_DARK });

  y2 -= 20;
  page2.drawText(`Phone Number: ${data.branch.phone}`, { x: 50, y: y2, size: 8, font, color: COLOR_DARK });
  page2.drawText(`Email address: ${data.branch.managerEmail}`, { x: 330, y: y2, size: 8, font, color: COLOR_DARK });

  y2 -= 35;
  page2.drawText(`Questions or Concerns? Call ${data.branch.phone} and ask to speak to ${data.branch.managerName}.`, {
    x: 50,
    y: y2,
    size: 8,
    font: fontBold,
    color: COLOR_DARK,
  });

  y2 -= 16;
  page2.drawText('Hays & Sons will use suppliers to provide materials and subcontractors to perform the work on your Project.', {
    x: 50,
    y: y2,
    size: 7.5,
    font,
    color: COLOR_DARK,
  });

  y2 -= 14;
  page2.drawText(
    'The completion date may be extended due to causes beyond Hays & Sons control, such as acts of God, weather, delays in inspections by the',
    { x: 50, y: y2, size: 7, font: fontItalic, color: COLOR_GRAY }
  );
  y2 -= 10;
  page2.drawText(
    "building authorities, delays by Owner's insurance company in approving changes in work, supply chain disruptions, and unforeseen conditions.",
    { x: 50, y: y2, size: 7, font: fontItalic, color: COLOR_GRAY }
  );

  y2 -= 25;
  page2.drawText('4889-6528-0746, v. 2', { x: 50, y: y2, size: 7, font, color: COLOR_GRAY });

  return pdfDoc.save();
}

// -------------------------------------------------------------
// 5. NOTICE OF CANCELLATION GENERATOR
// -------------------------------------------------------------
export async function generateCancellationNotice(data: RestorationJobData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = 740;
  page.drawText('HAYS & SONS CONSTRUCTION, INC.', { x: 185, y, size: 12, font: fontBold, color: COLOR_DARK });

  y -= 16;
  page.drawRectangle({ x: 165, y: y - 2, width: 260, height: 14, color: COLOR_HIGHLIGHT });
  page.drawText(`${data.branch.address} ${data.branch.cityStateZip}`, { x: 170, y, size: 9, font: fontBold, color: COLOR_DARK });

  y -= 14;
  page.drawRectangle({ x: 220, y: y - 2, width: 150, height: 14, color: COLOR_HIGHLIGHT });
  page.drawText(`Phone: ${data.branch.phone}`, { x: 235, y, size: 9, font: fontBold, color: COLOR_DARK });

  y -= 32;
  page.drawText('NOTICE OF CANCELLATION', { x: 215, y, size: 12, font: fontBold, color: COLOR_DARK });

  y -= 18;
  const jobPrefix = 'Job #: ';
  const jobSep = '   |   Customer: ';
  page.drawText(jobPrefix, { x: 50, y, size: 8.5, font: fontBold, color: COLOR_RED });
  let jobX = 50 + fontBold.widthOfTextAtSize(jobPrefix, 8.5);
  drawFieldValue(page, { key: 'customer.jobNumber', value: data.customer.jobNumber, x: jobX, y, size: 8.5, font: fontBold, color: COLOR_RED, bold: true });
  jobX += fontBold.widthOfTextAtSize(val(data.customer.jobNumber), 8.5);
  page.drawText(jobSep, { x: jobX, y, size: 8.5, font: fontBold, color: COLOR_RED });
  jobX += fontBold.widthOfTextAtSize(jobSep, 8.5);
  drawFieldValue(page, { key: 'customer.customerName', value: data.customer.customerName, x: jobX, y, size: 8.5, font: fontBold, color: COLOR_RED, bold: true });
  const agreementPrefix = 'Agreement Date: ';
  page.drawText(agreementPrefix, { x: 370, y, size: 8, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page, { key: 'insurance.dateReceived', value: data.insurance.dateReceived, fallback: new Date().toLocaleDateString('en-US'), x: 370 + fontBold.widthOfTextAtSize(agreementPrefix, 8), y, size: 8, font: fontBold, color: COLOR_DARK, bold: true });
  y -= 13;
  const propPrefix = 'Property Address: ';
  page.drawText(propPrefix, { x: 50, y, size: 8, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'customer.lossAddress', value: data.customer.lossAddress, x: 50 + font.widthOfTextAtSize(propPrefix, 8), y, size: 8, font, color: COLOR_DARK });

  y -= 20;
  page.drawText('You, the OWNER, may cancel this AGREEMENT by mailing, delivering, or submitting by electronic mail a signed and', {
    x: 50,
    y,
    size: 8,
    font,
    color: COLOR_DARK,
  });
  y -= 12;
  page.drawText(`dated copy of this cancellation notice to the CONTRACTOR, Hays & Sons Construction, Inc., at ${data.branch.address},`, {
    x: 50,
    y,
    size: 8,
    font,
    color: COLOR_DARK,
  });
  y -= 12;
  page.drawText(`${data.branch.cityStateZip}, or ${data.branch.managerEmail}, at any time before midnight on the third business day after the later of:`, {
    x: 50,
    y,
    size: 8,
    font,
    color: COLOR_DARK,
  });

  y -= 18;
  page.drawText('(A) The date of this AGREEMENT is signed by you and the CONTRACTOR, Hays & Sons Construction, Inc.', {
    x: 75,
    y,
    size: 8,
    font: fontBold,
    color: COLOR_DARK,
  });
  y -= 14;
  page.drawText('(B) If applicable, the date you receive written notification from your insurance company of a final determination', {
    x: 75,
    y,
    size: 8,
    font: fontBold,
    color: COLOR_DARK,
  });
  y -= 11;
  page.drawText('as to whether all or any part of your claim or this AGREEMENT is a covered loss under your policy.', {
    x: 90,
    y,
    size: 8,
    font: fontBold,
    color: COLOR_DARK,
  });

  y -= 20;
  page.drawText('If you cancel this AGREEMENT, any payment made by you under the AGREEMENT will be returned within ten (10)', {
    x: 50,
    y,
    size: 8,
    font,
    color: COLOR_DARK,
  });
  y -= 12;
  page.drawText('business days following receipt by the CONTRACTOR of your cancellation notice, minus any amounts you may owe for work', {
    x: 50,
    y,
    size: 8,
    font,
    color: COLOR_DARK,
  });
  y -= 12;
  page.drawText('already done by the CONTRACTOR, Hays & Sons Construction, Inc.', {
    x: 50,
    y,
    size: 8,
    font,
    color: COLOR_DARK,
  });

  y -= 20;
  page.drawText('If you cancel, you must make available to CONTRACTOR, at your property and in substantially as good condition as when', {
    x: 50,
    y,
    size: 8,
    font,
    color: COLOR_DARK,
  });
  y -= 12;
  page.drawText('received, any goods delivered to you under this contract of sale; or you may comply with instructions of CONTRACTOR regarding return shipment.', {
    x: 50,
    y,
    size: 8,
    font,
    color: COLOR_DARK,
  });

  y -= 25;
  page.drawText('*************************************', { x: 200, y, size: 10, font: fontBold, color: COLOR_DARK });

  y -= 25;
  page.drawText('I HEREBY CANCEL THIS AGREEMENT.', { x: 50, y, size: 9, font: fontBold, color: COLOR_DARK });

  y -= 45;
  page.drawText('Owner\'s Signature: ____________________________________', { x: 50, y, size: 8.5, font, color: COLOR_DARK });
  page.drawText('Date: ________________', { x: 400, y, size: 8.5, font, color: COLOR_DARK });

  y -= 30;
  page.drawText(`Printed Name:        ${data.customer.customerName}`, { x: 50, y, size: 8.5, font: fontBold, color: COLOR_DARK });

  return pdfDoc.save();
}

// -------------------------------------------------------------
// 6. CHANGE ORDER / ADDENDUM GENERATOR
// -------------------------------------------------------------
export async function generateChangeOrder(data: RestorationJobData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  drawHeaderLogo(page, fontBold, font, data.branch);

  let y = 680;
  page.drawText('Change Order / Addendum', { x: 210, y, size: 14, font: fontBold, color: COLOR_DARK });

  y -= 26;
  page.drawText('Project Owner:', { x: 50, y, size: 8.5, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page, { key: 'customer.customerName', value: data.customer.customerName, x: 125, y, size: 8.5, font, color: COLOR_DARK });
  page.drawLine({ start: { x: 120, y: y - 2 }, end: { x: 300, y: y - 2 }, thickness: 0.75, color: COLOR_BORDER });

  page.drawText('Change Order Number:', { x: 330, y, size: 8.5, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page, { key: 'changeOrder.changeOrderNumber', value: data.changeOrder.changeOrderNumber, fallback: 'CO-01', x: 440, y, size: 8.5, font, color: COLOR_DARK });
  page.drawLine({ start: { x: 435, y: y - 2 }, end: { x: 550, y: y - 2 }, thickness: 0.75, color: COLOR_BORDER });

  y -= 18;
  page.drawText('Job Number:', { x: 50, y, size: 8.5, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page, { key: 'customer.jobNumber', value: data.customer.jobNumber, x: 125, y, size: 8.5, font: fontBold, color: COLOR_RED, bold: true });
  page.drawLine({ start: { x: 120, y: y - 2 }, end: { x: 300, y: y - 2 }, thickness: 0.75, color: COLOR_BORDER });

  page.drawText('Change Order Date:', { x: 330, y, size: 8.5, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page, { key: 'changeOrder.changeOrderDate', value: data.changeOrder.changeOrderDate, fallback: new Date().toLocaleDateString('en-US'), x: 440, y, size: 8.5, font, color: COLOR_DARK });
  page.drawLine({ start: { x: 435, y: y - 2 }, end: { x: 550, y: y - 2 }, thickness: 0.75, color: COLOR_BORDER });

  y -= 18;
  page.drawText('Property Address:', { x: 50, y, size: 8.5, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page, { key: 'customer.lossAddress', value: data.customer.lossAddress, x: 135, y, size: 8, font, color: COLOR_DARK });
  page.drawLine({ start: { x: 130, y: y - 2 }, end: { x: 550, y: y - 2 }, thickness: 0.75, color: COLOR_BORDER });

  y -= 18;
  const coInsPrefix = 'Insurance: ';
  const coInsSep = '  |  Claim #: ';
  page.drawText(coInsPrefix, { x: 50, y, size: 8, font: fontBold, color: COLOR_DARK });
  let coInsX = 50 + fontBold.widthOfTextAtSize(coInsPrefix, 8);
  drawFieldValue(page, { key: 'insurance.carrier', value: data.insurance.carrier, x: coInsX, y, size: 8, font: fontBold, color: COLOR_DARK, bold: true });
  coInsX += fontBold.widthOfTextAtSize(val(data.insurance.carrier), 8);
  page.drawText(coInsSep, { x: coInsX, y, size: 8, font: fontBold, color: COLOR_DARK });
  coInsX += fontBold.widthOfTextAtSize(coInsSep, 8);
  drawFieldValue(page, { key: 'insurance.claimNumber', value: data.insurance.claimNumber, x: coInsX, y, size: 8, font: fontBold, color: COLOR_DARK, bold: true });
  const isIns = data.changeOrder.isInsuranceRelated;
  page.drawText('[ ', { x: 330, y, size: 8.5, font: fontBold, color: COLOR_DARK });
  let insRelX = 330 + fontBold.widthOfTextAtSize('[ ', 8.5);
  drawFieldValue(page, { key: 'changeOrder.isInsuranceRelated', value: isIns ? 'X' : '  ', x: insRelX, y, size: 8.5, font: fontBold, color: COLOR_DARK, bold: true, minWidth: 8 });
  insRelX += fontBold.widthOfTextAtSize(isIns ? 'X' : '  ', 8.5);
  page.drawText(' ] Insurance Related', { x: insRelX, y, size: 8.5, font: fontBold, color: COLOR_DARK });

  page.drawText('[ ', { x: 435, y, size: 8.5, font: fontBold, color: COLOR_DARK });
  let nonInsX = 435 + fontBold.widthOfTextAtSize('[ ', 8.5);
  drawFieldValue(page, { key: 'changeOrder.isInsuranceRelated', value: isIns ? '  ' : 'X', x: nonInsX, y, size: 8.5, font: fontBold, color: COLOR_DARK, bold: true, minWidth: 8 });
  nonInsX += fontBold.widthOfTextAtSize(isIns ? '  ' : 'X', 8.5);
  page.drawText(' ] Non Insurance Related*', { x: nonInsX, y, size: 8.5, font: fontBold, color: COLOR_DARK });

  // Big Scope Box with Yellow Header
  y -= 25;
  page.drawRectangle({ x: 50, y: y - 18, width: 500, height: 18, color: COLOR_HIGHLIGHT, borderColor: COLOR_DARK, borderWidth: 1 });
  page.drawText('This contract is changed as follows:', { x: 215, y: y - 13, size: 9, font: fontBold, color: COLOR_DARK });

  page.drawRectangle({ x: 50, y: y - 160, width: 500, height: 142, borderColor: COLOR_DARK, borderWidth: 1, color: rgb(1, 1, 1) });
  drawWrappedText(page, data.changeOrder.scopeDescription || '', {
    x: 60,
    y: y - 35,
    maxWidth: 480,
    lineHeight: 13,
    font,
    size: 8.5,
    maxLines: 9,
    key: 'changeOrder.scopeDescription',
  });
  if (!val(data.changeOrder.scopeDescription)) {
    captureEmptyFieldSpan(page, { key: 'changeOrder.scopeDescription', x: 60, y: y - 35, size: 8.5, width: 480 });
  }

  // Warning Banner
  y -= 175;
  page.drawRectangle({ x: 50, y: y - 30, width: 500, height: 30, color: COLOR_HIGHLIGHT, borderColor: COLOR_DARK, borderWidth: 1 });
  page.drawText('*Non-Insurance changes require 100% of the Change Order to be paid before work is started.', {
    x: 75,
    y: y - 14,
    size: 7.5,
    font: fontBold,
    color: COLOR_DARK,
  });
  page.drawText('Not valid until signed by owner and contractor and paid in full for non-insured work.', {
    x: 85,
    y: y - 24,
    size: 7.5,
    font: fontBold,
    color: COLOR_DARK,
  });

  // Financial Lines
  y -= 45;
  page.drawText('The original contract sum was: ............................................................................', { x: 50, y, size: 8, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'changeOrder.originalContractSum', value: formatCurrency(data.changeOrder.originalContractSum || data.financials.totalApprovedRcv), x: 450, y, size: 8, font: fontBold, color: COLOR_DARK, bold: true });

  y -= 18;
  page.drawText('Net changes by previous authorized change orders: ...................................................', { x: 50, y, size: 8, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'changeOrder.netPreviousChanges', value: formatCurrency(data.changeOrder.netPreviousChanges || 0), x: 450, y, size: 8, font: fontBold, color: COLOR_DARK, bold: true });

  y -= 18;
  const priorSum = Number(data.changeOrder.originalContractSum || data.financials.totalApprovedRcv || 0) + Number(data.changeOrder.netPreviousChanges || 0);
  page.drawText('The contract sum prior to this change was: ...........................................................', { x: 50, y, size: 8, font, color: COLOR_DARK });
  page.drawText(formatCurrency(priorSum), { x: 450, y, size: 8, font: fontBold, color: COLOR_DARK });

  y -= 18;
  const changeTypePrefix = 'The contract sum will be (';
  const changeTypeSuffix = ') by this change order in the amount of: ...';
  page.drawText(changeTypePrefix, { x: 50, y, size: 8, font, color: COLOR_DARK });
  let changeTypeX = 50 + font.widthOfTextAtSize(changeTypePrefix, 8);
  drawFieldValue(page, { key: 'changeOrder.changeType', value: data.changeOrder.changeType, x: changeTypeX, y, size: 8, font, color: COLOR_DARK });
  changeTypeX += font.widthOfTextAtSize(val(data.changeOrder.changeType), 8);
  page.drawText(changeTypeSuffix, { x: changeTypeX, y, size: 8, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'changeOrder.changeAmount', value: formatCurrency(data.changeOrder.changeAmount || 0), x: 450, y, size: 8, font: fontBold, color: COLOR_RED, bold: true });

  y -= 18;
  const delta = (data.changeOrder.changeType === 'decrease' ? -1 : 1) * Number(data.changeOrder.changeAmount || 0);
  const newContractSum = priorSum + delta;
  page.drawText('The new contract sum including this change order will be: ...........................................', { x: 50, y, size: 8, font, color: COLOR_DARK });
  page.drawText(formatCurrency(newContractSum), { x: 450, y, size: 8.5, font: fontBold, color: COLOR_DARK });

  y -= 18;
  const daysPrefix = 'The contract time will be (increased) by: (';
  const daysSuffix = ') days.';
  page.drawText(daysPrefix, { x: 50, y, size: 8, font: fontBold, color: COLOR_DARK });
  let daysX = 50 + fontBold.widthOfTextAtSize(daysPrefix, 8);
  drawFieldValue(page, { key: 'changeOrder.addedDays', value: data.changeOrder.addedDays, fallback: '0', x: daysX, y, size: 8, font: fontBold, color: COLOR_DARK, bold: true });
  daysX += fontBold.widthOfTextAtSize(val(data.changeOrder.addedDays, '0'), 8);
  page.drawText(daysSuffix, { x: daysX, y, size: 8, font: fontBold, color: COLOR_DARK });

  // Signature Block
  y -= 45;
  page.drawText('Contractor', { x: 50, y, size: 9, font: fontBold, color: COLOR_DARK });
  page.drawText('Owner', { x: 330, y, size: 9, font: fontBold, color: COLOR_DARK });

  y -= 25;
  page.drawLine({ start: { x: 50, y }, end: { x: 250, y }, thickness: 1, color: COLOR_DARK });
  page.drawLine({ start: { x: 330, y }, end: { x: 530, y }, thickness: 1, color: COLOR_DARK });
  page.drawText('Signature', { x: 50, y: y - 10, size: 7.5, font, color: COLOR_DARK });
  page.drawText('Signature', { x: 330, y: y - 10, size: 7.5, font, color: COLOR_DARK });
  page.drawText(`Contractor: Hays + Sons (${data.branch.managerName})`, { x: 50, y: y - 20, size: 7.5, font, color: COLOR_DARK });
  page.drawText(`Owner: ${data.customer.customerName}`, { x: 330, y: y - 20, size: 7.5, font, color: COLOR_DARK });

  y -= 32;
  page.drawLine({ start: { x: 50, y }, end: { x: 250, y }, thickness: 1, color: COLOR_DARK });
  page.drawLine({ start: { x: 330, y }, end: { x: 530, y }, thickness: 1, color: COLOR_DARK });
  page.drawText('Date', { x: 50, y: y - 10, size: 7.5, font, color: COLOR_DARK });
  page.drawText('Date', { x: 330, y: y - 10, size: 7.5, font, color: COLOR_DARK });

  y -= 20;
  page.drawText('Hays + Sons - Property Repair Specialists', { x: 210, y, size: 8, font: fontBold, color: COLOR_GRAY });

  return pdfDoc.save();
}

// -------------------------------------------------------------
// 7. PRODUCTION CHECKLIST GENERATOR
// -------------------------------------------------------------
export async function generateProductionChecklist(data: RestorationJobData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  drawHeaderLogo(page, fontBold, font, data.branch);

  let y = 680;
  page.drawText('Production Checklist', { x: 225, y, size: 14, font: fontBold, color: COLOR_DARK });

  // Section: Homeowner Information (Red title)
  y -= 20;
  page.drawText('Homeowner Information', { x: 50, y, size: 8.5, font: fontBold, color: COLOR_RED });

  y -= 15;
  page.drawText('Homeowner Name:', { x: 50, y, size: 7.5, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page, { key: 'customer.customerName', value: data.customer.customerName, x: 135, y, size: 8, font: fontBold, color: COLOR_DARK, bold: true });
  page.drawLine({ start: { x: 130, y: y - 2 }, end: { x: 310, y: y - 2 }, thickness: 0.75, color: COLOR_BORDER });

  page.drawText('Job Number:', { x: 330, y, size: 7.5, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page, { key: 'customer.jobNumber', value: data.customer.jobNumber, x: 395, y, size: 8, font: fontBold, color: COLOR_RED, bold: true });
  page.drawLine({ start: { x: 390, y: y - 2 }, end: { x: 550, y: y - 2 }, thickness: 0.75, color: COLOR_BORDER });

  y -= 14;
  page.drawText('Property Address:', { x: 50, y, size: 7.5, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page, { key: 'customer.lossAddress', value: data.customer.lossAddress, x: 135, y, size: 7.5, font, color: COLOR_DARK });
  page.drawLine({ start: { x: 130, y: y - 2 }, end: { x: 310, y: y - 2 }, thickness: 0.75, color: COLOR_BORDER });

  page.drawText('Job Name:', { x: 330, y, size: 7.5, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page, { key: 'customer.jobName', value: data.customer.jobName, fallback: `${data.customer.customerName} Restoration`, x: 395, y, size: 7.5, font, color: COLOR_DARK });
  page.drawLine({ start: { x: 390, y: y - 2 }, end: { x: 550, y: y - 2 }, thickness: 0.75, color: COLOR_BORDER });

  y -= 14;
  page.drawText('Deductible Amount:', { x: 50, y, size: 7.5, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page, { key: 'financials.deductible', value: formatCurrency(data.financials.deductible), x: 140, y, size: 7.5, font: fontBold, color: COLOR_DARK, bold: true });
  page.drawLine({ start: { x: 135, y: y - 2 }, end: { x: 250, y: y - 2 }, thickness: 0.75, color: COLOR_BORDER });

  const deductibleCollectedPrefix = 'Has deductible been collected?  [ ';
  page.drawText(deductibleCollectedPrefix, { x: 270, y, size: 7.5, font: fontBold, color: COLOR_DARK });
  let deductibleCollectedX = 270 + fontBold.widthOfTextAtSize(deductibleCollectedPrefix, 7.5);
  drawFieldValue(page, { key: 'checklist.hasDeductibleBeenCollected', value: data.checklist.hasDeductibleBeenCollected, x: deductibleCollectedX, y, size: 7.5, font: fontBold, color: COLOR_DARK, bold: true });
  deductibleCollectedX += fontBold.widthOfTextAtSize(val(data.checklist.hasDeductibleBeenCollected), 7.5);
  page.drawText(' ]', { x: deductibleCollectedX, y, size: 7.5, font: fontBold, color: COLOR_DARK });

  y -= 14;
  page.drawText('If no, explain:', { x: 50, y, size: 7.5, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page, { key: 'checklist.deductibleExplanation', value: data.checklist.deductibleExplanation, fallback: 'Collected at pre-construction walk.', x: 120, y, size: 7.5, font, color: COLOR_DARK });
  page.drawLine({ start: { x: 115, y: y - 2 }, end: { x: 550, y: y - 2 }, thickness: 0.75, color: COLOR_BORDER });

  y -= 14;
  const emailPrefix = 'Email Address: ';
  page.drawText(emailPrefix, { x: 50, y, size: 7.5, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'customer.email', value: data.customer.email, x: 50 + font.widthOfTextAtSize(emailPrefix, 7.5), y, size: 7.5, font, color: COLOR_DARK });
  const phonePrefix = 'Phone: ';
  const phoneSep = '   |   Alt Phone: ';
  page.drawText(phonePrefix, { x: 270, y, size: 7.5, font, color: COLOR_DARK });
  let phoneX = 270 + font.widthOfTextAtSize(phonePrefix, 7.5);
  drawFieldValue(page, { key: 'customer.mainPhone', value: data.customer.mainPhone, x: phoneX, y, size: 7.5, font, color: COLOR_DARK });
  phoneX += font.widthOfTextAtSize(val(data.customer.mainPhone), 7.5);
  page.drawText(phoneSep, { x: phoneX, y, size: 7.5, font, color: COLOR_DARK });
  phoneX += font.widthOfTextAtSize(phoneSep, 7.5);
  drawFieldValue(page, { key: 'customer.mobilePhone', value: data.customer.mobilePhone, x: phoneX, y, size: 7.5, font, color: COLOR_DARK });

  // Yellow Highlight Header: Estimates and Required Documentation
  y -= 22;
  page.drawRectangle({ x: 50, y: y - 14, width: 500, height: 14, color: COLOR_HIGHLIGHT });
  page.drawText('Estimates and Required Documentation', { x: 55, y: y - 10, size: 8, font: fontBold, color: COLOR_DARK });

  y -= 26;
  page.drawText('[X] Preliminary Report with Correct Information', { x: 55, y, size: 7.5, font, color: COLOR_DARK });
  page.drawText('[X] Copy of Scope', { x: 330, y, size: 7.5, font, color: COLOR_DARK });

  y -= 15;
  page.drawText('[X] Repair Authorization / Contract', { x: 55, y, size: 7.5, font, color: COLOR_DARK });
  page.drawText('[X] Pictures / Matterport in DASH', { x: 330, y, size: 7.5, font, color: COLOR_DARK });

  y -= 15;
  const xactimatePrefix = 'Xactimate Version?  ____';
  const xactimateSuffix = '_____';
  page.drawText(xactimatePrefix, { x: 55, y, size: 7.5, font, color: COLOR_DARK });
  let xactimateX = 55 + font.widthOfTextAtSize(xactimatePrefix, 7.5);
  drawFieldValue(page, { key: 'checklist.xactimateVersion', value: data.checklist.xactimateVersion, x: xactimateX, y, size: 7.5, font, color: COLOR_DARK });
  xactimateX += font.widthOfTextAtSize(val(data.checklist.xactimateVersion), 7.5);
  page.drawText(xactimateSuffix, { x: xactimateX, y, size: 7.5, font, color: COLOR_DARK });
  page.drawText('[X] Two Copies of APPROVED estimate', { x: 330, y, size: 7.5, font, color: COLOR_DARK });

  y -= 15;
  page.drawText('[X] Signed Mortgage Authorization Required & Enclosed?', { x: 55, y, size: 7.5, font, color: COLOR_DARK });
  page.drawText('[X] Building Permit Enclosed? / County: Yes', { x: 330, y, size: 7.5, font, color: COLOR_DARK });

  // Yellow Highlight Header: IPC Requirements
  y -= 24;
  page.drawRectangle({ x: 50, y: y - 14, width: 500, height: 14, color: COLOR_HIGHLIGHT });
  page.drawText('IPC Requirements', { x: 55, y: y - 10, size: 8, font: fontBold, color: COLOR_DARK });

  y -= 22;
  page.drawText('All items on this checklist are complete and verified by the GM:  [X] Kenneth Belford', {
    x: 55,
    y,
    size: 7.5,
    font: fontBold,
    color: COLOR_DARK,
  });
  y -= 12;
  page.drawText('Upload Necessary Authorizations to Insurance Carrier (Contractor Connection / IMACC)', {
    x: 55,
    y,
    size: 7.5,
    font,
    color: COLOR_DARK,
  });

  // Yellow Highlight Header: Agent / Adjuster Information
  y -= 22;
  page.drawRectangle({ x: 50, y: y - 14, width: 500, height: 14, color: COLOR_HIGHLIGHT });
  page.drawText('Agent / Adjuster Information - Capture if blank or unknown!', { x: 55, y: y - 10, size: 8, font: fontBold, color: COLOR_DARK });

  y -= 22;
  const insCompanyPrefix = 'Insurance Company: ';
  page.drawText(insCompanyPrefix, { x: 55, y, size: 7.5, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'insurance.carrier', value: data.insurance.carrier, x: 55 + font.widthOfTextAtSize(insCompanyPrefix, 7.5), y, size: 7.5, font, color: COLOR_DARK });
  const agentNamePrefix = 'Agent Name: ';
  page.drawText(agentNamePrefix, { x: 280, y, size: 7.5, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'insurance.brokerAgent', value: data.insurance.brokerAgent, x: 280 + font.widthOfTextAtSize(agentNamePrefix, 7.5), y, size: 7.5, font, color: COLOR_DARK });
  const agentPhonePrefix = 'Agent Phone: ';
  page.drawText(agentPhonePrefix, { x: 440, y, size: 7.5, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'insurance.agentPhone', value: data.insurance.agentPhone, x: 440 + font.widthOfTextAtSize(agentPhonePrefix, 7.5), y, size: 7.5, font, color: COLOR_DARK });

  y -= 14;
  const adjusterNamePrefix = 'Adjuster Name: ';
  page.drawText(adjusterNamePrefix, { x: 55, y, size: 7.5, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'insurance.primaryAdjuster', value: data.insurance.primaryAdjuster, x: 55 + font.widthOfTextAtSize(adjusterNamePrefix, 7.5), y, size: 7.5, font, color: COLOR_DARK });
  const adjusterPhonePrefix = 'Adjuster Phone: ';
  page.drawText(adjusterPhonePrefix, { x: 280, y, size: 7.5, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'insurance.adjusterPhone', value: data.insurance.adjusterPhone, x: 280 + font.widthOfTextAtSize(adjusterPhonePrefix, 7.5), y, size: 7.5, font, color: COLOR_DARK });
  const adjusterEmailPrefix = 'Adjuster Email: ';
  page.drawText(adjusterEmailPrefix, { x: 410, y, size: 7.5, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'insurance.adjusterEmail', value: data.insurance.adjusterEmail, x: 410 + font.widthOfTextAtSize(adjusterEmailPrefix, 7.5), y, size: 7.5, font, color: COLOR_DARK });

  // Yellow Highlight Header: Claim / Check Information
  y -= 22;
  page.drawRectangle({ x: 50, y: y - 14, width: 500, height: 14, color: COLOR_HIGHLIGHT });
  page.drawText('Claim / Check Information', { x: 55, y: y - 10, size: 8, font: fontBold, color: COLOR_DARK });

  y -= 20;
  const claimPrefix = 'Claim #:  ';
  page.drawText(claimPrefix, { x: 55, y, size: 7.5, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page, { key: 'insurance.claimNumber', value: data.insurance.claimNumber, x: 55 + fontBold.widthOfTextAtSize(claimPrefix, 7.5), y, size: 7.5, font: fontBold, color: COLOR_DARK, bold: true });
  const selfPayPrefix = 'Self Pay: ';
  page.drawText(selfPayPrefix, { x: 230, y, size: 7.5, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'checklist.isSelfPay', value: data.checklist.isSelfPay ? 'Yes' : 'No', x: 230 + font.widthOfTextAtSize(selfPayPrefix, 7.5), y, size: 7.5, font, color: COLOR_DARK });
  const programClaimPrefix = 'Program Claim? ';
  page.drawText(programClaimPrefix, { x: 360, y, size: 7.5, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'checklist.isProgramClaim', value: data.checklist.isProgramClaim ? 'Yes' : 'No', x: 360 + font.widthOfTextAtSize(programClaimPrefix, 7.5), y, size: 7.5, font, color: COLOR_DARK });

  y -= 14;
  const checkSentPrefix = 'Has check been sent?  ';
  page.drawText(checkSentPrefix, { x: 55, y, size: 7.5, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'checklist.hasCheckBeenSent', value: data.checklist.hasCheckBeenSent ? 'Yes' : 'No', x: 55 + font.widthOfTextAtSize(checkSentPrefix, 7.5), y, size: 7.5, font, color: COLOR_DARK });
  const checkToWhomPrefix = 'To whom?  ';
  page.drawText(checkToWhomPrefix, { x: 230, y, size: 7.5, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'checklist.checkToWhom', value: data.checklist.checkToWhom, x: 230 + font.widthOfTextAtSize(checkToWhomPrefix, 7.5), y, size: 7.5, font, color: COLOR_DARK });

  y -= 14;
  const payablePrefix = 'Check payable to: ';
  page.drawText(payablePrefix, { x: 55, y, size: 7.5, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'checklist.checkPayableTo', value: data.checklist.checkPayableTo, x: 55 + font.widthOfTextAtSize(payablePrefix, 7.5), y, size: 7.5, font, color: COLOR_DARK });

  y -= 14;
  const mortgageCheckPrefix = 'Mortgage on check?  ';
  const mortgageCheckMid = ' (';
  page.drawText(mortgageCheckPrefix, { x: 55, y, size: 7.5, font, color: COLOR_DARK });
  let mortgageCheckX = 55 + font.widthOfTextAtSize(mortgageCheckPrefix, 7.5);
  drawFieldValue(page, { key: 'mortgage.hasMortgage', value: data.mortgage.hasMortgage ? 'Yes' : 'No', x: mortgageCheckX, y, size: 7.5, font, color: COLOR_DARK });
  mortgageCheckX += font.widthOfTextAtSize(data.mortgage.hasMortgage ? 'Yes' : 'No', 7.5);
  page.drawText(mortgageCheckMid, { x: mortgageCheckX, y, size: 7.5, font, color: COLOR_DARK });
  mortgageCheckX += font.widthOfTextAtSize(mortgageCheckMid, 7.5);
  drawFieldValue(page, { key: 'mortgage.mortgageCompany', value: data.mortgage.mortgageCompany, fallback: 'None', x: mortgageCheckX, y, size: 7.5, font, color: COLOR_DARK });
  mortgageCheckX += font.widthOfTextAtSize(val(data.mortgage.mortgageCompany, 'None'), 7.5);
  page.drawText(')', { x: mortgageCheckX, y, size: 7.5, font, color: COLOR_DARK });

  const depreciationPrefix = 'Depreciation withheld?  ';
  const depreciationMid = ' (';
  page.drawText(depreciationPrefix, { x: 320, y, size: 7.5, font, color: COLOR_DARK });
  let depreciationX = 320 + font.widthOfTextAtSize(depreciationPrefix, 7.5);
  drawFieldValue(page, { key: 'checklist.isDepreciationWithheld', value: data.checklist.isDepreciationWithheld ? 'Yes' : 'No', x: depreciationX, y, size: 7.5, font, color: COLOR_DARK });
  depreciationX += font.widthOfTextAtSize(data.checklist.isDepreciationWithheld ? 'Yes' : 'No', 7.5);
  page.drawText(depreciationMid, { x: depreciationX, y, size: 7.5, font, color: COLOR_DARK });
  depreciationX += font.widthOfTextAtSize(depreciationMid, 7.5);
  drawFieldValue(page, { key: 'checklist.depreciationAmount', value: formatCurrency(data.checklist.depreciationAmount), x: depreciationX, y, size: 7.5, font, color: COLOR_DARK });
  depreciationX += font.widthOfTextAtSize(val(formatCurrency(data.checklist.depreciationAmount)), 7.5);
  page.drawText(')', { x: depreciationX, y, size: 7.5, font, color: COLOR_DARK });

  y -= 14;
  const contractAmountPrefix = 'Contract Amount:  ';
  page.drawText(contractAmountPrefix, { x: 55, y, size: 8, font: fontBold, color: COLOR_RED });
  drawFieldValue(page, { key: 'financials.totalApprovedRcv', value: formatCurrency(data.financials.totalApprovedRcv), x: 55 + fontBold.widthOfTextAtSize(contractAmountPrefix, 8), y, size: 8, font: fontBold, color: COLOR_RED, bold: true });
  const estimatorPrefix = 'Estimator: ';
  page.drawText(estimatorPrefix, { x: 280, y, size: 7.5, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'team.estimator', value: data.team.estimator, x: 280 + font.widthOfTextAtSize(estimatorPrefix, 7.5), y, size: 7.5, font, color: COLOR_DARK });

  y -= 18;
  const pmPrefix = 'Project Manager: ';
  page.drawText(pmPrefix, { x: 55, y, size: 7.5, font: fontBold, color: COLOR_DARK });
  drawFieldValue(page, { key: 'team.projectManager', value: data.team.projectManager, x: 55 + fontBold.widthOfTextAtSize(pmPrefix, 7.5), y, size: 7.5, font: fontBold, color: COLOR_DARK, bold: true });
  const startDatePrefix = 'Start Date: ';
  page.drawText(startDatePrefix, { x: 240, y, size: 7.5, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'checklist.startDate', value: data.checklist.startDate, fallback: 'TBD', x: 240 + font.widthOfTextAtSize(startDatePrefix, 7.5), y, size: 7.5, font, color: COLOR_DARK });
  const finishDatePrefix = 'Finish Date: ';
  page.drawText(finishDatePrefix, { x: 380, y, size: 7.5, font, color: COLOR_DARK });
  drawFieldValue(page, { key: 'checklist.finishDate', value: data.checklist.finishDate, fallback: 'TBD', x: 380 + font.widthOfTextAtSize(finishDatePrefix, 7.5), y, size: 7.5, font, color: COLOR_DARK });

  y -= 16;
  page.drawText('PM Notes:', { x: 55, y, size: 7.5, font: fontBold, color: COLOR_DARK });
  drawWrappedText(page, data.checklist.projectManagerNotes || '', {
    x: 105,
    y,
    maxWidth: 440,
    lineHeight: 10,
    font,
    size: 7.5,
    maxLines: 2,
    key: 'checklist.projectManagerNotes',
  });

  return pdfDoc.save();
}

// -------------------------------------------------------------
// 8. PRODUCTION NOTES GENERATOR
// -------------------------------------------------------------
export async function generateProductionNotes(data: RestorationJobData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  drawHeaderLogo(page, fontBold, font, data.branch);

  // Title Banner
  page.drawRectangle({ x: 40, y: 708, width: 532, height: 16, color: COLOR_RED });
  page.drawText('PRODUCTION NOTES', { x: 255, y: 712, size: 9, font: fontBold, color: COLOR_WHITE });

  const notes = data.productionNotes ?? ({} as RestorationJobData['productionNotes']);

  // ---- Auto-filled Loss & Damage Details ----
  page.drawText('Loss & Damage Details', { x: 40, y: 692, size: 9.5, font: fontBold, color: COLOR_DARK });

  const LABEL_X = 40;
  const VALUE_X = 170;
  const VALUE_W = 402;
  const RIGHT_LABEL_X = 340;
  const RIGHT_VALUE_X = 420;
  const RIGHT_VALUE_W = 152;

  /** Draws one label + bordered value row. `right` places it in the right column. */
  const drawField = (label: string, value: string, y: number, right = false, key: string) => {
    const labelX = right ? RIGHT_LABEL_X : LABEL_X;
    const valueX = right ? RIGHT_VALUE_X : VALUE_X;
    const valueW = right ? RIGHT_VALUE_W : VALUE_W;
    page.drawText(label, { x: labelX, y, size: 7.5, font: fontBold, color: COLOR_DARK });
    page.drawRectangle({
      x: valueX,
      y: y - 4,
      width: valueW,
      height: 14,
      borderColor: COLOR_BORDER,
      borderWidth: 0.75,
    });
    const v = cleanTextForPdf(value);
    const maxW = valueW - 8;
    let size = 7.5;
    while (v && font.widthOfTextAtSize(v, size) > maxW && size > 5) size -= 0.25;
    drawFieldValue(page, { key, value: v, x: valueX + 4, y, size, font, color: COLOR_DARK });
  };

  drawField('Job Number:', data.customer.jobNumber || '', 674, false, 'customer.jobNumber');
  drawField('Job Name:', data.customer.jobName || `${data.customer.customerName || ''} Restoration`, 674, true, 'customer.jobName');
  drawField('Customer:', data.customer.customerName || '', 656, false, 'customer.customerName');
  drawField('Loss Address:', data.customer.lossAddress || '', 638, false, 'customer.lossAddress');
  drawField('Date of Loss:', data.insurance.dateOfLoss || '', 620, false, 'insurance.dateOfLoss');
  drawField('Time of Loss:', data.insurance.timeOfLoss || '', 620, true, 'insurance.timeOfLoss');
  drawField('Loss Type:', data.insurance.typeOfLoss || '', 602, false, 'insurance.typeOfLoss');
  drawField('Secondary:', data.insurance.typeOfLossSecondary || '', 602, true, 'insurance.typeOfLossSecondary');
  drawField('Carrier:', data.insurance.carrier || '', 584, false, 'insurance.carrier');
  drawField('Claim #:', data.insurance.claimNumber || '', 584, true, 'insurance.claimNumber');
  drawField('Policy #:', data.insurance.policyNumber || '', 566, false, 'insurance.policyNumber');
  drawField('Adjuster:', data.insurance.primaryAdjuster || '', 566, true, 'insurance.primaryAdjuster');
  drawField('Adjuster Phone:', data.insurance.adjusterPhone || '', 548, false, 'insurance.adjusterPhone');
  drawField('Deductible:', formatCurrency(data.financials.deductible), 548, true, 'financials.deductible');
  drawField('Approved RCV:', formatCurrency(data.financials.totalApprovedRcv), 530, false, 'financials.totalApprovedRcv');
  drawField('Net Claim:', formatCurrency(data.financials.netClaimValue), 530, true, 'financials.netClaimValue');

  // Loss description (auto-filled narrative of the damage).
  page.drawText('Loss Description:', { x: 40, y: 508, size: 7.5, font: fontBold, color: COLOR_DARK });
  page.drawRectangle({
    x: 40,
    y: 452,
    width: 532,
    height: 50,
    borderColor: COLOR_BORDER,
    borderWidth: 0.75,
  });
  drawWrappedText(page, data.insurance.lossDescription || '', {
    x: 46,
    y: 490,
    maxWidth: 518,
    lineHeight: 10,
    font,
    size: 7.5,
    maxLines: 4,
    key: 'insurance.lossDescription',
  });
  if (!val(data.insurance.lossDescription)) {
    captureEmptyFieldSpan(page, { key: 'insurance.lossDescription', x: 46, y: 490, size: 7.5, width: 518 });
  }

  // ---- Additional Production Notes (user-entered, or blank for handwriting) ----
  page.drawText('Additional Production Notes', {
    x: 40,
    y: 432,
    size: 9.5,
    font: fontBold,
    color: COLOR_DARK,
  });

  const noteFields: Array<{ label: string; value: string; key: string }> = [
    { label: 'Scope & Repairs Summary', value: notes.scopeSummary ?? '', key: 'productionNotes.scopeSummary' },
    { label: 'Materials & Equipment', value: notes.materialsAndEquipment ?? '', key: 'productionNotes.materialsAndEquipment' },
    { label: 'Schedule & Access', value: notes.scheduleAndAccess ?? '', key: 'productionNotes.scheduleAndAccess' },
    { label: 'Safety Considerations', value: notes.safetyConsiderations ?? '', key: 'productionNotes.safetyConsiderations' },
    { label: 'Communication Notes', value: notes.communicationNotes ?? '', key: 'productionNotes.communicationNotes' },
    { label: 'Additional Information', value: notes.additionalNotes ?? '', key: 'productionNotes.additionalNotes' },
  ];

  const NOTE_BOX_H = 38;
  const NOTE_GAP = 12;
  let ny = 416;
  for (const field of noteFields) {
    const boxBottom = ny - NOTE_BOX_H;
    page.drawText(field.label, { x: 40, y: ny + 2, size: 7.5, font: fontBold, color: COLOR_RED });
    page.drawRectangle({
      x: 40,
      y: boxBottom,
      width: 532,
      height: NOTE_BOX_H,
      borderColor: COLOR_BORDER,
      borderWidth: 0.75,
    });

    const v = cleanTextForPdf(field.value);
    if (v) {
      drawWrappedText(page, v, {
        x: 46,
        y: boxBottom + NOTE_BOX_H - 12,
        maxWidth: 518,
        lineHeight: 9.5,
        font,
        size: 7.5,
        maxLines: 3,
        key: field.key,
      });
    } else {
      // Faint guide lines so the blank box can be filled in by hand.
      page.drawLine({
        start: { x: 46, y: boxBottom + NOTE_BOX_H - 14 },
        end: { x: 566, y: boxBottom + NOTE_BOX_H - 14 },
        thickness: 0.5,
        color: COLOR_LINE,
      });
      page.drawLine({
        start: { x: 46, y: boxBottom + NOTE_BOX_H - 24 },
        end: { x: 566, y: boxBottom + NOTE_BOX_H - 24 },
        thickness: 0.5,
        color: COLOR_LINE,
      });
      // Keep the blank box clickable in the editable preview.
      captureEmptyFieldSpan(page, {
        key: field.key,
        x: 46,
        y: boxBottom + NOTE_BOX_H - 12,
        size: 7.5,
        width: 518,
      });
    }
    ny = boxBottom - NOTE_GAP;
  }

  return pdfDoc.save();
}

// -------------------------------------------------------------
// 9. UNIFIED COMPLETE 9-PAGE PACKET GENERATOR
// -------------------------------------------------------------
export async function generateCompletePacket(data: RestorationJobData): Promise<Uint8Array> {
  const mergedPdf = await PDFDocument.create();

  // Generate each document in sequential order
  const [
    prelimBytes,
    welcomeBytes,
    mortgageBytes,
    contractBytes,
    cancellationBytes,
    changeOrderBytes,
    checklistBytes,
    productionNotesBytes,
  ] = await Promise.all([
    generatePreliminaryReport(data),
    generateWelcomeLetter(data),
    generateMortgageAuth(data),
    generateContract(data), // 2 pages
    generateCancellationNotice(data),
    generateChangeOrder(data),
    generateProductionChecklist(data),
    generateProductionNotes(data),
  ]);

  const docs = await Promise.all([
    PDFDocument.load(prelimBytes),
    PDFDocument.load(welcomeBytes),
    PDFDocument.load(mortgageBytes),
    PDFDocument.load(contractBytes),
    PDFDocument.load(cancellationBytes),
    PDFDocument.load(changeOrderBytes),
    PDFDocument.load(checklistBytes),
    PDFDocument.load(productionNotesBytes),
  ]);

  for (const doc of docs) {
    const copiedPages = await mergedPdf.copyPages(doc, doc.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }

  // Stamp running page footers across all pages for complete packet integrity
  const fontFooter = await mergedPdf.embedFont(StandardFonts.Helvetica);
  const totalPages = mergedPdf.getPageCount();
  for (let i = 0; i < totalPages; i++) {
    const p = mergedPdf.getPage(i);
    p.drawText(
      `Page ${i + 1} of ${totalPages}  |  Hays + Sons Complete Restoration  |  Job #${data.customer.jobNumber}  |  ${data.customer.customerName}`,
      {
        x: 45,
        y: 24,
        size: 7,
        font: fontFooter,
        color: COLOR_GRAY,
      }
    );
  }

  return mergedPdf.save();
}

// -------------------------------------------------------------
// Form Template Filling Demonstration Function (AcroForms with pdf-lib)
// -------------------------------------------------------------
export async function fillPdfFormTemplate(
  templatePdfBytes: Uint8Array,
  data: RestorationJobData
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(templatePdfBytes);
  const form = pdfDoc.getForm();

  const trySetText = (fieldName: string, value: string) => {
    try {
      const field = form.getTextField(fieldName);
      if (field) field.setText(value);
    } catch {
      // field not found, ignore
    }
  };

  const trySetCheck = (fieldName: string, isChecked: boolean) => {
    try {
      const field = form.getCheckBox(fieldName);
      if (field) {
        if (isChecked) field.check();
        else field.uncheck();
      }
    } catch {
      // field not found, ignore
    }
  };

  trySetText('JobNumber', data.customer.jobNumber);
  trySetText('CustomerName', data.customer.customerName);
  trySetText('MailingAddress', data.customer.mailingAddress);
  trySetText('LossAddress', data.customer.lossAddress);
  trySetText('Phone', data.customer.mobilePhone || data.customer.mainPhone);
  trySetText('Email', data.customer.email);
  trySetText('InsuranceCarrier', data.insurance.carrier);
  trySetText('ClaimNumber', data.insurance.claimNumber);
  trySetText('AdjusterName', data.insurance.primaryAdjuster);
  trySetText('TotalRCV', formatCurrency(data.financials.totalApprovedRcv));
  trySetText('Deductible', formatCurrency(data.financials.deductible));
  trySetText('NetClaimValue', formatCurrency(data.financials.netClaimValue));
  trySetText('DownPayment', formatCurrency(data.financials.downPayment));
  trySetText('MidProgressPayment', formatCurrency(data.financials.midProgressPayment));
  trySetText('Balance', formatCurrency(data.financials.balancePayment));
  trySetText('CommenceDays', String(data.financials.commenceDays));
  trySetText('CompleteDays', String(data.financials.completeDays));
  trySetCheck('MortgageOnClaim', data.mortgage.hasMortgage);
  trySetText('MortgageCompany', data.mortgage.mortgageCompany);
  trySetText('LoanNumber', data.mortgage.loanNumber);

  return pdfDoc.save();
}
