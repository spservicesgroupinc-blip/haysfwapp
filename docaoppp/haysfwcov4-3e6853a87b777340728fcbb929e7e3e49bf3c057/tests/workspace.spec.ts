import { test, expect, type Page, type Download } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist';
import JSZip from 'jszip';
import { mockBackend } from './helpers/backend';
import { createWorkspace } from '../src/workspaces/model';
import { createRequest } from '../src/services/requests';
import { requestFromWorkspace } from '../src/workspaces/model';
import { customerDocumentFingerprint } from '../src/services/customerDocument';
import type { Workspace } from '../src/workspaces/types';

function job(name = 'Workspace Customer', number = 'FW-TEST-1') {
  const workspace = createWorkspace();
  Object.assign(workspace.record.customer, { customerName: name, jobNumber: number, lossAddress: '101 Test Street, Fort Wayne, IN 46802', mainPhone: '260-555-0123', email: 'test@example.com' });
  workspace.record.financials.totalApprovedRcv = 1200.02;
  workspace.originalContract = '1000.01';
  workspace.previousChanges = '-20.05';
  return workspace;
}

async function sandbox(page: Page, workspaces: Workspace[] = []) {
  const backend = mockBackend();
  for (const workspace of workspaces) {
    const result = backend.post({ action: 'saveWorkspace', workspace, expectedRevision: 0, mutationId: `seed-${workspace.id}` });
    expect(result.ok, result.error).toBe(true);
  }
  const calls: Record<string, any>[] = [];
  const control = { failSaves: false, loseSaveResponse: false };
  // No fetch/XHR outside localhost can escape to a real Apps Script deployment.
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
    if (local && !url.pathname.includes('__api__')) return route.continue();
    if (!['fetch', 'xhr'].includes(request.resourceType()) && !url.pathname.includes('__api__')) return route.abort();
    const body = request.method() === 'POST' ? JSON.parse(request.postData() || '{}') : Object.fromEntries(url.searchParams);
    calls.push(structuredClone(body));
    if (control.failSaves && ['saveWorkspace', 'saveJobDocument'].includes(body.action)) return route.abort('failed');
    const result = request.method() === 'POST' ? backend.post(body) : backend.get(body);
    if (control.loseSaveResponse && body.action === 'saveWorkspace') { control.loseSaveResponse = false; return route.abort('failed'); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  return { backend, calls, control };
}

async function openJob(page: Page, workspace: Workspace) {
  await page.goto(`/#/workspaces/${workspace.id}`);
  await page.getByRole('button', { name: 'Job Details', exact: true }).click();
  await expect(page.getByLabel('Customer name', { exact: false })).toHaveValue(workspace.record.customer.customerName);
}

async function sync(page: Page) {
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.locator('.workspace-sync')).toContainText('Saved to shared workspace');
}

async function downloadBytes(download: Download) {
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFile(path!);
}

async function pdfText(bytes: Uint8Array) {
  const document = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let index = 1; index <= document.numPages; index++) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => 'str' in item ? item.str : '').join(' '));
  }
  await document.destroy();
  return pages.join('\n');
}

test('a new job saves exact financial details and survives reload', async ({ page }) => {
  const { backend } = await sandbox(page);
  await page.goto('/#/workspaces');
  await page.getByRole('button', { name: 'New job', exact: true }).click();
  await page.getByLabel('Customer name', { exact: false }).fill('Created Customer');
  await page.getByRole('textbox', { name: 'Job number*', exact: true }).fill('FW-NEW-1');
  await page.getByLabel('Loss address', { exact: false }).fill('200 New Street');
  await page.locator('summary').filter({ hasText: /^Financials$/ }).click();
  await page.getByLabel('Original contract amount').fill('1000.01');
  await page.getByLabel('Previous authorized changes').fill('-20.05');
  await page.getByLabel('Total approved RCV').fill('1200.02');
  await sync(page);
  const saved = backend.post({ action: 'listWorkspaces' }).workspaces;
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ originalContract: '1000.01', previousChanges: '-20.05', record: { financials: { totalApprovedRcv: 1200.02 } } });
  await page.reload();
  await expect(page.getByLabel('Customer name', { exact: false })).toHaveValue('Created Customer');
  await page.locator('summary').filter({ hasText: /^Financials$/ }).click();
  await expect(page.getByLabel('Original contract amount')).toHaveValue('1000.01');
  await mkdir('tmp', { recursive: true });
  await page.screenshot({ path: 'tmp/workspace-desktop.png', fullPage: true });
});

