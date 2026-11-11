import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { loadAppsScriptSource } from './appsscript-source';

function backend() {
  const sheets = new Map<string, any>();
  let writes = 0, locked = false, released = 0, failWrite = false;
  const sandbox: any = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => key === 'OPENROUTER_API_KEY' ? 'test-key' : null }) },
    Utilities: { getUuid: () => `version-${writes}`, newBlob: (value: string) => ({ getBytes: () => Buffer.from(value) }), sleep: () => {} },
    LockService: { getScriptLock: () => ({ tryLock: () => { assert.equal(locked, false); locked = true; return true; }, releaseLock: () => { locked = false; released++; } }) },
    SpreadsheetApp: { flush: () => {} },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (body: string) => ({ setMimeType: () => JSON.parse(body) }) },
  };
  vm.createContext(sandbox);
  vm.runInContext(loadAppsScriptSource(), sandbox);
  sandbox.getSpreadsheet_ = () => ({
    getSheetByName: (name: string) => sheets.get(name),
    insertSheet: (name: string) => {
      const sheet: any = {
        rows: [], maxRows: 1000,
        getLastRow: () => sheet.rows.length,
        getMaxRows: () => sheet.maxRows,
        insertRowsAfter: (_: number, count: number) => { sheet.maxRows += count; },
        getDataRange: () => ({ getValues: () => sheet.rows.map((row: unknown[]) => [...row]) }),
        setFrozenRows: () => {},
        getRange: (row: number, _col: number, _rows: number, _cols: number) => ({
          setValues: (values: unknown[][]) => {
            assert.equal(locked, true);
            if (failWrite) throw new Error('simulated write failure');
            writes++;
            values.forEach((value, index) => { sheet.rows[row - 1 + index] = [...value]; });
          },
        }),
      };
      sheets.set(name, sheet);
      return sheet;
    },
  });
  sandbox.authenticateRequest_ = (payload: any) => {
    if (!payload.sessionToken) throw sandbox.appError_('unauthorized', 'Authentication required');
    return { email: payload.sessionToken, role: payload.role || 'editor' };
  };
  return { sandbox, sheets, writes: () => writes, released: () => released, fail: () => { failWrite = true; } };
}
const first = [{ customerName: '=do not execute', jobNumber: 'F-1', contractPrice: 15 }, { customerName: 'Two', jobNumber: 'F-2', contractPrice: 0 }];

test('the complete Code.gs identifies the deployed AI version without exposing its key', () => {
  const env = backend();
  const ping = env.sandbox.doGet({ parameter: {} });
  assert.equal(ping.ok, true);
  assert.equal(ping.data.backendVersion, '2026-11-10-openrouter-3');
  assert.ok(ping.data.capabilities.includes('analyzeIntake'));
  assert.equal(ping.data.aiConfigured, true);
  assert.doesNotMatch(JSON.stringify(ping), /test-key|Bearer/);
});

test('the deployed doPost entry point routes uploaded document text through OpenRouter', () => {
  const env = backend();
  env.sandbox.UrlFetchApp = { fetch: (url: string, options: any) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.match(JSON.parse(options.payload).messages[1].content, /Uploaded estimate/);
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"customer":{"customerName":"Example"},"financials":{"totalApprovedRcv":12000}}' } }] }) };
  } };
  const response = env.sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'analyzeIntake', sessionToken: 'editor', rawText: 'Uploaded estimate. Customer: Example. Total RCV $12,000.' }) } });
  assert.equal(response.ok, true);
  assert.equal(response.data.customer.customerName, 'Example');
  assert.equal(response.data.financials.totalApprovedRcv, 12000);
});

test('job, draft, customer and AI routes require a session and login still routes correctly', () => {
  const env = backend();
  for (const action of ['saveJob', 'deleteJob', 'listJobs', 'getJob', 'saveDraft', 'getDraft', 'getCustomerReference', 'replaceCustomerReference', 'analyzeIntake']) {
    assert.throws(() => env.sandbox.handleAction_({ action }), /Authentication/);
  }
  env.sandbox.loginUser_ = (email: string, password: string) => {
    assert.equal(email, 'editor@example.invalid');
    assert.equal(password, 'synthetic-test-password');
    return { sessionToken: 'synthetic-session', user: { email, role: 'editor' } };
  };
  const response = env.sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'login', email: 'editor@example.invalid', password: 'synthetic-test-password' }) } });
  assert.equal(response.ok, true);
  assert.equal(response.data.sessionToken, 'synthetic-session');
});

