import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFPage, PDFFont, StandardFonts } from 'pdf-lib';
import { createEmptyJob } from '../src/documents/types/jobData';
import { CHECKLIST_BOXES } from '../src/documents/types/productionChecklist';
import { parseRawIntakeText, parseCurrencyValue, applyAiExtractionToJob, type AiIntakePayload } from '../src/documents/services/intakeParser';

const originalMethods = {
  drawText: PDFPage.prototype.drawText,
  width: PDFFont.prototype.widthOfTextAtSize,
  addPage: PDFDocument.prototype.addPage,
};

test('document module never mutates shared pdf-lib prototypes', async () => {
  const pdf = await import('../src/documents/services/pdfService');
  assert.equal(PDFPage.prototype.drawText, originalMethods.drawText);
  assert.equal(PDFFont.prototype.widthOfTextAtSize, originalMethods.width);
  assert.equal(PDFDocument.prototype.addPage, originalMethods.addPage);
  const unrelated = await PDFDocument.create();
  const font = await unrelated.embedFont(StandardFonts.Helvetica);
  const page = unrelated.addPage();
  // The other app's generator retains the library's original Unicode behavior.
  assert.throws(() => page.drawText('Outside WinAnsi: 漢字', { font }), /WinAnsi/);
  assert.throws(() => font.widthOfTextAtSize('漢字', 12), /WinAnsi/);
  // The existing customer PDF uses embedded Unicode fonts; its actual drawText
  // input must retain Greek and smart punctuation after this module loads.
  unrelated.registerFontkit(fontkit);
  const unicodeFont = await unrelated.embedFont(await readFile(new URL('../src/assets/fonts/NotoSans-Regular.ttf', import.meta.url)));
  const encodeText = unicodeFont.encodeText.bind(unicodeFont);
  const encodedInputs: string[] = [];
  unicodeFont.encodeText = text => { encodedInputs.push(text); return encodeText(text); };
  const unicodeText = 'Καλημέρα — “Résumé”';
  page.drawText(unicodeText, { font: unicodeFont });
  assert.ok(encodedInputs.includes(unicodeText));
  await unrelated.save();
  const data = createEmptyJob();
  data.customer.customerName = 'Müller — 漢字 🏠';
  data.productionNotes.scopeSummary = 'Safe “quotes” and ✓ checks';
  await pdf.generateProductionNotes(data);
  assert.equal(PDFPage.prototype.drawText, originalMethods.drawText);
});

test('seven document catalog generates valid PDFs with isolated editable spans', async () => {
  const { JOB_DOCUMENTS } = await import('../src/documents/services/documentCatalog');
  const { generateDocWithSpans } = await import('../src/documents/services/pdfService');
  const { getPdfFieldSchema } = await import('../src/documents/services/pdfFieldSchema');
  assert.equal(JOB_DOCUMENTS.length, 7);
  assert.ok(JOB_DOCUMENTS.every(doc => doc.id !== 'change_order'));
  const data = createEmptyJob();
  data.customer.customerName = 'Long — Unicode customer 漢字';
  data.customer.email = 'long.customer@example.test';
  data.productionNotes.scopeSummary = 'Repair rooms. '.repeat(180);
  // Populate optional fields as well: blank-only fixtures miss schema/span drift.
  for (const doc of JOB_DOCUMENTS) {
    for (const field of getPdfFieldSchema(doc.id)) {
      const parts = field.parts ?? [{ field: field.key, kind: field.kind }];
      for (const part of parts) {
        const [section, key] = part.field.split('.');
        const record = data[section as keyof typeof data] as Record<string, unknown>;
        if (record[key] !== '' && record[key] !== undefined) continue;
        record[key] = part.kind === 'currency' ? 1234.56 : part.kind === 'int' ? 3 :
          part.kind === 'date' ? '2026-10-16' : part.kind === 'time' ? '09:30' :
          part.kind === 'boolean' || part.kind === 'checkbox' ? true :
          part.kind === 'phone' ? '260-555-1234' : part.kind === 'email' ? 'office@example.test' : 'Sample value';
      }
    }
  }
  data.mortgage.hasMortgage = true;
  for (const item of CHECKLIST_BOXES) data.checklist[item.key] = true;
  const results = await Promise.all(JOB_DOCUMENTS.map(async doc => {
    const result = await generateDocWithSpans(doc.generator, data);
    const pdf = await PDFDocument.load(result.bytes);
    assert.ok(pdf.getPageCount() >= 1, doc.id);
    assert.ok(result.spans.length > 0, doc.id);
    const schema = getPdfFieldSchema(doc.id);
    for (const span of result.spans) {
      assert.ok(span.page >= 1 && span.page <= pdf.getPageCount(), `${doc.id}: ${span.key}`);
      assert.ok(span.x >= 0 && span.y >= 0 && span.width > 0 && span.height > 0);
      assert.ok(span.x + span.width <= 613 && span.y + span.height <= 793, `${doc.id}: ${span.key} fits page`);
      assert.ok(schema.some(field => field.key === span.key), `${doc.id}: ${span.key} is editable`);
    }
    for (const field of schema) {
      if (field.drawerOnly) continue;
      const paths = field.parts?.map(part => part.field) ?? [field.key];
      const values = paths.map(path => path.split('.').reduce<unknown>((value, key) => value == null ? undefined : (value as Record<string, unknown>)[key], data));
      if (values.some(value => value !== undefined && value !== null && value !== '')) {
        assert.ok(result.spans.some(span => span.key === field.key), `${doc.id}: ${field.key} has a span`);
      }
    }
    if (doc.id === 'checklist') {
      for (const item of CHECKLIST_BOXES) {
        assert.equal(pdf.getForm().getCheckBox(`checklist.${item.key}`).isChecked(), true);
        assert.ok(result.spans.some(span => span.key === `checklist.${item.key}` && span.page === 1));
      }
    }
    return result;
  }));
  assert.equal(results.length, 7);
});

