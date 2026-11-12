import { test, expect, type Page, type Route } from '@playwright/test';
import { SAMPLE_WATER } from './fixtures';
import type { WorkspaceEntity } from '../src/types/jobWorkspace';

const user = { email: 'staff@example.com', name: 'Staff Member', role: 'editor' };
const ok = (route: Route, data: unknown) => route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, data }) });
const job = { ...structuredClone(SAMPLE_WATER), recordId: 'dashboard-job', customer: { ...SAMPLE_WATER.customer, jobNumber: 'DASH-1', customerName: 'Dashboard Customer' }, changeOrder: { ...SAMPLE_WATER.changeOrder, scopeDescription: '', changeAmount: '' as const, netPreviousChanges: 0 } };

async function start(page: Page, role = 'editor', savedJob = job) {
  const entities = new Map<string, WorkspaceEntity>();
  const activity: any[] = [];
  let conflict = false;
  let draft: any = null;
  let writes = 0;
  const account = { ...user, role };
  await page.addInitScript(account => localStorage.setItem('hays.db.session', JSON.stringify({ token: 'ui-session', expiresAt: '2099-01-01T00:00:00Z', user: account })), account);
  await page.route(/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/, async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'checkSession') return ok(route, { user: account });
    if (body.action === 'listJobs') return ok(route, [{ recordId: job.recordId, jobNumber: 'DASH-1', customerName: job.customer.customerName, updatedAt: '2026-11-11T12:00:00Z', status: 'Active' }]);
    if (body.action === 'getJob') return ok(route, savedJob);
    if (body.action === 'getDraft') return ok(route, { draft });
    if (body.action === 'getCustomerReference') return ok(route, { customers: [], fileName: '', updatedAt: '', updatedBy: '' });
    if (body.action === 'saveDraft') { draft = { job: body.draft.job, recordId: body.draft.recordId, updatedAt: new Date().toISOString() }; return ok(route, draft); }
    if (body.action === 'saveJob') return ok(route, { job: body.job, recordId: body.job.recordId, updatedAt: new Date().toISOString() });
    if (body.action === 'listAssignableStaff') return ok(route, { staff: [{ email: user.email, name: user.name }] });
    if (body.action === 'getJobWorkspace') return ok(route, { entities: [...entities.values()], activity, totalEntities: entities.size, totalActivity: activity.length, fetchedAt: new Date().toISOString() });
    if (body.action === 'mutateJobWorkspace') {
      writes++;
      if (conflict) { conflict = false; const old = entities.get(body.id)!; entities.set(body.id, { ...old, revision: old.revision + 1, data: { ...old.data, title: 'Cloud updated title' } }); return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'conflict', error: 'This entry changed on another device.' }) }); }
      const data = { ...body.data };
      if (body.kind === 'changeOrder' && data.status === 'Approved') {
        const baseline = entities.get('contract')!.data;
        data.originalCents = baseline.originalCents; data.previousCents = baseline.openingCents;
        data.approvedBy = user.email; data.approvedAt = new Date().toISOString();
      }
      const entity = { id: body.id, kind: body.kind, recordId: body.recordId, revision: body.expectedRevision + 1, updatedAt: new Date().toISOString(), updatedBy: user.email, data };
      entities.set(body.id, entity);
      activity.unshift({ id: body.operationId, at: entity.updatedAt, actor: user.email, detail: `${data.title || data.number || body.kind} saved` });
      return ok(route, entity);
    }
    return ok(route, {});
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open job DASH-1', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard Customer', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log an issue', exact: true })).toHaveCount(role === 'viewer' ? 0 : 1);
  if (role !== 'viewer') await expect(page.getByRole('button', { name: 'Log an issue', exact: true })).toBeVisible();
  return { entities, setConflict: () => { conflict = true; }, writes: () => writes };
}
const dashboardNav = (page: Page) => page.getByRole('navigation', { name: 'Customer dashboard', exact: true });

