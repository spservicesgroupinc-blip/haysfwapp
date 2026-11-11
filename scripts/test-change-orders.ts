import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
import { createEmptyJob, ensureRecordDefaults } from '../src/types/jobData';
import { calculateChangeOrder, recordChangeOrder } from '../src/services/changeOrders';
import { generateChangeOrder, generateCompletePacket } from '../src/services/pdfService';
import { DOC } from '../src/services/documentCatalog';

function initialJob() {
  const job = createEmptyJob();
  job.financials.totalApprovedRcv = 10000;
  job.changeOrder.scopeDescription = 'Additional repairs';
  job.changeOrder.changeAmount = 1250.15;
  return job;
}

test('successive increases, decreases and no-cost changes carry forward in cents', () => {
  let job = initialJob();
  assert.deepEqual(calculateChangeOrder(job), { original: 10000, previous: 0, prior: 10000, adjustment: 1250.15, total: 11250.15, amount: 1250.15 });
  job = recordChangeOrder(job);
  assert.equal(job.changeOrder.changeOrderNumber, 'CO-02');
  assert.equal(job.changeOrderHistory!.length, 1);
  Object.assign(job.changeOrder, { scopeDescription: 'Remove work', changeType: 'decrease', changeAmount: 250.05 });
  assert.deepEqual(calculateChangeOrder(job), { original: 10000, previous: 1250.15, prior: 11250.15, adjustment: -250.05, total: 11000.1, amount: 250.05 });
  job = recordChangeOrder(job);
  Object.assign(job.changeOrder, { scopeDescription: 'Extend schedule', changeType: 'unchanged', changeAmount: 999, addedDays: 5 });
  assert.equal(calculateChangeOrder(job).adjustment, 0);
  assert.equal(calculateChangeOrder(job).total, 11000.1);
  job = recordChangeOrder(job);
  assert.equal(job.changeOrder.changeOrderNumber, 'CO-04');
  assert.equal(job.changeOrderHistory![2].changeAmount, 0);
  assert.equal(calculateChangeOrder(job).previous, 1000.1);
  // Later RCV and intake edits cannot rewrite the original signed base or history.
  job.financials.totalApprovedRcv = 50000;
  job.changeOrder.originalContractSum = 70000;
  job.changeOrder.netPreviousChanges = 90000;
  assert.equal(calculateChangeOrder(job).original, 10000);
  assert.equal(calculateChangeOrder(job).total, 11000.1);
  job = ensureRecordDefaults(JSON.parse(JSON.stringify(job)));
  assert.equal(calculateChangeOrder(job).total, 11000.1);
  assert.equal(job.changeOrderHistory!.length, 3);
});

test('legacy opening balances, zero originals and legacy signed magnitudes are handled', () => {
  let job = initialJob();
  job.changeOrder.changeType = 'decrease';
  job.changeOrder.changeAmount = 0;
  assert.equal(Object.is(calculateChangeOrder(job).adjustment, -0), false, 'Zero credits must display $0.00 without a negative sign');
  Object.assign(job.changeOrder, { originalContractSum: 0, netPreviousChanges: 500, changeType: 'decrease', changeAmount: -100 });
  assert.equal(calculateChangeOrder(job).total, 400);
  job.changeOrder.changeAmount = 100;
  job = recordChangeOrder(job);
  assert.equal(calculateChangeOrder(job).original, 0);
  assert.equal(calculateChangeOrder(job).previous, 400);
  job.changeOrder.changeAmount = 0.1;
  job.changeOrder.scopeDescription = 'Small change';
  job = recordChangeOrder(job);
  job.changeOrder.changeAmount = 0.2;
  assert.equal(calculateChangeOrder(job).total, 400.3);
});

test('incomplete, duplicate, negative and non-finite orders cannot be recorded', () => {
  const job = initialJob();
  job.changeOrder.scopeDescription = '';
  assert.throws(() => recordChangeOrder(job), /scope/);
  job.changeOrder.scopeDescription = 'Repairs';
  job.changeOrder.changeAmount = -1;
  assert.throws(() => recordChangeOrder(job), /non-negative/);
  job.changeOrder.changeAmount = Infinity;
  assert.throws(() => recordChangeOrder(job), /finite/);
  job.changeOrder.changeAmount = 10001;
  job.changeOrder.changeType = 'decrease';
  assert.throws(() => recordChangeOrder(job), /negative/);
  job.changeOrder.changeType = 'increase';
  job.changeOrder.changeAmount = 10;
  const next = recordChangeOrder(job);
  next.changeOrder.changeOrderNumber = 'co-01';
  next.changeOrder.scopeDescription = 'Duplicate';
  assert.throws(() => recordChangeOrder(next), /already recorded/);
  assert.equal(job.changeOrderHistory, undefined, 'Recording never mutates its input');
});

async function pageText(bytes: Uint8Array, pageNumber: number) {
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: true }).promise;
  const content = await (await pdf.getPage(pageNumber)).getTextContent();
  const result = content.items.map((item: any) => item.str || '').join(' ').replace(/\s+/g, ' ');
  await pdf.destroy();
  return result;
}

test('standalone and combined PDFs agree with cumulative totals; reprints do not double count', async () => {
  let job = recordChangeOrder(initialJob());
  Object.assign(job.changeOrder, { scopeDescription: 'Credit', changeType: 'decrease', changeAmount: 250.05 });
  const before = JSON.stringify(job);
  const checkLines = (text: string) => {
    assert.match(text, /original contract sum was:.*?\$10,000\.00/);
    assert.match(text, /previous authorized change orders:.*?\$1,250\.15/);
    assert.match(text, /prior to this change was:.*?\$11,250\.15/);
    assert.match(text, /new contract sum including this change order will be:.*?\$11,000\.10/);
  };
  checkLines(await pageText(await generateChangeOrder(job), 1));
  checkLines(await pageText(await generateChangeOrder(job), 1));
  checkLines(await pageText(await generateCompletePacket(job), 7));
  assert.equal(JSON.stringify(job), before, 'PDF generation never records the order');
  const firstName = DOC.changeOrder.buildFileName({ ...job, changeOrder: job.changeOrderHistory![0], changeOrderHistory: [] });
  assert.notEqual(firstName, DOC.changeOrder.buildFileName(job));
  job = recordChangeOrder(job);
  job.financials.totalApprovedRcv = 99999;
  const first = job.changeOrderHistory![0];
  const reprint = { ...job, changeOrder: first, changeOrderHistory: [] };
  assert.match(await pageText(await generateChangeOrder(reprint), 1), /new contract sum including this change order will be:.*?\$11,250\.15/);
  Object.assign(job.changeOrder, { changeType: 'unchanged', changeAmount: 999 });
  assert.match(await pageText(await generateChangeOrder(job), 1), /new contract sum including this change order will be:.*?\$11,000\.10/);
});