test('new-job intake sends only the document and never reads or modifies the saved CSV', () => {
  const env = backend();
  env.sandbox.replaceCustomerReference_({ email: 'editor', role: 'editor' }, { customers: first, fileName: 'keep-for-later.csv' });
  const stored = JSON.stringify([...env.sheets.values()].map(sheet => sheet.rows));
  env.sandbox.getCustomerReference_ = () => { throw new Error('CSV must not be read during intake'); };
  let request: any;
  env.sandbox.UrlFetchApp = { fetch: (_url: string, options: any) => {
    request = JSON.parse(options.payload);
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ customer: { customerName: 'New document customer' }, financials: { totalApprovedRcv: 4250 }, analysisNotes: 'Document-only extraction.' }) } }] }) };
  } };
  const result = env.sandbox.analyzeIntake_({ rawText: 'Customer: New document customer. Approved total: $4,250.' });
  assert.equal(request.model, 'google/gemma-4-31b-it:free');
  assert.equal(request.provider.require_parameters, true);
  assert.deepEqual(request.provider.max_price, { prompt: 0, completion: 0, request: 0, image: 0 });
  assert.deepEqual(request.response_format, { type: 'json_object' });
  assert.deepEqual(request.reasoning, { enabled: false });
  assert.equal(request.max_tokens, 8192);
  assert.equal(request.thinking, undefined);
  assert.equal(request.messages.length, 2);
  assert.doesNotMatch(request.messages[0].content, /knowledge.?base|customer reference|knowledgeMatch/i);
  assert.match(request.messages[1].content, /New document customer/);
  assert.equal(result.customer.customerName, 'New document customer');
  assert.equal(result.financials.totalApprovedRcv, 4250);
  assert.equal(result.knowledgeBase, undefined);
  assert.equal(JSON.stringify([...env.sheets.values()].map(sheet => sheet.rows)), stored);
});
test('authenticated shared snapshot is replaced, erasing previous customer data in one write', () => {
  const env = backend();
  const call = (payload: any) => env.sandbox.handleAction_(payload);
  assert.throws(() => call({ action: 'getCustomerReference' }), /Authentication/);
  const saved = call({ action: 'replaceCustomerReference', sessionToken: 'editor-one', customers: first, fileName: 'first.csv' });
  assert.equal(saved.data.customers.length, 2);
  const writesBefore = env.writes();
  call({ action: 'replaceCustomerReference', sessionToken: 'editor-two', customers: [first[1]], fileName: 'second.csv' });
  assert.equal(env.writes(), writesBefore + 1);
  const loaded = call({ action: 'getCustomerReference', sessionToken: 'viewer', role: 'viewer' }).data;
  assert.equal(loaded.customers.length, 1);
  assert.equal(loaded.fileName, 'second.csv');
  assert.equal(loaded.updatedBy, 'editor-two');
  assert.doesNotMatch(JSON.stringify([...env.sheets.values()].map(sheet => sheet.rows)), /do not execute|first.csv/);
  assert.ok(env.released() >= 2);
});
test('estimate analysis sends only the uploaded document and never reads the customer list', () => {
  const env = backend();
  const customers = [
    { customerName: 'Smith Jane', jobNumber: 'DASH-1', contractPrice: 1500, jobAddress: '10 First St', city: 'Fort Wayne', state: 'IN', zip: '46808' },
    { customerName: 'Smith Jane', jobNumber: 'DASH-2', contractPrice: 2000, jobAddress: '20 Second St', city: 'Fort Wayne', state: 'IN', zip: '46809' },
  ];
  env.sandbox.replaceCustomerReference_({ email: 'u1', role: 'editor' }, { customers, fileName: 'context.csv' });
  // Reading the shared list during analysis would mean the connection came back.
  env.sandbox.getCustomerReference_ = () => { throw new Error('The customer list must not be read by analyzeIntake'); };
  let request: any;
  env.sandbox.UrlFetchApp = { fetch: (url: string, options: any) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    request = JSON.parse(options.payload);
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ customer: { customerName: 'Smith Jane', jobNumber: 'DASH-2', lossAddress: '20 Second St' }, financials: { totalApprovedRcv: 2200 } }) } }] }) };
  } };
  const analyzed = env.sandbox.handleAction_({ action: 'analyzeIntake', sessionToken: 'different-user', rawText: 'Estimate for Jane Smith, 20 Second St. Total $2,200.' }).data;
  assert.equal(request.messages.length, 2);
  const sent = request.messages.map((message: any) => message.content).join('\n');
  assert.ok(sent.includes('20 Second St'));
  assert.ok(!sent.includes('DASH-1') && !sent.includes('DASH-2') && !sent.includes('1500') && !sent.includes('2000') && !sent.includes('Fort Wayne'));
  assert.equal(analyzed.customer.customerName, 'Smith Jane');
  assert.equal(analyzed.financials.totalApprovedRcv, 2200);
  assert.equal(analyzed.knowledgeBase, undefined);
});