test('opening a saved job refreshes another device edits into the form', async ({ page }) => {
  const workspace = job();
  const { backend } = await sandbox(page, [workspace]);
  await openJob(page, workspace);
  await page.getByRole('button', { name: '← Jobs & Documents', exact: true }).click();
  const remote = backend.post({ action: 'openWorkspace', workspaceId: workspace.id }).workspace;
  remote.record.customer.customerName = 'Other device correction';
  expect(backend.post({ action: 'saveWorkspace', workspace: remote, expectedRevision: remote.revision, mutationId: 'remote-edit' }).ok).toBe(true);
  await page.getByRole('button', { name: /Workspace Customer/ }).click();
  await expect(page.getByLabel('Customer name', { exact: false })).toHaveValue('Other device correction');
});

test('failed sync keeps device edits across reload and lost responses retry one mutation', async ({ page }) => {
  const workspace = job();
  const { backend, control, calls } = await sandbox(page, [workspace]);
  await openJob(page, workspace);
  control.failSaves = true;
  await page.getByLabel('Customer name', { exact: false }).fill('Durable offline edit');
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.locator('.workspace-sync')).toContainText('sync needs attention');
  await page.reload();
  await expect(page.getByLabel('Customer name', { exact: false })).toHaveValue('Durable offline edit');
  expect(backend.post({ action: 'openWorkspace', workspaceId: workspace.id }).workspace.record.customer.customerName).toBe('Workspace Customer');
  control.failSaves = false;
  control.loseSaveResponse = true;
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect.poll(() => backend.post({ action: 'openWorkspace', workspaceId: workspace.id }).workspace.revision).toBe(2);
  await sync(page);
  const attempts = calls.filter(call => call.action === 'saveWorkspace');
  expect(new Set(attempts.map(call => call.mutationId)).size).toBe(1);
  expect(backend.post({ action: 'openWorkspace', workspaceId: workspace.id }).workspace.revision).toBe(2);
});

test('PDF preview edits persist into actual saved bytes and history retains the older version', async ({ page }) => {
  test.setTimeout(90000);
  const workspace = job();
  const { backend } = await sandbox(page, [workspace]);
  await openJob(page, workspace);
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  const card = page.locator('.workspace-document-card').filter({ has: page.getByRole('heading', { name: 'Customer Welcome Letter', exact: true }) });
  await card.getByRole('button', { name: 'Preview / edit', exact: true }).click();
  await page.getByTitle('Show all editable fields').click();
  await page.getByRole('button', { name: 'Customer Name Workspace Customer', exact: true }).click();
  const editor = page.locator('input:focus');
  await editor.fill('PDF Edited Customer');
  await editor.press('Enter');
  await expect(page.getByRole('heading', { name: 'PDF Edited Customer', exact: true })).toBeVisible();
  await page.getByTitle('Close modal', { exact: true }).click();
  await card.getByRole('button', { name: 'Save to job', exact: true }).click();
  await expect.poll(() => backend.post({ action: 'listJobDocuments', workspaceId: workspace.id }).documents.length).toBe(1);
  const first = backend.post({ action: 'listJobDocuments', workspaceId: workspace.id }).documents[0];
  const stored = backend.files.get(first.driveFileId);
  expect(await pdfText(Uint8Array.from(stored.bytes))).toContain('PDF Edited Customer');
  await page.getByRole('button', { name: 'Job Details', exact: true }).click();
  await expect(page.getByLabel('Customer name', { exact: false })).toHaveValue('PDF Edited Customer');
  await page.getByLabel('Customer name', { exact: false }).fill('Later Job Customer');
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await card.getByRole('button', { name: 'Save to job', exact: true }).click();
  await expect.poll(() => backend.post({ action: 'listJobDocuments', workspaceId: workspace.id }).documents.length).toBe(2);
  await expect(page.getByRole('button', { name: /Earlier job details/ })).toBeVisible();
  expect(await pdfText(Uint8Array.from(stored.bytes))).toContain('PDF Edited Customer');
  await page.reload();
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(page.locator('.workspace-panel').filter({ has: page.getByRole('heading', { name: 'Saved document history' }) }).locator('.workspace-list-row')).toHaveCount(2);
});

