/**
 * Offline test harness for apps-script/Code.gs
 *
 * Loads the Apps Script file into a Node VM with stubbed Google services, then
 * asserts the behaviour that matters most: that a record survives a round-trip
 * through the spreadsheet (JSON column + text cells) without type corruption.
 *
 * Run with:  npx tsx scripts/test-apps-script.ts
 */
import { createHmac } from 'node:crypto';
import vm from 'node:vm';
import { loadAppsScriptSource } from './appsscript-source';

const source = loadAppsScriptSource();

/** Minimal in-memory stand-in for the Google globals Code.gs touches. */
function createSandbox() {
  const properties: Record<string, string> = { SCHEMA_VERSION: '1', REQUIRE_ID_TOKEN: 'true' };

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
    Session: { getScriptTimeZone: () => 'America/Indiana/Indianapolis' },
    Utilities: {
      getUuid: () => '11111111-2222-4333-8444-555555555555',
      formatDate: () => '2026-09-26',
      // Mirrors Utilities.computeHmacSha256Signature(value, key): signed-byte output.
      computeHmacSha256Signature: (value: unknown, key: unknown) => {
        const message =
          typeof value === 'string'
            ? Buffer.from(value, 'utf8')
            : Buffer.from((value as number[]).map((b) => (b < 0 ? b + 256 : b)));
        const digest = createHmac('sha256', Buffer.from(String(key), 'utf8')).update(message).digest();
        return Array.from(digest).map((b) => (b > 127 ? b - 256 : b));
      },
    },
    SpreadsheetApp: {},
    UrlFetchApp: {},
    ContentService: {},
    ScriptApp: {},
    LockService: {},
    __properties: properties,
  };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'Code.gs' });
  return sandbox;
}

const sandbox = createSandbox();
const call = <T = any>(fn: string, ...args: any[]): T => {
  const f = sandbox[fn];
  if (typeof f !== 'function') throw new Error(`Code.gs does not define ${fn}()`);
  return f(...args) as T;
};

