/** Live check of the actual Apps Script request and client autofill, with synthetic data only. */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { config } from 'dotenv';
import { loadAppsScriptSource } from './appsscript-source';
import { applyAiExtractionToJob } from '../src/services/intakeParser';
import { createEmptyJob } from '../src/types/jobData';

config({ path: '.env.openrouter.local', quiet: true });
const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) throw new Error('Set OPENROUTER_API_KEY in .env.openrouter.local or the shell environment.');

const rawText = [
  'SYNTHETIC TEST DOCUMENT - fictional customer, not real customer data.',
  '--- Page 1: Estimate cover sheet ---',
  'Insured: Morgan Example. Home: (260) 555-0101. E-mail: morgan@example.invalid',
  'Property: 123 Example Lane, Fort Wayne, IN 46802',
  'Claim Rep.: Travelers',
  'Estimator: Riley Contractor. Business: (260) 555-0199. E-mail: estimator@example.invalid',
  'Contractor: Example Restoration. Business address: 999 Contractor Drive, Fort Wayne IN 46808',
  'Claim Number: TBD. Policy Number: TBD.',
  'Date of Loss: 8/14/2026 11:00 PM. Date Inspected: 8/15/2026 10:38 AM.',
  'Loss Description: A supply line burst damaged the kitchen floor.',
  '--- Page 2: Main room line items ---',
  'Install baseboard: $27.22; Carpet pad: $88.63; Drywall repair: $546.84.',
  'Line Item Totals including tax and overhead: $2,100.99',
  '--- Page 3: Coverage summary ---',
  'Coverage        Total RCV',
  'Dwelling        $2,019.58',
  'Contents           $81.41',
  'Grand Total     $2,100.99',
  '--- Page 4: Summary for Dwelling ---',
  'Replacement Cost Value $2,019.58. Net Claim $2,019.58.',
  '--- Page 5: Summary for Contents ---',
  'Replacement Cost Value $81.41. Net Claim $81.41.',
  '--- Page 6: Room diagram ---',
  'Main Room, Main Level. Floor area: 545.38 SF.',
].join('\n');

async function main() {
  let request: { url: string; options: { headers: Record<string, string>; payload: string } } | undefined;
  const sandbox: any = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (name: string) => name === 'OPENROUTER_API_KEY' ? key : null }) },
    Utilities: { newBlob: (value: string) => ({ getBytes: () => Buffer.from(value) }) },
    UrlFetchApp: { fetch: (url: string, options: any) => {
      request = { url, options };
      return { getResponseCode: () => 200, getContentText: () => '{"choices":[{"finish_reason":"stop","message":{"content":"{\\"customer\\":{}}"}}]}' };
    } },
  };
  vm.createContext(sandbox);
  vm.runInContext(loadAppsScriptSource(), sandbox);
  const models: string[] = Array.from(sandbox.INTAKE_MODELS);
  if (process.argv.includes('--fallback')) models.splice(0, 1);
  const responses = new Map<string, { status: number; body: string }>();
  let payload: any;
  let lastError: unknown;
  for (const model of models) {
    sandbox.INTAKE_MODELS = [model];
    sandbox.UrlFetchApp.fetch = (url: string, options: any) => {
      request = { url, options };
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"customer":{}}' } }] }) };
    };
    sandbox.analyzeIntake_({ rawText });
    assert.ok(request);
    const response = await fetch(request.url, {
      method: 'POST', headers: { ...request.options.headers, 'Content-Type': 'application/json' },
      body: request.options.payload, signal: AbortSignal.timeout(120000),
    });
    const body = await response.text();
    responses.set(model, { status: response.status, body });
    let metadata: Record<string, unknown> = { httpStatus: response.status, requestedModel: model };
    try {
      const envelope = JSON.parse(body);
      const choice = envelope.choices?.[0];
      metadata = { ...metadata, model: envelope.model, finishReason: choice?.finish_reason,
        contentType: typeof choice?.message?.content, contentLength: choice?.message?.content?.length,
        cost: envelope.usage?.cost };
    } catch { /* Never print document content or upstream bodies. */ }
    console.log('OpenRouter response metadata:', JSON.stringify(metadata));
    sandbox.UrlFetchApp.fetch = () => ({ getResponseCode: () => response.status, getContentText: () => body });
    try { payload = sandbox.analyzeIntake_({ rawText }); break; }
    catch (error: any) {
      lastError = error;
      if (!['ai_unavailable', 'ai_invalid_response', 'ai_response_truncated'].includes(error.code)) throw error;
    }
  }
  if (!payload) throw lastError;
  // Replay the real replies through the complete backend, including its fallback policy.
  sandbox.INTAKE_MODELS = models;
  sandbox.UrlFetchApp.fetch = (_url: string, options: any) => {
    const captured = responses.get(JSON.parse(options.payload).model);
    assert.ok(captured, 'The backend requested an untested model');
    return { getResponseCode: () => captured.status, getContentText: () => captured.body };
  };
  payload = sandbox.analyzeIntake_({ rawText });
  const existing = createEmptyJob();
  existing.insurance.specialInstructions = 'Keep these manually entered instructions.';
  const result = applyAiExtractionToJob(payload, existing);
  assert.equal(result.jobData.customer.customerName, 'Morgan Example');
  assert.match(result.jobData.customer.lossAddress, /123 Example Lane/);
  assert.equal(result.jobData.customer.email, 'morgan@example.invalid');
  assert.equal(result.jobData.customer.mainPhone, '1-260-555-0101');
  assert.equal(result.jobData.insurance.claimNumber, '');
  assert.equal(result.jobData.insurance.policyNumber, '');
  assert.equal(result.jobData.insurance.carrier, 'Travelers');
  assert.equal(result.jobData.financials.totalApprovedRcv, 2100.99);
  assert.equal(payload.financials.deductible, null);
  assert.equal(result.jobData.insurance.dateOfLoss, '2026-08-14');
  assert.equal(result.jobData.insurance.specialInstructions, existing.insurance.specialInstructions);
  for (const captured of responses.values()) {
    if (captured.status === 200) assert.equal(JSON.parse(captured.body).usage?.cost, 0, 'The live check must report zero cost.');
  }
  console.log(`OpenRouter extraction and job autofill passed. ${result.extractionSummary.fieldsExtractedCount} fields extracted; reported cost: $0.`);
}

main().catch((error: unknown) => {
  // Never print upstream bodies, request objects, keys, or customer data.
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Unknown failure';
  console.error(message.replaceAll(key!, '[redacted]'));
  process.exitCode = 1;
});
