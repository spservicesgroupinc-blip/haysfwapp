/**
 * Offline test harness for the shared workspace draft in apps-script/Code.gs
 * (the Drafts sheet, plus saveDraft_/getDraft_).
 *
 * Loads Code.gs into a Node VM with an in-memory spreadsheet mock and asserts
 * that an in-progress record is written to - and read back from - the database
 * the app treats as its system of record, including the self-healing path taken
 * by a spreadsheet that has not been re-provisioned since the Drafts sheet was
 * added.
 *
 * Run with:  npm run apps:test:drafts
 */
import vm from 'node:vm';
import { loadAppsScriptSource } from './appsscript-source';
import { createEmptyJob } from '../src/types/jobData';
import { calculateChangeOrder, recordChangeOrder } from '../src/services/changeOrders';

const source = loadAppsScriptSource();

type Cell = unknown;

/** Chainable range stub: the provisioning code calls many fluent setters. */
function makeRange(sheet: FakeSheet, row: number, col: number, numRows: number, numCols: number) {
  const range: any = {
    getValues: () => {
      const out: Cell[][] = [];
      for (let r = 0; r < numRows; r++) {
        const line: Cell[] = [];
        for (let c = 0; c < numCols; c++) {
          line.push((sheet.rows[row - 1 + r] ?? [])[col - 1 + c] ?? '');
        }
        out.push(line);
      }
      return out;
    },
    setValues: (values: Cell[][]) => {
      for (let r = 0; r < values.length; r++) {
        const targetRow = row - 1 + r;
        while (sheet.rows.length <= targetRow) sheet.rows.push([]);
        for (let c = 0; c < values[r].length; c++) sheet.rows[targetRow][col - 1 + c] = values[r][c];
      }
      return range;
    },
    setValue: (value: Cell) => {
      while (sheet.rows.length < row) sheet.rows.push([]);
      sheet.rows[row - 1][col - 1] = value;
      return range;
    },
  };
  const noop = () => range;
  for (const method of [
    'setFontWeight',
    'setFontColor',
    'setBackground',
    'setVerticalAlignment',
    'setWrap',
    'setNumberFormat',
    'setFontSize',
  ]) {
    range[method] = noop;
  }
  return range;
}

class FakeSheet {
  rows: Cell[][];
  hidden: number[] = [];
  constructor(
    public name: string,
    headers: Cell[] = []
  ) {
    this.rows = headers.length ? [headers.slice()] : [];
  }
  getName() {
    return this.name;
  }
  getLastRow() {
    return this.rows.length;
  }
  getLastColumn() {
    return this.rows.reduce((max, r) => Math.max(max, r.length), 0);
  }
  getMaxRows() {
    return Math.max(this.rows.length, 200);
  }
  getFrozenRows() {
    return 1;
  }
  setFrozenRows() {}
  getDataRange() {
    return { getValues: () => this.rows.map((r) => r.slice()) };
  }
  getRange(row: number, col: number, numRows = 1, numCols = 1) {
    return makeRange(this, row, col, numRows, numCols);
  }
  appendRow(values: Cell[]) {
    this.rows.push(values.slice());
  }
  deleteRow(row: number) {
    this.rows.splice(row - 1, 1);
  }
  hideColumns(...cols: number[]) {
    this.hidden.push(...cols);
  }
  setColumnWidth() {}
  setRowHeight() {}
  clear() {
    this.rows = [];
  }
}