test('combined packet and ZIP contain seven production forms with eight PDF pages without a request', async ({ page }) => {
  test.setTimeout(90000);
  const workspace = job();
  await sandbox(page, [workspace]);
  await openJob(page, workspace);
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  const packetDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Combined packet', exact: true }).click();
  const bytes = await downloadBytes(await packetDownload);
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(8);
  expect(await pdfText(bytes)).toContain('Workspace Customer');
  const zipDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download ZIP', exact: true }).click();
  const archive = await JSZip.loadAsync(await downloadBytes(await zipDownload));
  const names = Object.keys(archive.files);
  expect(names).toHaveLength(8);
  expect(names.some(name => name.includes('Change_Order'))).toBe(false);
  const combined = names.find(name => name.startsWith('00_'))!;
  expect((await PDFDocument.load(await archive.files[combined].async('uint8array'))).getPageCount()).toBe(8);
});

for (const original of ['1000.01', '0', '']) test(`new request preserves original contract ${JSON.stringify(original)} separately from approved RCV and credit`, async ({ page }) => {
  const workspace = job(); workspace.originalContract = original;
  const { backend } = await sandbox(page, [workspace]);
  await openJob(page, workspace);
  await page.getByRole('button', { name: 'New change request', exact: true }).click();
  await expect(page.getByLabel('Customer / job')).toHaveValue('Workspace Customer — FW-TEST-1');
  await page.getByLabel('What changed?', { exact: true }).fill('Credit unused wall material');
  await page.getByLabel('Yes, customer credits', { exact: true }).check();
  await page.getByRole('button', { name: 'Minus — deduction', exact: true }).click();
  await page.getByLabel('Known change amount', { exact: true }).fill('0.19');
  await page.getByRole('button', { name: 'Send to estimating', exact: true }).click();
  await expect.poll(() => backend.get({ action: 'listRequests' }).requests.length).toBe(1);
  const summary = backend.get({ action: 'listRequests' }).requests[0];
  const request = backend.get({ action: 'openRequest', id: summary.id }).request;
  expect(request).toMatchObject({ workspaceId: workspace.id, customerCredits: true, knownChangeAmount: '-0.19', job: { originalContract: original ? Number(original).toFixed(2) : '', previousChanges: '-20.05', customer: 'Workspace Customer' } });
  expect(request.job.originalContract).not.toBe('1200.02');
});