test('oversized customer lists are rejected before replacing the previous snapshot', () => {
  const env = backend();
  env.sandbox.replaceCustomerReference_({ email: 'editor', role: 'editor' }, { customers: first, fileName: 'good.csv' });
  const original = JSON.stringify([...env.sheets.values()].map(sheet => sheet.rows));
  const huge = Array.from({ length: 5000 }, (_, index) => ({ customerName: 'x'.repeat(300), jobNumber: `D-${index}`, contractPrice: 10, jobAddress: 'y'.repeat(500) }));
  assert.throws(() => env.sandbox.replaceCustomerReference_({ email: 'editor', role: 'editor' }, { customers: huge, fileName: 'huge.csv' }), /100 KB/);
  assert.equal(JSON.stringify([...env.sheets.values()].map(sheet => sheet.rows)), original);
});

test('extraction responses are normalized and any legacy match fields are dropped', () => {
  const env = backend();
  const analyzed = env.sandbox.validateIntakeAnalysis_({
    customer: 'not-an-object',
    insurance: { carrier: 'State Farm' },
    financials: { totalApprovedRcv: 2200 },
    missingCoreFields: ['Claim Number', 7],
    analysisNotes: 'Carrier assignment email.',
    estimateTotal: 999,
    knowledgeMatch: { status: 'matched', jobNumber: 'DASH-9', explanation: 'legacy field', evidence: ['x'] },
  });
  assert.equal(Object.keys(analyzed.customer).length, 0);
  assert.equal(analyzed.insurance.carrier, 'State Farm');
  assert.equal(analyzed.financials.totalApprovedRcv, 2200);
  assert.deepEqual([...analyzed.missingCoreFields], ['Claim Number']);
  assert.equal(analyzed.analysisNotes, 'Carrier assignment email.');
  assert.equal(analyzed.estimateTotal, undefined);
  assert.equal(analyzed.knowledgeMatch, undefined);
  assert.equal(analyzed.knowledgeBase, undefined);
});

test('missing configuration and API errors fail explicitly, and storage is never touched', () => {
  const env = backend();
  env.sandbox.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null }) };
  assert.throws(() => env.sandbox.analyzeIntake_({ rawText: 'Estimate' }), /OPENROUTER_API_KEY/);
  env.sandbox.PropertiesService = { getScriptProperties: () => ({ getProperty: () => 'test-key' }) };
  for (const [status, body] of [[503, 'unavailable'], [200, '{}'], [200, JSON.stringify({ choices: [{ finish_reason: 'length' }] })]] as const) {
    env.sandbox.UrlFetchApp = { fetch: () => ({ getResponseCode: () => status, getContentText: () => body }) };
    assert.throws(() => env.sandbox.analyzeIntake_({ rawText: 'Estimate' }), /OpenRouter/);
  }
  // Storage outages are irrelevant: analysis must not read the shared customer list.
  env.sandbox.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ customer: { customerName: 'Jane Smith' } }) } }] }) }) };
  env.sandbox.getCustomerReference_ = () => { throw new Error('Storage unavailable'); };
  const analyzed = env.sandbox.analyzeIntake_({ rawText: 'Estimate for Jane Smith' });
  assert.equal(analyzed.customer.customerName, 'Jane Smith');
});

