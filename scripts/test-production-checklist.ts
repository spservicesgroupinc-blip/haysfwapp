import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
import { generateDocWithSpans, generateProductionChecklist } from '../src/services/pdfService';
import { getPdfFieldSchema } from '../src/services/pdfFieldSchema';
import { createEmptyJob } from '../src/types/jobData';
import { SAMPLE_WATER } from './fixtures';
import { PDFDocument } from 'pdf-lib';
import { generateCompletePacket } from '../src/services/pdfService';
import { ensureRecordDefaults } from '../src/types/jobData';
import { CHECKLIST_BOXES } from '../src/types/productionChecklist';

test('checklist boxes are interactive, preserve job checks, and remain editable in the packet', async () => {
  const job = createEmptyJob();
  Object.assign(job.checklist, { jobNumberVerified: true, preliminaryReportVerified: true, managerNotesVerified: true });
  const restored = ensureRecordDefaults(JSON.parse(JSON.stringify(job)));
  for (const generator of [generateProductionChecklist, generateCompletePacket]) {
    const pdf = await PDFDocument.load(await generator(restored));
    const form = pdf.getForm();
    assert.equal(form.getFields().length, 33, 'Every outlined box must be interactive');
    assert.equal(form.getFields().filter(field => form.getCheckBox(field.getName()).isChecked()).length, 3, 'Only explicitly checked items are marked');
    for (const key of ['jobNumberVerified', 'preliminaryReportVerified', 'managerNotesVerified']) {
      assert.equal(form.getCheckBox(`checklist.${key}`).isChecked(), true, key);
    }
    const expectedPage = pdf.getPages()[generator === generateCompletePacket ? 7 : 0];
    for (const field of form.getFields()) {
      for (const widget of field.acroField.getWidgets()) assert.equal(widget.P()?.toString(), expectedPage.ref.toString());
    }
    const unchecked = form.getCheckBox('checklist.scopeCopyVerified');
    assert.equal(unchecked.isChecked(), false);
    unchecked.check();
    form.getCheckBox('checklist.jobNumberVerified').uncheck();
    const reopened = await PDFDocument.load(await pdf.save());
    assert.equal(reopened.getForm().getCheckBox('checklist.scopeCopyVerified').isChecked(), true);
    assert.equal(reopened.getForm().getCheckBox('checklist.jobNumberVerified').isChecked(), false);
  }
});

test('older jobs receive unchecked boxes without losing existing checklist data', () => {
  const legacy = createEmptyJob();
  for (const item of CHECKLIST_BOXES) delete legacy.checklist[item.key];
  legacy.checklist.projectManagerNotes = 'Keep these existing notes';
  const restored = ensureRecordDefaults(JSON.parse(JSON.stringify(legacy)));
  for (const item of CHECKLIST_BOXES) assert.equal(restored.checklist[item.key], false);
  assert.equal(restored.checklist.projectManagerNotes, 'Keep these existing notes');
});

async function inspect(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: true }).promise;
  assert.equal(doc.numPages, 1, 'The approved checklist is one Letter page');
  const page = await doc.getPage(1);
  assert.deepEqual(page.view, [0, 0, 612, 792]);
  const content = await page.getTextContent();
  const items = content.items.filter((item: any) => typeof item.str === 'string') as any[];
  return { text: items.map(item => item.str).join(' ').replace(/\s+/g, ' '), items };
}

test('uses the approved artwork, section wording and title position', async () => {
  const { text, items } = await inspect(await generateProductionChecklist(createEmptyJob()));
  const title = items.find(item => item.str.trim() === 'Production Checklist');
  assert.ok(title);
  assert.ok(Math.abs(title.transform[4] - 277.61) < 0.1, 'Title x matches approved form');
  assert.ok(Math.abs(title.transform[5] - 693.1) < 0.1, 'Title baseline matches approved form');
  assert.ok(Math.abs(title.height - 11.04) < 0.1, 'Title size matches approved form');
  for (const label of [
    'Two Copies of APPROVED estimate', 'ADJUSTER ESTIMATE, if applicable',
    'New Customer Letter Emailed w/ Link', 'Above information is Listed in DASH',
    'If NO for any item, please explain:', 'Innovation Property, and IMACC',
  ]) assert.ok(text.includes(label), `Missing approved wording: ${label}`);
  assert.ok(!text.includes('Collected at pre-construction walk.'), 'No invented collection status');
  assert.ok(!text.includes('[X] Kenneth Belford'), 'No hardcoded verification sign-off');
  assert.ok(!text.includes('[X]'), 'No automatically completed checklist boxes');
});

test('populates current job fields on the matching form lines and retains editing spans', async () => {
  const job = structuredClone(SAMPLE_WATER);
  job.branch.managerName = 'Branch Manager Example';
  const { bytes, spans } = await generateDocWithSpans(generateProductionChecklist, job);
  const { text, items } = await inspect(bytes);
  for (const value of [job.customer.customerName, job.customer.jobNumber, job.customer.email,
    job.insurance.carrier, job.insurance.claimNumber, job.insurance.adjusterEmail,
    job.team.estimator, job.team.projectManager, job.branch.managerName,
    job.checklist.startDate, job.checklist.finishDate, 'confirmed by homeowner.']) {
    assert.ok(text.includes(value), `Missing job value: ${value}`);
  }
  const email = items.find(item => item.str === job.customer.email);
  assert.ok(email && Math.abs(email.transform[4] - 174.29) < 0.1 && Math.abs(email.transform[5] - 606.46) < 0.1);
  const keys = new Set(spans.map(span => span.key));
  for (const field of getPdfFieldSchema('checklist').filter(field => !field.drawerOnly)) {
    assert.ok(keys.has(field.key), `Missing edit target: ${field.key}`);
  }
  for (const span of spans) {
    assert.equal(span.page, 1);
    assert.ok(span.x >= 0 && span.y >= 0 && span.x + span.width <= 612 && span.y + span.height <= 792, span.key);
  }
});

test('long values stay inside their form fields and notes retain the ending', async () => {
  const job = structuredClone(SAMPLE_WATER);
  job.customer.customerName = 'An unusually long homeowner and co-owner name '.repeat(6);
  job.insurance.adjusterEmail = 'a-very-long-adjuster-address-at-the-insurance-company@example-insurance-company.com';
  job.checklist.projectManagerNotes = 'Confirm the selected materials with the homeowner before ordering. '.repeat(5) + 'FINAL NOTE MARKER';
  const { bytes, spans } = await generateDocWithSpans(generateProductionChecklist, job);
  const { text, items } = await inspect(bytes);
  assert.ok(text.includes('FINAL NOTE MARKER'));
  const name = spans.find(span => span.key === 'customer.customerName')!;
  assert.ok(name.x + name.width <= 383.59);
  const email = spans.find(span => span.key === 'insurance.adjusterEmail')!;
  assert.ok(email.x + email.width <= 298.51);
  for (const span of [name, email]) {
    const value = items.find(item => Math.abs(item.transform[4] - span.x) < 0.1 && Math.abs(792 - item.transform[5] - span.y - span.size * 1.05) < 0.1);
    assert.ok(value && value.width <= span.width + 0.1, `Rendered text overflows ${span.key}`);
  }
});