function createSandbox() {
  const properties: Record<string, string> = {
    SCHEMA_VERSION: '1',
    DB_SPREADSHEET_ID: 'FAKE_SPREADSHEET',
    DB_SHEET_NAME: 'Jobs',
    LOG_SHEET_NAME: 'AuditLog',
    USERS_SHEET_NAME: 'Users',
    SESSIONS_SHEET_NAME: 'Sessions',
  };

  const sandbox: any = {
    Logger: { log: () => {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => (k in properties ? properties[k] : null),
        setProperty: (k: string, v: string) => {
          properties[k] = v;
        },
      }),
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: () => ({ setMimeType: () => ({}) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'Code.gs' });
  return { sandbox, properties };
}

const { sandbox, properties } = createSandbox();
const call = <T = any>(fn: string, ...args: any[]): T => sandbox[fn](...args);

const DRAFT_HEADERS: string[] = sandbox.DRAFT_HEADERS;
const DRAFT_ROW_ID: string = sandbox.DRAFT_ROW_ID;

const sheets = new Map<string, FakeSheet>();
const makeSpreadsheet = () => ({
  getSheetByName: (name: string) => sheets.get(name) ?? null,
  insertSheet: (name: string) => {
    const sheet = new FakeSheet(name);
    sheets.set(name, sheet);
    return sheet;
  },
  getSheets: () => [...sheets.values()],
  getId: () => 'FAKE_SPREADSHEET',
  getUrl: () => 'https://docs.google.com/spreadsheets/d/FAKE_SPREADSHEET',
  deleteSheet: () => {},
});

sandbox.SpreadsheetApp = { openById: () => makeSpreadsheet(), create: () => makeSpreadsheet(), flush: () => {} };
sandbox.Utilities = { getUuid: () => 'deadbeef-0000-4000-8000-000000000001' };

let failures = 0;
function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  OK    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? `  -> ${detail}` : ''}`);
  }
}

const editor = { email: 'editor@haysandsons.com', role: 'editor' };
const viewer = { email: 'viewer@haysandsons.com', role: 'viewer' };

console.log('\n1. Drafts sheet is created on demand (spreadsheet not re-provisioned)');
check('no Drafts sheet to start with', !sheets.has('Drafts'), [...sheets.keys()].join(','));

const job = {
  recordId: 'rec-1',
  customer: { jobNumber: 'FW-2041', customerName: 'Ada Lovelace' },
  productionNotes: { notes: 'Drying phase 2' },
};

const saved = call<any>('saveDraft_', editor, { job, recordId: 'rec-1' });
const draftsSheet = sheets.get('Drafts');
check('Drafts sheet created', !!draftsSheet, [...sheets.keys()].join(','));
check('header row matches DRAFT_HEADERS', JSON.stringify(draftsSheet?.rows[0]) === JSON.stringify(DRAFT_HEADERS), JSON.stringify(draftsSheet?.rows[0]));
check('saveDraft_ returns updatedBy', saved?.updatedBy === editor.email, String(saved?.updatedBy));
check('one data row written', draftsSheet?.rows.length === 2, String(draftsSheet?.rows.length));

const row = draftsSheet!.rows[1];
check('row keyed on the fixed draft id', row[0] === DRAFT_ROW_ID, String(row[0]));
check('UpdatedAt is an ISO timestamp', typeof row[1] === 'string' && !Number.isNaN(Date.parse(String(row[1]))), String(row[1]));
check('RecordId column filled', row[3] === 'rec-1', String(row[3]));
check('JobNumber read from the nested record', row[4] === 'FW-2041', String(row[4]));
check('CustomerName read from the nested record', row[5] === 'Ada Lovelace', String(row[5]));
check('PayloadJson holds the record', JSON.parse(String(row[7])).productionNotes.notes === 'Drying phase 2');
check('DRAFT sheet property remembered', properties.DRAFTS_SHEET_NAME === 'Drafts', String(properties.DRAFTS_SHEET_NAME));

console.log('\n2. getDraft_ round-trips the record');
const fetched = call<any>('getDraft_', viewer);
check('viewer can read the shared draft', !!fetched, String(fetched));
check('payload survives the round trip', fetched?.job?.productionNotes?.notes === 'Drying phase 2', JSON.stringify(fetched?.job?.productionNotes));
check('last writer recorded', fetched?.updatedBy === editor.email, String(fetched?.updatedBy));

console.log('\n3. Saving again updates the single row (no duplicates)');
call<any>('saveDraft_', editor, { job: { ...job, productionNotes: { notes: 'Drying complete' } }, recordId: 'rec-1' });
check('still exactly one data row', sheets.get('Drafts')!.rows.length === 2, String(sheets.get('Drafts')!.rows.length));
check('payload replaced', call<any>('getDraft_', editor)?.job?.productionNotes?.notes === 'Drying complete');

console.log('\n4. Guards');
let viewerWriteError = '';
try {
  call<any>('saveDraft_', viewer, { job, recordId: 'rec-1' });
} catch (err: any) {
  viewerWriteError = err?.code ?? '';
}
check('viewer cannot write the draft', viewerWriteError === 'forbidden', viewerWriteError);

let badPayloadError = '';
try {
  call<any>('saveDraft_', editor, {});
} catch (err: any) {
  badPayloadError = err?.code ?? '';
}
check('missing payload rejected', badPayloadError === 'bad_request', badPayloadError);

let oversizedError = '';
try {
  call<any>('saveDraft_', editor, { job: { productionNotes: { notes: 'x'.repeat(50000) } } });
} catch (err: any) {
  oversizedError = err?.code ?? '';
}
check('over the 50k cell limit rejected', oversizedError === 'record_too_large', oversizedError);

console.log('\n5. Empty workspace reads as null');
sheets.set('Drafts', new FakeSheet('Drafts', DRAFT_HEADERS));
check('no draft row -> null', call<any>('getDraft_', editor) === null, String(call<any>('getDraft_', editor)));

console.log('\n6. Write handlers are routed by handleAction_');
const routed: string[] = [];
for (const action of ['saveDraft', 'getDraft', 'saveJob', 'deleteJob', 'listJobs', 'ping']) {
  routed.push(action);
}
const unknownActionSource = source.includes("throw appError_('unknown_action'");
check('unknown actions still rejected', unknownActionSource);
check('saveDraft routed in handleAction_', source.includes("if (action === 'saveDraft')"));
check('getDraft routed in handleAction_', source.includes("if (action === 'getDraft')"));

console.log('\n7. Write locks serialize jobs, deletes and drafts');
const lockEvents: string[] = [];
let busy = false;
sandbox.LockService = { getScriptLock: () => ({
  tryLock: () => { lockEvents.push('lock'); return !busy; },
  releaseLock: () => { lockEvents.push('release'); },
}) };
sandbox.SpreadsheetApp.flush = () => { lockEvents.push('flush'); };
sheets.set('Jobs', new FakeSheet('Jobs', sandbox.JOB_HEADERS));
const savedJob = { ...job, insurance: { carrier: 'Carrier', claimNumber: 'CLAIM-1' } };
call('saveJob_', editor, savedJob);
check('job save locks, flushes and releases in order', lockEvents.join(',') === 'lock,flush,release', lockEvents.join(','));
const jobs = call<any[]>('listJobs_', editor, {});
check('job list contains nested customer and claim fields', jobs[0]?.customerName === 'Ada Lovelace' && jobs[0]?.jobNumber === 'FW-2041' && jobs[0]?.carrier === 'Carrier' && jobs[0]?.claimNumber === 'CLAIM-1', JSON.stringify(jobs));
lockEvents.length = 0;
call('saveJob_', editor, { ...savedJob, productionNotes: { notes: 'Updated' } });
check('upsert reuses one row', sheets.get('Jobs')!.rows.length === 2);
lockEvents.length = 0;
call('saveDraft_', editor, { job });
check('draft save holds the same write lock', lockEvents.join(',') === 'lock,flush,release');
lockEvents.length = 0;
call('deleteJob_', editor, job.recordId);
check('delete holds the same write lock', lockEvents.join(',') === 'lock,flush,release');
check('deleted job is hidden', call<any[]>('listJobs_', editor, {}).length === 0);
lockEvents.length = 0;
let rejected = '';
try { call('saveJob_', viewer, savedJob); } catch (err: any) { rejected = err.code; }
check('permission failures release the lock', rejected === 'forbidden' && lockEvents.join(',') === 'lock,release');
busy = true;
lockEvents.length = 0;
let busyError = '';
try { call('saveDraft_', editor, { job }); } catch (err: any) { busyError = err.code; }
check('lock contention returns retryable busy and does not unlock someone else', busyError === 'busy' && lockEvents.join(',') === 'lock');
busy = false;

console.log('\n8. Session activity writes are throttled');
const now = new Date();
const sessionSheet = new FakeSheet('Sessions', sandbox.SESSION_HEADERS);
sessionSheet.rows.push(['token', editor.email, 'Editor', 'editor', now.toISOString(), new Date(now.getTime() + 3600000).toISOString(), now.toISOString()]);
sheets.set('Sessions', sessionSheet);
let heartbeatWrites = 0;
const originalGetRange = sessionSheet.getRange.bind(sessionSheet);
sessionSheet.getRange = (...args: Parameters<typeof originalGetRange>) => {
  heartbeatWrites++;
  return originalGetRange(...args);
};
call('validateSession_', 'token');
check('recent session does not trigger a sheet write', heartbeatWrites === 0);
sessionSheet.rows[1][6] = new Date(now.getTime() - 360000).toISOString();
call('validateSession_', 'token');
check('stale heartbeat is updated once', heartbeatWrites === 1);

console.log('\n9. Multiple change orders survive saved-job and draft round trips');
const initialOrderJob = createEmptyJob();
initialOrderJob.recordId = 'change-order-history';
initialOrderJob.financials.totalApprovedRcv = 10000;
initialOrderJob.changeOrder.scopeDescription = 'Additional repairs';
initialOrderJob.changeOrder.changeAmount = 1250.15;
const secondOrderJob = recordChangeOrder(initialOrderJob);
Object.assign(secondOrderJob.changeOrder, { scopeDescription: 'Credit', changeType: 'decrease', changeAmount: 250.05 });
const historicalJob = recordChangeOrder(secondOrderJob);
call('saveJob_', editor, historicalJob);
const reopenedJob = call<any>('getJob_', editor, historicalJob.recordId);
check('saved job retains both order snapshots', JSON.stringify(reopenedJob.changeOrderHistory) === JSON.stringify(historicalJob.changeOrderHistory));
check('saved job retains the cumulative total', calculateChangeOrder(reopenedJob).total === 11000.1);
call('saveDraft_', editor, { job: historicalJob, recordId: historicalJob.recordId });
const reopenedDraft = call<any>('getDraft_', editor);
check('draft retains both order snapshots', JSON.stringify(reopenedDraft.job.changeOrderHistory) === JSON.stringify(historicalJob.changeOrderHistory));
check('draft retains the next order number', reopenedDraft.job.changeOrder.changeOrderNumber === 'CO-03');

console.log(failures === 0 ? '\n>>> DRAFT BACKEND TESTS: PASS <<<' : `\n>>> DRAFT BACKEND TESTS: ${failures} FAILURE(S) <<<`);
process.exit(failures === 0 ? 0 : 1);