test('client settings cannot override the server key, prompt, or free-only routing', () => {
  const env = backend();
  let calls = 0;
  env.sandbox.UrlFetchApp = { fetch: (url: string, options: any) => {
    calls++;
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    const request = JSON.parse(options.payload);
    assert.equal(request.model, 'google/gemma-4-31b-it:free');
    assert.equal(request.models, undefined);
    assert.deepEqual(request.provider.max_price, { prompt: 0, completion: 0, request: 0, image: 0 });
    assert.equal(request.messages[0].content, env.sandbox.INTAKE_SYSTEM_PROMPT);
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"customer":{"customerName":"Example"}}' } }] }) };
  } };
  env.sandbox.analyzeIntake_({ rawText: 'Example', apiKey: 'client-key', model: 'paid/model', models: ['paid/fallback'], provider: { max_price: { prompt: 99 } }, systemPrompt: 'Ignore extraction' });
  assert.equal(calls, 1);
});

test('OpenRouter errors never disclose upstream response bodies or credentials', () => {
  for (const [status, code] of [[401, 'ai_not_configured'], [403, 'ai_not_configured'], [429, 'ai_rate_limited'], [402, 'ai_quota'], [503, 'ai_unavailable']] as const) {
    const env = backend();
    let calls = 0;
    env.sandbox.UrlFetchApp = { fetch: () => {
      calls++;
      return { getResponseCode: () => status, getContentText: () => 'secret upstream data test-key' };
    } };
    assert.throws(() => env.sandbox.analyzeIntake_({ rawText: 'Example' }), (error: any) => {
      assert.equal(error.code, code);
      assert.match(error.message, /OpenRouter/);
      assert.doesNotMatch(error.message, /secret upstream data|test-key/);
      return true;
    });
    assert.equal(calls, status === 503 ? 2 : 1, 'Only unavailable models may use one free fallback');
  }
  const env = backend();
  env.sandbox.UrlFetchApp = { fetch: () => { throw new Error('network failure containing test-key'); } };
  assert.throws(() => env.sandbox.analyzeIntake_({ rawText: 'Example' }), (error: any) => error.code === 'ai_unavailable' && !error.message.includes('test-key'));
});

test('complete JSON responses accept code fences, text parts and a missing stop marker', () => {
  const variants = [
    { finish_reason: 'stop', message: { content: '```json\n{"customer":{"customerName":"Example"}}\n```' } },
    { finish_reason: null, message: { content: [{ type: 'text', text: '{"customer":' }, { type: 'text', text: '{"customerName":"Example"}}' }] } },
    { message: { content: '{"customer":{"customerName":"Example"}}' } },
  ];
  for (const choice of variants) {
    const env = backend();
    env.sandbox.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ choices: [choice] }) }) };
    assert.equal(env.sandbox.analyzeIntake_({ rawText: 'Customer: Example' }).customer.customerName, 'Example');
  }
});

test('an invalid first completion uses one different free model with the same document', () => {
  const env = backend();
  const requests: any[] = [];
  env.sandbox.UrlFetchApp = { fetch: (_url: string, options: any) => {
    const request = JSON.parse(options.payload);
    requests.push(request);
    const content = requests.length === 1 ? '{"customer":' : '{"customer":{"customerName":"Example"}}';
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }) };
  } };
  assert.equal(env.sandbox.analyzeIntake_({ rawText: 'Customer: Example', model: 'paid/model' }).customer.customerName, 'Example');
  assert.deepEqual(requests.map(request => request.model), ['google/gemma-4-31b-it:free', 'dots-studio/dots-3-note-preview:free']);
  assert.deepEqual(requests[1].messages, requests[0].messages);
  for (const request of requests) assert.deepEqual(request.provider.max_price, { prompt: 0, completion: 0, request: 0, image: 0 });
});

