import { test, expect, type Page, type Route } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { SAMPLE_WATER } from './fixtures';

const user = { email: 'test@example.com', name: 'Test', role: 'editor' };
const job = { recordId: 'saved-1', customer: { jobNumber: 'UI-TEST', customerName: 'Recovered customer' } };
const ok = (route: Route, data: unknown) => route.fulfill({
  contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify({ ok: true, data }),
});

const sectionLabels = {
  home: 'Jobs', customerImport: 'Customer Knowledge Base', intake: 'Intake', customer: 'Customer & Property', insurance: 'Insurance & Claim',
  financials: 'Financials', mortgage: 'Mortgage', team: 'Team', productionNotes: 'Production Notes',
  checklist: 'Checklist', changeOrder: 'Change Orders', legacyChangeOrder: 'Legacy Change Order', documents: 'Documents',
};
async function navigate(page: Page, section: keyof typeof sectionLabels) {
  const width = page.viewportSize()?.width ?? 1440;
  if (width < 640) await page.locator('#workspace-section').selectOption(section);
  else await page.getByRole('navigation', { name: width >= 1024 ? 'Job workspace' : 'Workspace navigation', exact: true })
    .getByRole('button', { name: new RegExp(`^${sectionLabels[section]}(?:\\s|$)`) }).click();
}

async function start(page: Page, handler: (route: Route, body: any) => Promise<void>, savedJobs: unknown[] = [], customReference = false) {
  await page.addInitScript((account) => {
    localStorage.setItem('hays.db.session', JSON.stringify({ token: 'ui-session', expiresAt: '2099-01-01T00:00:00Z', user: account }));
  }, user);
  await page.route(/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/, async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === 'checkSession') await ok(route, { user });
    else if (body.action === 'analyzeIntake' && !customReference) await route.fallback();
    else if (body.action === 'listJobs') await ok(route, savedJobs);
    else if (body.action === 'getCustomerReference' && !customReference) await ok(route, { customers: [], fileName: '', updatedAt: '', updatedBy: '' });
    else await handler(route, body);
  });
  await page.goto('/');
}