let failures = 0;
function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  OK    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? `  -> ${detail}` : ''}`);
  }
}

console.log('\n1. Hostile-input normalisation (simulates a bad spreadsheet round-trip)');
const hostile = {
  customer: { customerName: 'Test', jobNumber: 'FW-1' },
  financials: {
    totalApprovedRcv: '$24,850.00',
    deductible: '   ',
    netClaimValue: 0,
    downPayment: 0,
    midProgressPayment: 0,
    balancePayment: 0,
    commenceDays: 10,
    completeDays: 60,
  },
  insurance: { roughEstimateAmount: ',1,234.56' },
  mortgage: { hasMortgage: 'FALSE' },
  changeOrder: { changeType: 'INCREASE', changeAmount: '3200', addedDays: '', netPreviousChanges: '' },
  checklist: { hasDeductibleBeenCollected: 'yes', isSelfPay: '0', isProgramClaim: 'false', depreciationAmount: '' },
};
const normalized = call<any>('normalizeRecord_', hostile);

check('currency string "$24,850.00" -> 24850', normalized.financials.totalApprovedRcv === 24850, String(normalized.financials.totalApprovedRcv));
check('whitespace deductible "   " -> "" (not 0)', normalized.financials.deductible === '', JSON.stringify(normalized.financials.deductible));
check('"FALSE" -> boolean false (not truthy)', normalized.mortgage.hasMortgage === false, String(normalized.mortgage.hasMortgage));
check('"0" -> boolean false', normalized.checklist.isSelfPay === false, String(normalized.checklist.isSelfPay));
check('"false" -> boolean false', normalized.checklist.isProgramClaim === false, String(normalized.checklist.isProgramClaim));
check('"yes" -> "Yes" (union repaired + cased)', normalized.checklist.hasDeductibleBeenCollected === 'Yes', normalized.checklist.hasDeductibleBeenCollected);
check('"INCREASE" -> "increase"', normalized.changeOrder.changeType === 'increase', normalized.changeOrder.changeType);
check('changeAmount "3200" -> 3200', normalized.changeOrder.changeAmount === 3200, String(normalized.changeOrder.changeAmount));
check('addedDays "" stays "" (not 0)', normalized.changeOrder.addedDays === '', JSON.stringify(normalized.changeOrder.addedDays));
check('",1,234.56" -> 1234.56', normalized.insurance.roughEstimateAmount === 1234.56, String(normalized.insurance.roughEstimateAmount));
check('recordId auto-generated when absent', !!normalized.recordId, normalized.recordId);
check('schemaVersion stamped', normalized.schemaVersion === 1, String(normalized.schemaVersion));
check(
  'all sections materialised from the template',
  !!normalized.branch &&
    !!normalized.customer &&
    !!normalized.insurance &&
    !!normalized.financials &&
    !!normalized.team &&
    !!normalized.mortgage &&
    !!normalized.changeOrder &&
    !!normalized.checklist
);
check('unknown fields preserved (forward compatible)', normalized.customer.jobNumber === 'FW-1');
check('absent string leaf materialised as ""', normalized.team.projectManager === '', JSON.stringify(normalized.team.projectManager));
check('absent string leaf keeps inputs controlled', normalized.insurance.specialInstructions === '', JSON.stringify(normalized.insurance.specialInstructions));

console.log('\n2. Idempotency + JSON round-trip (the actual sheet behaviour)');
const twice = call<any>('normalizeRecord_', JSON.parse(JSON.stringify(normalized)));
check('normalising twice is stable', JSON.stringify(twice) === JSON.stringify(normalized));

const viaSheet = call<any>('normalizeRecord_', JSON.parse(JSON.stringify(normalized)));
check('number|"" fields survive a JSON trip', viaSheet.financials.deductible === '' && viaSheet.changeOrder.addedDays === '');
check('numbers stay numbers after JSON trip', viaSheet.financials.totalApprovedRcv === 24850 && viaSheet.changeOrder.changeAmount === 3200);
check('booleans stay booleans after JSON trip', viaSheet.mortgage.hasMortgage === false && viaSheet.checklist.isSelfPay === false);

console.log('\n3. Defaults for always-numeric fields');
const defaults = call<any>('normalizeRecord_', {});
check('commenceDays defaults to 10', defaults.financials.commenceDays === 10, String(defaults.financials.commenceDays));
check('completeDays defaults to 60', defaults.financials.completeDays === 60, String(defaults.financials.completeDays));
check('netClaimValue defaults to 0', defaults.financials.netClaimValue === 0, String(defaults.financials.netClaimValue));

console.log('\n4. Enum fallbacks');
check('unknown changeType falls back to increase', call('oneOf_', 'bogus', ['increase', 'decrease', 'unchanged'], 'increase') === 'increase');
check('valid enum echoed exactly', call('oneOf_', 'decrease', ['increase', 'decrease', 'unchanged'], 'increase') === 'decrease');
check('empty enum falls back', call('oneOf_', '', ['Yes', 'No', 'Pending'], 'No') === 'No');

console.log('\n5. Boolean coercion edge cases');
check('"TRUE" -> true', call('toBool_', 'TRUE') === true);
check('"FALSE" -> false', call('toBool_', 'FALSE') === false);
check('1 -> true', call('toBool_', 1) === true);
check('0 -> false', call('toBool_', 0) === false);
check('undefined -> false', call('toBool_', undefined) === false);
check('"no" -> false', call('toBool_', 'no') === false);

console.log('\n6. Email allow-list (domain + exact, case-insensitive)');
check('exact email allowed', call('isEmailAllowed_', 'russell@haysandsons.com', 'russell@haysandsons.com') === true);
check('domain entry allows any address', call('isEmailAllowed_', 'anyone@haysandsons.com', '@haysandsons.com') === true);
check('domain entry rejects lookalike suffix', call('isEmailAllowed_', 'evil@nothaysandsons.com', '@haysandsons.com') === false);
check('mixed list works', call('isEmailAllowed_', 'a@b.com', 'x@y.com, @b.com') === true);
check('empty allow-list denies (fails closed)', call('isEmailAllowed_', 'a@b.com', '') === false);
check('null allow-list denies (fails closed)', call('isEmailAllowed_', 'a@b.com', null) === false);

console.log('\n7. Shared-secret comparison');
check('matching secrets equal', call('timingSafeEqual_', 'abcdef', 'abcdef') === true);
check('different secrets differ', call('timingSafeEqual_', 'abcdef', 'abcdeg') === false);
check('length mismatch differs', call('timingSafeEqual_', 'abc', 'abcd') === false);

console.log('\n8. Password hashing');
const SALT_A = 'salt-aaaaaaaaaaaaaaaaaaaa';
const SALT_B = 'salt-bbbbbbbbbbbbbbbbbbbb';
const hashA1 = call<string>('hashPassword_', 'correct horse battery', SALT_A);
const hashA2 = call<string>('hashPassword_', 'correct horse battery', SALT_A);
const hashB = call<string>('hashPassword_', 'correct horse battery', SALT_B);
const hashWrong = call<string>('hashPassword_', 'Correct horse battery', SALT_A);

check('hash is deterministic for the same salt', hashA1 === hashA2, `${hashA1} vs ${hashA2}`);
check('different salt yields a different hash', hashA1 !== hashB);
check('case-sensitive: wrong password differs', hashA1 !== hashWrong);
check('never returns the plain password', hashA1 !== 'correct horse battery');
check('hash does not contain the password', hashA1.indexOf('correct') === -1);
check('hash is 64 hex characters (SHA-256)', /^[0-9a-f]{64}$/.test(hashA1), hashA1);

const hex = call<string>('bytesToHex_', [0, 15, 255, -1]);
check('bytesToHex pads and handles signed bytes', hex === '000fffff', hex);

console.log(failures === 0 ? '\nAll Apps Script logic checks passed.' : `\n${failures} check(s) FAILED.`);
if (failures) process.exitCode = 1;