test('a second change request continues from every earlier change order', async ({ page }) => {
  const workspace = job();
  const { backend } = await sandbox(page, [workspace]);
  const first = createRequest();
  first.workspaceId = workspace.id;
  Object.assign(first.job, {
    customer: workspace.record.customer.customerName,
    jobNumber: workspace.record.customer.jobNumber,
    originalContract: workspace.originalContract,
    previousChanges: workspace.previousChanges,
    orderNumber: 'CO-01',
  });
  first.finalChangeOrder = { scope: 'First change', amount: '+100.00' };
  const seeded = backend.post({ action: 'saveRequest', request: first, expectedRevision: 0, mutationId: 'seed-first' });
  expect(seeded.ok, seeded.error).toBe(true);

  await openJob(page, workspace);
  await expect(page.getByRole('button', { name: 'Change Requests (1)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New change request', exact: true }).click();
  await expect(page.getByLabel('Customer / job')).toHaveValue('Workspace Customer — FW-TEST-1');
  await page.getByLabel('What changed?', { exact: true }).fill('Second change');
  await page.getByRole('button', { name: 'Send to estimating', exact: true }).click();
  await expect.poll(() => backend.get({ action: 'listRequests' }).requests.length).toBe(2);

  const summaries = backend.get({ action: 'listRequests' }).requests;
  const secondSummary = summaries.find((item: any) => item.id !== first.id);
  const second = backend.get({ action: 'openRequest', id: secondSummary.id }).request;
  expect(second).toMatchObject({
    workspaceId: workspace.id,
    job: { previousChanges: '79.95', orderNumber: 'CO-02' },
  });
});

test('connecting an existing request changes only its workspace metadata', async ({ page }) => {
  const workspace = job();
  const { backend } = await sandbox(page, [workspace]);
  const request = createRequest();
  request.job.customer = 'Historical Customer'; request.job.originalContract = '999.99';
  request.finalChangeOrder = { scope: 'Estimator corrected scope', amount: '-0.19' };
  const saved = backend.post({ action: 'saveRequest', request, expectedRevision: 0, mutationId: 'seed-request' });
  expect(saved.ok, saved.error).toBe(true);
  await page.goto(`/#/requests/${request.id}`);
  await page.getByRole('button', { name: 'Connect job details & documents', exact: true }).click();
  await page.getByLabel('Shared job', { exact: true }).selectOption(workspace.id);
  await page.getByRole('button', { name: 'Connect to job', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open job details & documents →', exact: true })).toBeVisible();
  const linked = backend.get({ action: 'openRequest', id: request.id }).request;
  expect(linked.workspaceId).toBe(workspace.id);
  expect(linked.job).toEqual(saved.request.job);
  expect(linked.finalChangeOrder).toEqual(saved.request.finalChangeOrder);
});

test('directory replacement preserves saved jobs and migration repeats skip imported entries', async ({ page }) => {
  const workspace = job();
  const { backend } = await sandbox(page, [workspace]);
  await openJob(page, workspace);
  expect(backend.post({ action: 'importJobs', jobs: [] }).ok).toBe(true);
  await page.getByRole('button', { name: '← Jobs & Documents', exact: true }).click();
  await expect(page.getByRole('button', { name: /Workspace Customer/ })).toBeVisible();
  const migrated = job('Migrated Customer', 'FW-MIGRATE-1');
  const exported = { version: 1, source: 'haysdocuments-2', exportedAt: '2026-10-17T12:00:00Z', jobs: [{ recordId: migrated.id, origin: 'remote', record: migrated.record }], drafts: [], pending: [] };
  const upload = { name: 'generator-export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) };
  await page.getByRole('button', { name: 'Import document jobs', exact: true }).click();
  await page.getByLabel('Generator export JSON').setInputFiles(upload);
  await page.getByRole('button', { name: 'Import selected entries', exact: true }).click();
  await expect(page.getByText('Saved on this device; cloud synchronization continues in the background.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: /Migrated Customer/ })).toBeVisible();
  await page.getByRole('button', { name: 'Import document jobs', exact: true }).click();
  await page.getByLabel('Generator export JSON').setInputFiles(upload);
  await expect(page.getByLabel('Destination for entry 1')).toHaveValue('skip');
  await page.getByRole('button', { name: 'Import selected entries', exact: true }).click();
  await expect(page.getByText('Skipped; existing job kept.', { exact: true })).toBeVisible();
  await expect.poll(() => backend.post({ action: 'listWorkspaces' }).workspaces.length).toBe(2);
});

test('duplicate job numbers require an explicit migration destination and mobile screens fit 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const first = job('First duplicate', 'FW-DUP');
  const second = job('Second duplicate', 'FW-DUP');
  await sandbox(page, [first, second]);
  await page.goto('/#/workspaces');
  await expect(page.getByRole('button', { name: /Second duplicate/ })).toBeVisible();
  await page.getByRole('button', { name: 'Import document jobs', exact: true }).click();
  const incoming = job('Incoming duplicate', 'FW-DUP');
  await page.getByLabel('Generator export JSON').setInputFiles({ name: 'duplicates.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, source: 'haysdocuments-2', jobs: [{ recordId: incoming.id, origin: 'remote', record: incoming.record }], drafts: [], pending: [] })) });
  await expect(page.getByLabel('Destination for entry 1')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Import selected entries', exact: true })).toBeDisabled();
  await page.getByLabel('Destination for entry 1').selectOption('skip');
  await page.getByRole('button', { name: 'Import selected entries', exact: true }).click();
  await expect(page.getByText('Skipped; existing job kept.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: /First duplicate/ }).click();
  await expect(page.getByLabel('Customer name', { exact: false })).toHaveValue('First duplicate');
  const overflow = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('body *')].filter(node => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.right > innerWidth + 1; }).map(node => ({ tag: node.tagName, className: node.className, width: node.getBoundingClientRect().width, right: node.getBoundingClientRect().right, text: node.textContent?.slice(0, 80) })).slice(0, 12));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), JSON.stringify(overflow)).toBe(true);
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir('tmp', { recursive: true });
  await page.screenshot({ path: 'tmp/workspace-mobile.png', fullPage: true });
});

test('a packet includes the exact saved customer change order and can be saved to its job', async ({ page }) => {
  test.setTimeout(90000);
  const workspace = job();
  const { backend } = await sandbox(page, [workspace]);
  let request = requestFromWorkspace(workspace);
  request.finalChangeOrder = { scope: 'Authorized custom scope', amount: '-0.19' };
  let result = backend.post({ action: 'saveRequest', request, expectedRevision: 0, mutationId: 'packet-request' });
  expect(result.ok, result.error).toBe(true);
  request = result.request;
  const document = await PDFDocument.create();
  document.addPage().drawText('Exact saved customer change order');
  const bytes = await document.save();
  const uploaded = backend.post({ action: 'uploadAttachment', requestId: request.id, attachmentId: 'packet-co', mutationId: 'packet-upload', file: { name: 'approved-co.pdf', mimeType: 'application/pdf', size: bytes.length, data: Buffer.from(bytes).toString('base64'), kind: 'document' } });
  expect(uploaded.ok, uploaded.error).toBe(true);
  request.attachments = [uploaded.attachment];
  request.customerDocument = { attachmentId: uploaded.attachment.id, inputFingerprint: await customerDocumentFingerprint(request), templateVersion: 1 };
  result = backend.post({ action: 'saveRequest', request, expectedRevision: request.revision, mutationId: 'packet-link' });
  expect(result.ok, result.error).toBe(true);
  await openJob(page, workspace);
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await page.getByLabel('Change order to include in packet').selectOption(request.id);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Combined packet', exact: true }).click();
  const combined = await downloadBytes(await downloading);
  expect((await PDFDocument.load(combined)).getPageCount()).toBe(9);
  expect(await pdfText(combined)).toContain('Exact saved customer change order');
  await page.getByRole('button', { name: 'Save packet to job', exact: true }).click();
  await expect.poll(() => backend.post({ action: 'listJobDocuments', workspaceId: workspace.id }).documents.length).toBe(1);
  const saved = backend.post({ action: 'listJobDocuments', workspaceId: workspace.id }).documents[0];
  expect(saved.kind).toBe('packet');
  expect(await pdfText(Uint8Array.from(backend.files.get(saved.driveFileId).bytes))).toContain('Exact saved customer change order');
});

test('the phone back gesture closes a job PDF preview before leaving the job', async ({ page }) => {
  const workspace = job();
  await sandbox(page, [workspace]);
  await openJob(page, workspace);
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  const card = page.locator('.workspace-document-card').filter({ has: page.getByRole('heading', { name: 'Customer Welcome Letter', exact: true }) });
  await card.getByRole('button', { name: 'Preview / edit', exact: true }).click();
  await expect(page.getByTitle('Close modal', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByTitle('Close modal', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Workspace Customer', exact: true })).toBeVisible();
  expect(new URL(page.url()).hash).toBe(`#/workspaces/${workspace.id}`);
});