test('provider-specific throttling uses the alternate free provider without retrying account limits', () => {
  const env = backend();
  let calls = 0;
  env.sandbox.UrlFetchApp = { fetch: (_url: string, options: any) => {
    calls++;
    assert.equal(JSON.parse(options.payload).provider.max_price.completion, 0);
    return calls === 1
      ? { getResponseCode: () => 429, getContentText: () => JSON.stringify({ error: { metadata: { provider_name: 'Google AI Studio' } } }) }
      : { getResponseCode: () => 200, getContentText: () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"customer":{"customerName":"Example"}}' } }] }) };
  } };
  assert.equal(env.sandbox.analyzeIntake_({ rawText: 'Customer: Example' }).customer.customerName, 'Example');
  assert.equal(calls, 2);
});

test('truncated, refused and unrelated JSON completions never populate job fields', () => {
  const cases = [
    { choice: { finish_reason: 'length', message: { content: '{"customer":{"customerName":"Partial"}}' } }, code: 'ai_response_truncated' },
    { choice: { finish_reason: 'content_filter', message: { content: '' } }, code: 'ai_refused' },
    { choice: { finish_reason: 'stop', message: { content: '[]' } }, code: 'ai_invalid_response' },
    { choice: { finish_reason: 'stop', message: { content: '{}' } }, code: 'ai_invalid_response' },
    { choice: { finish_reason: 'stop', message: { content: '{"error":"not extraction"}' } }, code: 'ai_invalid_response' },
    { choice: { finish_reason: 'stop', message: { refusal: 'Cannot process', content: null } }, code: 'ai_refused' },
  ];
  for (const { choice, code } of cases) {
    const env = backend();
    let calls = 0;
    env.sandbox.UrlFetchApp = { fetch: () => {
      calls++;
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ choices: [choice] }) };
    } };
    assert.throws(() => env.sandbox.analyzeIntake_({ rawText: 'Example' }), (error: any) => error.code === code);
    assert.equal(calls, code === 'ai_refused' ? 1 : 2);
  }
});

test('empty and oversized intake is rejected before any AI request', () => {
  const env = backend();
  env.sandbox.UrlFetchApp = { fetch: () => { throw new Error('Must not call OpenRouter'); } };
  for (const rawText of ['', '  ', null, 'x'.repeat(100001), '\u00e9'.repeat(50001)]) {
    assert.throws(() => env.sandbox.analyzeIntake_({ rawText }), (error: any) => ['bad_request', 'context_too_large'].includes(error.code));
  }
});
test('viewer, duplicate, empty and invalid uploads cannot alter the shared snapshot', () => {
  const env = backend();
  env.sandbox.replaceCustomerReference_({ email: 'editor', role: 'editor' }, { customers: first, fileName: 'good.csv' });
  const original = JSON.stringify([...env.sheets.values()].map(sheet => sheet.rows));
  for (const payload of [{ customers: [] }, { customers: [first[0], first[0]] }, { customers: [{ ...first[0], contractPrice: -1 }] }, { customers: [{ ...first[0], contractPrice: '10' }] }]) {
    assert.throws(() => env.sandbox.replaceCustomerReference_({ email: 'editor', role: 'editor' }, { fileName: 'bad.csv', ...payload }));
  }
  assert.throws(() => env.sandbox.replaceCustomerReference_({ email: 'viewer', role: 'viewer' }, { customers: first, fileName: 'bad.csv' }), /permission/);
  assert.equal(JSON.stringify([...env.sheets.values()].map(sheet => sheet.rows)), original);
  env.fail();
  assert.throws(() => env.sandbox.replaceCustomerReference_({ email: 'editor', role: 'editor' }, { customers: [first[1]], fileName: 'bad.csv' }), /simulated/);
  assert.equal(JSON.stringify([...env.sheets.values()].map(sheet => sheet.rows)), original);
  assert.ok(env.released() >= 2);
});