test('packet accepts an optional saved customer change order and preserves checklist widgets', async () => {
  const { generateCompletePacket } = await import('../src/documents/services/pdfService');
  const data = createEmptyJob();
  data.checklist[CHECKLIST_BOXES[0].key] = true;
  const without = await PDFDocument.load(await generateCompletePacket(data));
  assert.equal(without.getPageCount(), 8);
  const saved = await PDFDocument.create();
  saved.addPage([333, 444]).drawText('Already approved customer change order');
  const withCo = await PDFDocument.load(await generateCompletePacket(data, await saved.save()));
  assert.equal(withCo.getPageCount(), 9);
  assert.equal(withCo.getPage(6).getWidth(), 333);
  assert.equal(withCo.getForm().getCheckBox(`checklist.${CHECKLIST_BOXES[0].key}`).isChecked(), true);
});

test('currency display distinguishes missing amounts, exact zero, and credits', async () => {
  const { formatCurrency } = await import('../src/documents/services/pdfService');
  for (const value of ['', null, undefined, NaN, Infinity] as const) assert.equal(formatCurrency(value), '');
  assert.equal(formatCurrency(0), '$0.00');
  assert.equal(formatCurrency(-1234.56), '-$1,234.56');
  assert.equal(parseCurrencyValue('-$1,234.56'), -1234.56);
  assert.equal(parseCurrencyValue('$-1,234.56'), -1234.56);
  assert.equal(parseCurrencyValue('(1,234.56)'), -1234.56);
  assert.equal(parseCurrencyValue('$0.00'), 0);
  assert.equal(parseCurrencyValue('unknown'), '');
});

test('rules and AI intake keep approved RCV independent of original contract and settle payment cents', () => {
  const job = createEmptyJob();
  job.changeOrder.originalContractSum = 0;
  const parsed = parseRawIntakeText('Approved RCV: $101.03\nDeductible: $0.00\nNet Previous Changes: -$10.03', job).jobData;
  assert.equal(parsed.financials.totalApprovedRcv, 101.03);
  assert.equal(parsed.changeOrder.originalContractSum, 0);
  assert.equal(parsed.changeOrder.netPreviousChanges, -10.03);
  assert.equal(Math.round((parsed.financials.downPayment + parsed.financials.midProgressPayment + parsed.financials.balancePayment) * 100), 10103);
  const payload: AiIntakePayload = { customer: {}, insurance: {}, financials: { totalApprovedRcv: '101.03', deductible: 0 }, team: {}, mortgage: {}, changeOrder: {}, productionNotes: {}, checklist: {} };
  const ai = applyAiExtractionToJob(payload, job).jobData;
  assert.equal(ai.changeOrder.originalContractSum, 0);
  assert.equal(Math.round((ai.financials.downPayment + ai.financials.midProgressPayment + ai.financials.balancePayment) * 100), 10103);
  const blank = applyAiExtractionToJob(payload, createEmptyJob()).jobData;
  assert.equal(blank.changeOrder.originalContractSum, '');
  const contractOnly = parseRawIntakeText('Original Contract Sum: $200.05', createEmptyJob()).jobData;
  assert.equal(contractOnly.changeOrder.originalContractSum, 200.05);
  assert.equal(contractOnly.financials.totalApprovedRcv, '');
});

test('existing change-order generator retains Noto Unicode after document suite is imported', async () => {
  await import('../src/documents/services/pdfService');
  const { createRequest } = await import('../src/services/requests');
  const { generateCustomerDocument } = await import('../src/services/customerDocumentPdf');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
  const request = createRequest();
  const unicode = 'Καλημέρα — “Résumé”';
  request.job.customer = unicode;
  const font = new Uint8Array(await readFile(new URL('../src/assets/fonts/NotoSans-Regular.ttf', import.meta.url)));
  const { bytes } = await generateCustomerDocument(request, font, 'draft');
  const loaded = await pdfjs.getDocument({ data: bytes, disableFontFace: true }).promise;
  try {
    const content = await (await loaded.getPage(1)).getTextContent();
    assert.ok(content.items.some(item => 'str' in item && item.str === unicode));
  } finally {
    await loaded.destroy();
  }
});