test('multiple change orders retain history, cumulative balances and historical PDFs', async ({ page }, testInfo) => {
  let draft = structuredClone(SAMPLE_WATER);
  draft.financials.totalApprovedRcv = 10000;
  Object.assign(draft.changeOrder, { originalContractSum: 10000, netPreviousChanges: 0, changeAmount: 1250.15, changeType: 'increase', scopeDescription: 'Extra repairs' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await start(page, async (route, body) => {
    if (body.action === 'getDraft') await ok(route, { draft: { job: draft, recordId: draft.recordId, updatedAt: '2026-10-15T12:00:00Z' } });
    else if (body.action === 'saveDraft') { draft = body.draft.job; await ok(route, { job: draft, updatedAt: new Date().toISOString() }); }
    else if (body.action === 'saveJob') { draft = body.job; await ok(route, body.job); }
    else await ok(route, {});
  });
  await navigate(page, 'legacyChangeOrder');
  const totals = page.getByLabel('Change order totals');
  await expect(totals).toContainText('$11,250.15');
  await page.getByRole('button', { name: 'Record order & start next', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Change Order Number', exact: true })).toHaveValue('CO-02');
  await page.getByRole('combobox', { name: 'Contract Adjustment', exact: true }).selectOption('decrease');
  await page.getByRole('spinbutton', { name: 'Change Amount', exact: true }).fill('250.05');
  await page.getByRole('textbox', { name: 'Scope Description', exact: true }).fill('Credit for removed scope');
  await expect(totals).toContainText('$1,250.15');
  await expect(totals).toContainText('$11,000.10');
  await page.screenshot({ path: testInfo.outputPath('change-orders-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Record order & start next', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Change Order Number', exact: true })).toHaveValue('CO-03');
  await page.reload();
  await navigate(page, 'legacyChangeOrder');
  const history = page.getByRole('region', { name: 'Recorded change orders', exact: true });
  await expect(history).toContainText('Recorded change orders (2)');
  await expect(totals).toContainText('$1,000.10');
  await navigate(page, 'financials');
  await page.locator('#rcv-input').fill('50000');
  await navigate(page, 'legacyChangeOrder');
  await expect(totals).toContainText('$10,000.00');
  await expect(totals).toContainText('$11,000.10');
  await history.getByRole('button', { name: 'Preview Change Order CO-01 (recorded) PDF', exact: true }).click();
  const modal = page.locator('div.fixed.inset-0.z-50').filter({ has: page.getByTitle('Close modal') });
  await expect(modal.locator('canvas')).toBeVisible();
  await expect(modal.getByTitle('Edit fields directly on the PDF')).toHaveCount(0);
  const downloaded = page.waitForEvent('download');
  await modal.getByTitle('Download PDF', { exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toContain('CO-01');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(Buffer.concat(chunks)), isEvalSupported: false, useSystemFonts: true }).promise;
  const content = await (await pdf.getPage(1)).getTextContent();
  const text = content.items.map((item: any) => item.str || '').join(' ');
  expect(text).toContain('$11,250.15');
  expect(text).not.toContain('$50,000.00');
  await modal.getByTitle('Close modal').click();
  await page.setViewportSize({ width: 375, height: 850 });
  await expect(page.getByRole('textbox', { name: 'Change Order Number', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('change-orders-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('approved production checklist previews, edits and downloads in the browser', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await start(page, async (route, body) => {
    if (body.action === 'getDraft') await ok(route, { draft: { job: SAMPLE_WATER, recordId: SAMPLE_WATER.recordId, updatedAt: '2026-10-15T12:00:00Z' } });
    else if (body.action === 'saveDraft') await ok(route, { job: body.draft.job, updatedAt: new Date().toISOString() });
    else await ok(route, {});
  });
  await navigate(page, 'checklist');
  await page.getByRole('button', { name: 'Preview Production Checklist PDF', exact: true }).click();
  const modal = page.locator('div.fixed.inset-0.z-50').filter({ has: page.getByTitle('Close modal') });
  await expect(modal.locator('canvas')).toBeVisible();
  await expect(modal.getByText('1 Page', { exact: true })).toBeVisible();
  await modal.getByTitle('Fit page to screen').click();
  const beforeEdit = await modal.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await modal.getByTitle('Edit fields directly on the PDF').click();
  await expect(modal.getByRole('button', { name: 'Customer Name', exact: true })).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Manager Name', exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Customer Name', exact: true }).click();
  await modal.getByRole('textbox').fill('Updated Checklist Customer');
  await modal.getByRole('textbox').press('Enter');
  await expect.poll(() => modal.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(beforeEdit);
  await modal.getByTitle('Finish editing').click();
  await modal.locator('canvas').screenshot({ path: testInfo.outputPath('approved-checklist-preview.png') });
  const downloadPromise = page.waitForEvent('download');
  await modal.getByTitle('Download PDF', { exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('Production_Checklist');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const bytes = new Uint8Array(Buffer.concat(chunks));
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getTitle()).toBe('Production Checklist');
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getPages()[0].getSize()).toEqual({ width: 612, height: 792 });
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
  const downloadedDoc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: true }).promise;
  const content = await (await downloadedDoc.getPage(1)).getTextContent();
  const text = content.items.map((item: any) => item.str || '').join(' ').replace(/\s+/g, ' ');
  expect(text).toContain('Updated Checklist Customer');
  expect(text).toContain('New Customer Letter Emailed w/ Link');
  await modal.getByTitle('Close modal').click();
  await navigate(page, 'customer');
  await expect(page.locator('#customer-customerName')).toHaveValue('Updated Checklist Customer');
  expect(errors).toEqual([]);
});

test('checklist boxes toggle from the form and PDF, persist after reload, and download as editable fields', async ({ page }) => {
  let draft = structuredClone(SAMPLE_WATER);
  await start(page, async (route, body) => {
    if (body.action === 'getDraft') await ok(route, { draft: { job: draft, recordId: draft.recordId, updatedAt: '2026-10-15T12:00:00Z' } });
    else if (body.action === 'saveDraft') {
      draft = body.draft.job;
      await ok(route, { job: draft, updatedAt: new Date().toISOString() });
    } else await ok(route, {});
  });
  await navigate(page, 'checklist');
  const preliminary = page.getByRole('checkbox', { name: 'Preliminary report with correct information', exact: true });
  await expect(preliminary).toBeVisible({ timeout: 2000 });
  await preliminary.check();
  await page.getByRole('button', { name: 'Preview Production Checklist PDF', exact: true }).click();
  const modal = page.locator('div.fixed.inset-0.z-50').filter({ has: page.getByTitle('Close modal') });
  await expect(modal.getByRole('checkbox', { name: 'Preliminary report with correct information', exact: true })).toBeChecked();
  const scope = modal.getByRole('checkbox', { name: 'Copy of scope', exact: true });
  await scope.click();
  await expect(scope).toBeChecked();
  await expect.poll(() => draft.checklist.scopeCopyVerified).toBe(true);
  const downloadPromise = page.waitForEvent('download');
  await modal.getByTitle('Download PDF', { exact: true }).click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const form = (await PDFDocument.load(Buffer.concat(chunks))).getForm();
  expect(form.getFields()).toHaveLength(33);
  expect(form.getCheckBox('checklist.preliminaryReportVerified').isChecked()).toBe(true);
  expect(form.getCheckBox('checklist.scopeCopyVerified').isChecked()).toBe(true);
  await modal.getByTitle('Close modal').click();
  await page.reload();
  await navigate(page, 'checklist');
  await expect(preliminary).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Copy of scope', exact: true })).toBeChecked();
  await preliminary.uncheck();
  await expect.poll(() => draft.checklist.preliminaryReportVerified).toBe(false);
  await expect(page.getByRole('checkbox', { name: 'Copy of scope', exact: true })).toBeChecked();
  await page.setViewportSize({ width: 375, height: 850 });
  await expect(preliminary).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('startup recovers the shared draft before any autosave writes', async ({ page }) => {
  const sent: any[] = [];
  await start(page, async (route, body) => {
    if (body.action === 'getDraft') await ok(route, { draft: { job, recordId: job.recordId, updatedAt: '2026-10-06T12:00:00Z' } });
    else if (body.action === 'saveDraft') { sent.push(body.draft.job); await ok(route, { job: body.draft.job, updatedAt: new Date().toISOString() }); }
  });
  await navigate(page, 'customer');
  await expect(page.locator('#customer-customerName')).toHaveValue('Recovered customer');
  await page.waitForTimeout(2300);
  expect(sent).toHaveLength(0);
  await page.locator('#customer-customerName').fill('Edited customer');
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].customer.customerName).toBe('Edited customer');
  await expect(page.getByText('Draft synced', { exact: true })).toBeVisible();
});

test('manual save stays responsive and edits survive a delayed cloud response', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let saveStarted = false;
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await start(page, async (route, body) => {
    if (body.action === 'getDraft') await ok(route, { draft: { job, recordId: job.recordId, updatedAt: '2026-10-06T12:00:00Z' } });
    else if (body.action === 'saveJob') { saveStarted = true; await held; await ok(route, body.job); }
    else if (body.action === 'saveDraft') await ok(route, { job: body.draft.job, updatedAt: new Date().toISOString() });
  });
  await navigate(page, 'customer');
  await page.locator('#customer-customerName').fill('Saved snapshot');
  const save = page.getByRole('button', { name: 'Save job', exact: true });
  await save.click();
  await expect(save).toBeEnabled();
  await expect.poll(() => saveStarted).toBe(true);
  await page.locator('#customer-customerName').fill('Typed while syncing');
  release();
  await expect(page.locator('#customer-customerName')).toHaveValue('Typed while syncing');
  await expect(page.getByText('Draft synced', { exact: true })).toBeVisible();
  await page.reload();
  await navigate(page, 'customer');
  await expect(page.locator('#customer-customerName')).toHaveValue('Typed while syncing');
  expect(errors).toEqual([]);
});

test('a failed cloud request keeps the saved job without an uncaught UI error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await start(page, async (route, body) => {
    if (body.action === 'getDraft') await ok(route, { draft: { job, recordId: job.recordId, updatedAt: '2026-10-06T12:00:00Z' } });
    else await route.fulfill({ status: 503, body: 'Temporarily unavailable', headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.getByRole('button', { name: 'Save job', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save job', exact: true })).toBeEnabled();
  await expect(page.getByText('Retrying the connection automatically.', { exact: false })).toBeVisible();
  await expect(page.getByText('Recovered customer', { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

const intakeText = 'Customer Name: Uploaded customer\nClaim Number: OLD-CLAIM\nTotal Approved RCV: $12,000';
const intakePayload = {
  customer: { customerName: 'Uploaded customer' },
  insurance: { claimNumber: 'OLD-CLAIM' },
  financials: { totalApprovedRcv: 12000 },
  team: {},
  mortgage: {},
  changeOrder: {},
  productionNotes: {},
  checklist: {},
};
const aiResponse = (route: Route) => ok(route, intakePayload);
const intakeInput = (page: Page) => page.getByRole('textbox', { name: 'Or paste intake notes', exact: true });

test('OpenRouter free-model limits show a retry message without changing the current job', async ({ page }) => {
  await start(page, async (route, body) => {
    if (body.action === 'getDraft') await ok(route, { draft: { job, recordId: job.recordId, updatedAt: '2026-10-06T12:00:00Z' } });
    else if (body.action === 'saveDraft') await ok(route, { job: body.draft.job, updatedAt: new Date().toISOString() });
    else await ok(route, {});
  });
  await page.route(/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/, async route => {
    if (route.request().postDataJSON().action !== 'analyzeIntake') return route.fallback();
    await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: false, code: 'ai_rate_limited', error: 'OpenRouter free-model request limit reached. Wait and retry the estimate analysis.' }) });
  });
  await navigate(page, 'intake');
  await intakeInput(page).fill('Synthetic estimate for a new test customer. Approved RCV: $5,000.');
  await page.getByRole('button', { name: 'Analyze intake', exact: true }).click();
  await expect(page.getByText(/OpenRouter free-model request limit reached/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analyze intake', exact: true })).toBeEnabled();
  await navigate(page, 'customer');
  await expect(page.locator('#customer-customerName')).toHaveValue('Recovered customer');
});

async function openNewJob(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: 'New job', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Start New Restoration Job?' })).toBeVisible();
}

async function clearJob(page: Page) {
  await openNewJob(page);
  await page.getByRole('button', { name: 'Clear All Fields', exact: true }).click();
  await expect(page.getByText('New blank job created — not yet saved to the database.', { exact: true })).toBeVisible();
  await expect(intakeInput(page)).toHaveValue('');
  await expect(page.getByText('Job information updated', { exact: true })).toHaveCount(0);
  await navigate(page, 'customer');
  await expect(page.locator('#customer-customerName')).toHaveValue('');
  await navigate(page, 'intake');
}

for (const fileType of ['text', 'PDF'] as const) {
  test(`clearing a ${fileType} intake removes uploads and results, preserves cancellation, and survives reload`, async ({ page }) => {
    let serverDraft: any = { job, recordId: job.recordId, updatedAt: '2026-10-06T12:00:00Z' };
    let analyses = 0;
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.route(/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/, async (route) => {
      analyses++;
      await aiResponse(route);
    });
    await start(page, async (route, body) => {
      if (body.action === 'getDraft') await ok(route, { draft: serverDraft });
      else if (body.action === 'saveDraft') {
        serverDraft = { job: body.draft.job, recordId: body.draft.recordId, updatedAt: new Date().toISOString() };
        await ok(route, serverDraft);
      }
    });
    await navigate(page, 'intake');
    let buffer = Buffer.from(intakeText);
    if (fileType === 'PDF') {
      const pdf = await PDFDocument.create();
      const pdfPage = pdf.addPage();
      intakeText.split('\n').forEach((line, index) => pdfPage.drawText(line, { x: 40, y: 740 - index * 24, size: 12 }));
      buffer = Buffer.from(await pdf.save());
    }
    const file = { name: fileType === 'PDF' ? 'old-intake.pdf' : 'old-intake.txt', mimeType: fileType === 'PDF' ? 'application/pdf' : 'text/plain', buffer };
    await page.locator('input[type=file]').setInputFiles(file);
    await expect(page.getByText(file.name, { exact: true })).toBeVisible();
    await expect(page.getByText('Job information updated', { exact: true })).toBeVisible();
    await expect(intakeInput(page)).toHaveValue(/Uploaded customer/);

    await navigate(page, 'customer');
    await expect(page.locator('#customer-customerName')).toHaveValue('Uploaded customer');
    await expect(page.getByRole('button', { name: 'Review intake', exact: true })).toBeVisible();
    await expect(intakeInput(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Review intake', exact: true }).click();
    await expect(intakeInput(page)).toHaveValue(/Uploaded customer/);

    await openNewJob(page);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText(file.name, { exact: true })).toBeVisible();
    await expect(page.getByText('Job information updated', { exact: true })).toBeVisible();

    await clearJob(page);
    await expect(page.getByText(file.name, { exact: true })).toHaveCount(0);
    // Reload as soon as clearing completes, before the normal cloud autosave delay.
    await page.reload();
    await navigate(page, 'customer');
    await expect(page.locator('#customer-customerName')).toHaveValue('');
    await navigate(page, 'intake');
    await expect(intakeInput(page)).toHaveValue('');
    await expect(page.getByText(file.name, { exact: true })).toHaveCount(0);
    await expect.poll(() => serverDraft.job.customer.customerName).toBe('');
    expect(serverDraft.job.insurance.claimNumber).toBe('');
    expect(serverDraft.job.financials.totalApprovedRcv).toBe('');
    expect(serverDraft.job.recordId).not.toBe(job.recordId);

    // The same file can be uploaded again after clearing, with a fresh analysis.
    await page.locator('input[type=file]').setInputFiles(file);
    await navigate(page, 'customer');
    await expect(page.locator('#customer-customerName')).toHaveValue('Uploaded customer');
    expect(analyses).toBe(2);
    expect(errors).toEqual([]);
  });
}

for (const outcome of ['success', 'failure'] as const) {
  test(`edits made in another section survive a delayed intake ${outcome}`, async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route(/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/, async (route) => {
      await held;
      if (outcome === 'success') await aiResponse(route);
      else await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Test failure' } }) });
    });
    await start(page, async (route, body) => {
      if (body.action === 'getDraft') await ok(route, { draft: { job, recordId: job.recordId, updatedAt: '2026-10-06T12:00:00Z' } });
      else if (body.action === 'saveDraft') await ok(route, { job: body.draft.job, updatedAt: new Date().toISOString() });
    });
    await navigate(page, 'intake');
    await page.locator('input[type=file]').setInputFiles({ name: 'held-intake.txt', mimeType: 'text/plain', buffer: Buffer.from(intakeText) });
    await expect(page.getByRole('button', { name: 'Analyzing intake…', exact: true })).toBeVisible();
    await navigate(page, 'customer');
    await page.locator('#customer-mainPhone').fill('260-555-0188');
    release();
    await expect(page.locator('#customer-customerName')).toHaveValue(outcome === 'success' ? 'Uploaded customer' : 'Recovered customer');
    await expect(page.locator('#customer-mainPhone')).toHaveValue('260-555-0188');
    await page.getByRole('button', { name: 'Review intake', exact: true }).click();
    if (outcome === 'success') await expect(page.getByText('Job information updated', { exact: true })).toBeVisible();
    else await expect(page.getByRole('alert')).toContainText('Intake analysis failed');
    await expect(intakeInput(page)).toHaveValue(/Uploaded customer/);
  });
}

test('missing document fields lead directly to inputs and readiness updates across screens', async ({ page }) => {
  await page.route(/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/, aiResponse);
  await start(page, async (route, body) => {
    if (body.action === 'getDraft') await ok(route, { draft: { job, recordId: job.recordId, updatedAt: '2026-10-06T12:00:00Z' } });
    else if (body.action === 'saveDraft') await ok(route, { job: body.draft.job, updatedAt: new Date().toISOString() });
  });
  await navigate(page, 'intake');
  await page.locator('input[type=file]').setInputFiles({ name: 'review-intake.txt', mimeType: 'text/plain', buffer: Buffer.from(intakeText) });
  await expect(page.getByText('Job information updated', { exact: true })).toBeVisible();
  await navigate(page, 'documents');
  await expect(page.getByText('3 required fields to review', { exact: true })).toBeVisible();
  for (const field of [
    { label: 'Loss property address', id: 'customer-lossAddress', value: '123 Review Street' },
    { label: 'Insurance carrier', id: 'insurance-carrier', value: 'Review Carrier' },
    { label: 'Deductible', id: 'deductible-input', value: '500' },
  ]) {
    await page.getByRole('button', { name: field.label, exact: true }).click();
    await expect(page.locator(`#${field.id}`)).toBeFocused();
    await page.locator(`#${field.id}`).fill(field.value);
    await navigate(page, 'documents');
  }
  await expect(page.getByText('Required fields complete', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Missing required fields', { exact: true })).toHaveCount(0);
  await navigate(page, 'intake');
  await expect(page.getByText('Required information to confirm', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Required intake fields are complete.', { exact: false })).toBeVisible();
});

const libraryJobs = [
  { recordId: 'saved-1', customerName: 'Zulu customer', jobNumber: 'JOB-2', lossAddress: '2 Main Street', updatedAt: '2026-10-07T12:00:00Z' },
  { recordId: 'saved-2', customerName: 'Alpha customer', jobNumber: 'JOB-10', lossAddress: '10 Main Street', updatedAt: '2026-10-06T12:00:00Z' },
];

test('jobs can be searched and sorted, and Continue editing keeps current draft edits', async ({ page }) => {
  let loads = 0;
  await start(page, async (route, body) => {
    if (body.action === 'getDraft') await ok(route, { draft: { job, recordId: job.recordId, updatedAt: '2026-10-06T12:00:00Z' } });
    else if (body.action === 'getJob') { loads++; await ok(route, job); }
    else if (body.action === 'saveDraft') await ok(route, { job: body.draft.job, updatedAt: new Date().toISOString() });
  }, libraryJobs);
  const library = page.getByRole('region', { name: 'Jobs', exact: true });
  await expect(library.getByRole('listitem').first()).toContainText('Zulu customer');
  await library.getByLabel('Sort by', { exact: true }).selectOption('customer');
  await expect(library.getByRole('listitem').first()).toContainText('Alpha customer');
  await library.getByLabel('Sort by', { exact: true }).selectOption('number');
  await expect(library.getByRole('listitem').first()).toContainText('Zulu customer');
  await library.getByRole('searchbox', { name: 'Search jobs', exact: true }).fill('10 Main Street');
  await expect(library.getByRole('listitem')).toHaveCount(1);
  await expect(library.getByRole('listitem')).toContainText('Alpha customer');
  await library.getByRole('searchbox', { name: 'Search jobs', exact: true }).fill('no-match');
  await library.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(library.getByRole('listitem')).toHaveCount(2);
  await navigate(page, 'customer');
  await page.locator('#customer-mainPhone').fill('260-555-0199');
  await page.getByRole('button', { name: 'Open saved jobs', exact: true }).click();
  await library.getByRole('button', { name: /^Continue editing/ }).click();
  await expect(page.locator('#customer-mainPhone')).toHaveValue('260-555-0199');
  expect(loads).toBe(0);
});

test('phone and tablet navigation, form actions, and account menu fit the screen', async ({ page }) => {
  await start(page, async (route, body) => {
    if (body.action === 'getDraft') await ok(route, { draft: { job, recordId: job.recordId, updatedAt: '2026-10-06T12:00:00Z' } });
    else if (body.action === 'saveDraft') await ok(route, { job: body.draft.job, updatedAt: new Date().toISOString() });
  }, libraryJobs);
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await navigate(page, 'intake');
    await expect(page.getByRole('heading', { name: 'Bring in your job information' })).toBeVisible();
    await expect(page.getByRole('banner').getByRole('button', { name: 'New job', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save job', exact: true })).toBeVisible();
    await navigate(page, 'mortgage');
    await expect(page.getByRole('heading', { name: 'Mortgage & Lienholder', exact: true })).toBeVisible();
    await navigate(page, 'team');
    await expect(page.getByRole('heading', { name: 'Mortgage & Lienholder', exact: true })).toHaveCount(0);
    await navigate(page, 'home');
    await expect(page.getByRole('region', { name: 'Jobs', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const account = page.getByRole('button', { name: 'Account and connections', exact: true });
    await account.click();
    await expect(page.locator('#account-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#account-panel')).toHaveCount(0);
    await expect(account).toBeFocused();
  }
});

for (const outcome of ['success', 'failure'] as const) {
  test(`a delayed AI ${outcome} cannot restore an intake after clearing`, async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let analysisFinished = false;
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.route(/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/, async (route) => {
      await held;
      if (outcome === 'success') await aiResponse(route);
      else await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Test failure' } }) });
      analysisFinished = true;
    });
    await start(page, async (route, body) => {
      if (body.action === 'getDraft') await ok(route, { draft: { job, recordId: job.recordId, updatedAt: '2026-10-06T12:00:00Z' } });
      else if (body.action === 'saveDraft') await ok(route, { job: body.draft.job, updatedAt: new Date().toISOString() });
    });
    await navigate(page, 'intake');
    await page.locator('input[type=file]').setInputFiles({ name: 'pending-intake.txt', mimeType: 'text/plain', buffer: Buffer.from(intakeText) });
    await expect(page.getByRole('button', { name: 'Analyzing intake…', exact: true })).toBeVisible();
    // Moving through job sections must not discard an analysis in progress.
    await navigate(page, 'customer');
    await expect(page.getByText('Analyzing intake', { exact: false }).last()).toBeVisible();
    await clearJob(page);
    release();
    await expect.poll(() => analysisFinished).toBe(true);
    // Allow response parsing and the fallback path to finish before checking the form.
    await page.waitForTimeout(200);
    await expect(intakeInput(page)).toHaveValue('');
    await expect(page.getByText('Job information updated', { exact: true })).toHaveCount(0);
    await expect(page.getByText('pending-intake.txt', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Analyze intake', exact: true })).toBeDisabled();
    await navigate(page, 'customer');
    await expect(page.locator('#customer-customerName')).toHaveValue('');
    expect(errors).toEqual([]);
  });
}