test('customer dashboard logs assigned issues, comments, completion and activity', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const state = await start(page);
  await page.getByRole('button', { name: 'Log an issue', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Resolve customer cabinet concern');
  await page.getByLabel('Assigned to', { exact: true }).selectOption(user.email);
  await page.getByLabel('Due date', { exact: true }).fill('2026-01-01');
  await page.getByRole('button', { name: 'Save work item', exact: true }).click();
  const item = page.getByRole('button').filter({ hasText: 'Resolve customer cabinet concern' });
  await expect(item).toBeVisible();
  await item.click();
  await page.getByLabel('Add a comment', { exact: true }).fill('Confirmed finish selection with customer.');
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(page.getByLabel('Add a comment', { exact: true })).toHaveValue('');
  await expect(page.getByText('Confirmed finish selection with customer.', { exact: true })).toBeVisible();
  await page.getByLabel('Status', { exact: true }).selectOption('Done');
  await page.getByRole('button', { name: 'Save work item', exact: true }).click();
  await expect(item).toHaveCount(0);
  await page.getByLabel('Status filter', { exact: true }).selectOption('Done');
  await expect(item).toBeVisible();
  await dashboardNav(page).getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Job activity' })).toContainText('Resolve customer cabinet concern saved');
  expect(state.entities.size).toBe(2);
  await page.screenshot({ path: info.outputPath('customer-activity-desktop.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('contract review and approval update totals and selected PDF without mutating legacy form', async ({ page }) => {
  await start(page, 'editor', { ...job, changeOrderHistory: [{ ...job.changeOrder, id: 'old-order', recordedAt: '2026-10-01T12:00:00Z',
    changeOrderNumber: 'CO-OLD', originalContractSum: 50000, netPreviousChanges: 0, changeAmount: 1000, scopeDescription: 'Legacy work' }] });
  await dashboardNav(page).getByRole('button', { name: 'Change Orders', exact: true }).click();
  await page.getByRole('button', { name: 'Review contract', exact: true }).click();
  await page.getByLabel('Original contract amount', { exact: true }).fill('10000');
  await page.getByLabel('Approved opening adjustment (+/−)', { exact: true }).fill('500');
  await page.getByRole('button', { name: 'Confirm opening balance', exact: true }).click();
  await expect(page.getByText('Verified contract position', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New change order', exact: true }).click();
  await page.getByLabel('Change Amount', { exact: true }).fill('250');
  await page.getByLabel('Scope Description', { exact: true }).fill('Additional cabinet work');
  await page.getByRole('button', { name: 'Save draft change', exact: true }).click();
  await expect(page.getByRole('button').filter({ hasText: 'Additional cabinet work' })).toBeVisible();
  await page.getByRole('button').filter({ hasText: 'Additional cabinet work' }).click();
  await page.getByRole('button', { name: 'Approve change', exact: true }).click();
  await expect(page.getByText('$10,750.00', { exact: true }).first()).toBeVisible();
  await page.getByRole('button').filter({ hasText: 'Additional cabinet work' }).click();
  await page.getByRole('button', { name: 'Preview CO-01 PDF', exact: true }).click();
  const modal = page.locator('div.fixed.inset-0.z-50').filter({ has: page.getByTitle('Close modal') });
  await expect(modal.locator('canvas')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await modal.getByTitle('Download PDF', { exact: true }).click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(Buffer.concat(chunks)), isEvalSupported: false, useSystemFonts: true }).promise;
  const text = (await (await pdf.getPage(1)).getTextContent()).items.map((item: any) => item.str || '').join(' ');
  expect(text).toContain('10,750.00');
  expect(text).toContain('Additional cabinet work');
  await modal.getByTitle('Close modal').click();
  await dashboardNav(page).getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(page.locator('strong').filter({ hasText: 'CO-01 (Approved)' })).toBeVisible();
  const packetDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download packet', exact: true }).click();
  const packetStream = await (await packetDownload).createReadStream();
  const packetChunks: Buffer[] = [];
  for await (const chunk of packetStream) packetChunks.push(Buffer.from(chunk));
  const packet = await pdfjs.getDocument({ data: new Uint8Array(Buffer.concat(packetChunks)), isEvalSupported: false, useSystemFonts: true }).promise;
  const packetChange = (await (await packet.getPage(7)).getTextContent()).items.map((item: any) => item.str || '').join(' ');
  expect(packetChange).toContain('10,750.00');
  expect(packetChange).not.toContain('50,000.00');
});

test('offline tasks survive reload and replay once after reconnect', async ({ page, context }) => {
  const state = await start(page);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Create a task', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Offline follow-up');
  await page.getByRole('button', { name: 'Save work item', exact: true }).click();
  await expect(page.getByText('Saved on this device. Waiting to sync.', { exact: true })).toBeVisible();
  // Vite's dev shell is not service-worker cached; restore connectivity for its reload,
  // then inspect the IndexedDB-restored work before waiting for cloud replay.
  await context.setOffline(false);
  await page.reload();
  await page.getByRole('button', { name: /^(Open job|Continue editing) DASH-1$/ }).click();
  await dashboardNav(page).getByRole('button', { name: 'Tasks & Issues', exact: true }).click();
  await expect(page.getByRole('button').filter({ hasText: 'Offline follow-up' })).toBeVisible();
  await expect.poll(() => state.entities.size).toBe(1);
  expect(state.writes()).toBe(1);
});

test('a task with a failed network response stays durable without inviting a duplicate submission', async ({ page }) => {
  const state = await start(page);
  let fail = true;
  await page.route(/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/, route => {
    if (route.request().postDataJSON().action === 'mutateJobWorkspace' && fail) return route.abort('failed');
    return route.fallback();
  });
  await page.getByRole('button', { name: 'Create a task', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Recover this saved task');
  await page.getByRole('button', { name: 'Save work item', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save work item', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button').filter({ hasText: 'Recover this saved task' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sync now', exact: true })).toBeVisible();
  fail = false;
  await expect.poll(() => state.entities.size, { timeout: 10000 }).toBe(1);
  expect(state.writes()).toBe(1);
});

test('concurrent task edits keep local text for explicit reconciliation', async ({ page }) => {
  const state = await start(page);
  await page.getByRole('button', { name: 'Create a task', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Original task');
  await page.getByRole('button', { name: 'Save work item', exact: true }).click();
  await page.getByRole('button').filter({ hasText: 'Original task' }).click();
  state.setConflict();
  await page.getByLabel('Title', { exact: true }).fill('My concurrent edit');
  await page.getByRole('button', { name: 'Save work item', exact: true }).click();
  const conflict = page.getByRole('region', { name: 'Saved change needs review', exact: true });
  await expect(conflict).toContainText('My concurrent edit');
  await expect(conflict).toContainText('Cloud updated title');
  await conflict.getByRole('button', { name: 'Reapply my version', exact: true }).click();
  await expect(conflict).toHaveCount(0);
  await expect.poll(() => [...state.entities.values()][0].data.title).toBe('My concurrent edit');
});

test('viewer can read dashboard but cannot create or approve work', async ({ page }) => {
  await start(page, 'viewer');
  await dashboardNav(page).getByRole('button', { name: 'Tasks & Issues', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New task or issue', exact: true })).toHaveCount(0);
  await dashboardNav(page).getByRole('button', { name: 'Change Orders', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review contract', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New change order', exact: true })).toHaveCount(0);
});

test('customer dashboard and task forms reflow on narrow phones', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await start(page);
  await page.screenshot({ path: info.outputPath('customer-dashboard-mobile.png'), fullPage: true });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Log an issue', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('A long issue title that needs to wrap comfortably on a small mobile phone');
  await page.screenshot({ path: info.outputPath('customer-task-mobile.png'), fullPage: true });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
