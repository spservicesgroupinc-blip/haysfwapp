/**
 * Focused test harness for the intake text parser (src/services/intakeParser.ts).
 *
 * The parser is the single point where pasted DASH logs, carrier emails and
 * estimate recaps get routed into the nine master-record sections, so it has
 * to hold up against the real shapes people paste in:
 *
 *   - labelled key/value blocks (colon, dash, tab, two-space and "is/was" forms)
 *   - labels whose value sits on the following line
 *   - prose emails ("The date of loss was 6/28/2025")
 *   - several labels sharing one line ("Claim Number: X, Policy Number: Y")
 *   - unlabelled single email / phone numbers
 *   - merging into an existing record without wiping manual entries
 *   - peril, change-type and Xactimate canonicalisation, including failures
 *
 * Run with:  npx tsx scripts/test-intake-parser.ts
 */
import { createEmptyJob } from '../src/types/jobData';
import {
  parseRawIntakeText,
  normalizeDate,
  normalizeTime,
  normalizePhone,
  parseCurrencyValue,
} from '../src/services/intakeParser';

let failures = 0;
let checks = 0;
function check(name: string, condition: boolean, detail = '') {
  checks++;
  if (condition) {
    console.log(`  OK    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? `  -> ${detail}` : ''}`);
  }
}

const DASH_LOG = `DASH JOB LOG - FW-2025-4821
Customer Name: Jane & Robert Miller
Loss Address: 4821 Oak Hollow Rd, Fort Wayne, IN 46845
Mailing Address: PO Box 2214, Fort Wayne, IN 46801
Cell: (260) 555-0134
Home Phone: 260-555-9917
Email: jmiller@gmail.com

Carrier: State Farm
Claim #: SF-25-884713
Policy Number: 94-BX-7731
Primary Adjuster: David Miller
Adjuster Phone: 260-555-0199
Adjuster Email: dmiller@statefarmclaims.com

Date of Loss: 01/15/2025
Time of Loss: 3:30 PM
Type of Loss: Water Damage
Cause: supply line burst under kitchen sink

Total Approved RCV: $28,450.00
Deductible: $2,000

Estimator: Russell Shive
Project Manager: Tyler Gregg
Mortgage Company: Ruoff Mortgage
Loan #: 5512390

Xactimate Version: X2
Start Date: 02/03/2025
Estimated Completion Date: March 14, 2025

Notes: Kitchen and hallway flooring will need to be removed. Cabinets are salvageable after drying.`;

const CARRIER_EMAIL = `From: claims@allstate.com
Subject: New claim assignment for Gloria Price

Hi team,

Please see the attached loss notice for 2210 Maplecrest Dr, Fort Wayne, IN 46815.
Insured: Gloria Price, phone 260-555-0187. Her email is gprice88@yahoo.com.
Claim Number: 0912345678, Policy Number: 503-882-119.
The date of loss was 6/28/2025 due to storm damage (hail and wind).
Estimated deductible is $1,500 and our approved RCV is $19,875.
Adjuster email: kevin.ortiz@allstate.com - please copy him.
Referred By: Cecilia Rolf`;

console.log('\n1. Full DASH-style job log');
const a = parseRawIntakeText(DASH_LOG);
const aj = a.jobData;
check('standalone FW job number picked up', aj.customer.jobNumber === 'FW-2025-4821', aj.customer.jobNumber);
check('customer name', aj.customer.customerName === 'Jane & Robert Miller', aj.customer.customerName);
check('job name drafted from customer', aj.customer.jobName === 'Jane & Robert Miller Restoration', aj.customer.jobName);
check('loss address kept in full', aj.customer.lossAddress === '4821 Oak Hollow Rd, Fort Wayne, IN 46845', aj.customer.lossAddress);
check('mailing street split out', aj.customer.mailingAddress === 'PO Box 2214', aj.customer.mailingAddress);
check('mailing city/state/zip split out', aj.customer.mailingCityStateZip === 'Fort Wayne, IN 46801', aj.customer.mailingCityStateZip);
check('cell normalised', aj.customer.mobilePhone === '1-260-555-0134', aj.customer.mobilePhone);
check('home phone normalised', aj.customer.homePhone === '1-260-555-9917', aj.customer.homePhone);
check('main phone defaulted to mobile', aj.customer.mainPhone === '1-260-555-0134', aj.customer.mainPhone);
check('customer email', aj.customer.email === 'jmiller@gmail.com', aj.customer.email);
check('carrier', aj.insurance.carrier === 'State Farm', aj.insurance.carrier);
check('claim number', aj.insurance.claimNumber === 'SF-25-884713', aj.insurance.claimNumber);
check('policy number', aj.insurance.policyNumber === '94-BX-7731', aj.insurance.policyNumber);
check('adjuster name', aj.insurance.primaryAdjuster === 'David Miller', aj.insurance.primaryAdjuster);
check('adjuster phone', aj.insurance.adjusterPhone === '1-260-555-0199', aj.insurance.adjusterPhone);
check('adjuster email', aj.insurance.adjusterEmail === 'dmiller@statefarmclaims.com', aj.insurance.adjusterEmail);
check('date of loss normalised', aj.insurance.dateOfLoss === '2025-01-15', aj.insurance.dateOfLoss);
check('time of loss normalised to 24h', aj.insurance.timeOfLoss === '15:30', aj.insurance.timeOfLoss);
check('peril canonicalised from "Water Damage"', aj.insurance.typeOfLoss === 'Water - Supply Line Burst', aj.insurance.typeOfLoss);
check('approved RCV', aj.financials.totalApprovedRcv === 28450, String(aj.financials.totalApprovedRcv));
check('deductible', aj.financials.deductible === 2000, String(aj.financials.deductible));
check('net claim value calculated', aj.financials.netClaimValue === 26450, String(aj.financials.netClaimValue));
check('down payment calculated', aj.financials.downPayment === 14225, String(aj.financials.downPayment));
check('mid-progress payment calculated', aj.financials.midProgressPayment === 7112.5, String(aj.financials.midProgressPayment));
check('project manager', aj.team.projectManager === 'Tyler Gregg', aj.team.projectManager);
check('mortgage company', aj.mortgage.mortgageCompany === 'Ruoff Mortgage', aj.mortgage.mortgageCompany);
check('mortgage flag set', aj.mortgage.hasMortgage === true);
check('loan number', aj.mortgage.loanNumber === '5512390', aj.mortgage.loanNumber);
check('xactimate version', aj.checklist.xactimateVersion === 'X2', aj.checklist.xactimateVersion);
check('start date', aj.checklist.startDate === '2025-02-03', aj.checklist.startDate);
check('completion date', aj.checklist.finishDate === '2025-03-14', aj.checklist.finishDate);
check('PM notes captured', aj.checklist.projectManagerNotes.startsWith('Kitchen and hallway flooring'), aj.checklist.projectManagerNotes);
check('no blocking fields', a.blockingMissingFields.length === 0, JSON.stringify(a.blockingMissingFields));
check('nothing warned', a.extractionSummary.warnings.length === 0, JSON.stringify(a.extractionSummary.warnings));

const aSections = a.extractionSummary.sections.map((s) => s.section);
for (const section of ['customer', 'insurance', 'financials', 'team', 'mortgage', 'checklist'] as const) {
  check(`section summary includes ${section}`, aSections.includes(section), JSON.stringify(aSections));
}
check(
  'provenance tags extraction',
  a.provenance['claimNumber']?.source === 'EXTRACTED',
  JSON.stringify(a.provenance['claimNumber'])
);
check(
  'provenance tags financial calculations',
  a.provenance['netClaimValue']?.source === 'CALCULATED',
  JSON.stringify(a.provenance['netClaimValue'])
);
check(
  'provenance tags the extracted estimator',
  a.provenance['estimator']?.source === 'EXTRACTED' && aj.team.estimator === 'Russell Shive',
  JSON.stringify(a.provenance['estimator'])
);

console.log('\n2. Carrier assignment email (prose labels, several emails on file)');
const b = parseRawIntakeText(CARRIER_EMAIL);
const bj = b.jobData;
check('insured parsed from prose', bj.customer.customerName === 'Gloria Price', bj.customer.customerName);
check('customer email won over sender address', bj.customer.email === 'gprice88@yahoo.com', bj.customer.email);
check('unlabelled phone became main phone', bj.customer.mainPhone === '1-260-555-0187', bj.customer.mainPhone);
check('claim and policy share one line: claim', bj.insurance.claimNumber === '0912345678', bj.insurance.claimNumber);
check('claim and policy share one line: policy', bj.insurance.policyNumber.replace(/\.$/, '') === '503-882-119', bj.insurance.policyNumber);
check('adjuster email not treated as customer email', bj.insurance.adjusterEmail === 'kevin.ortiz@allstate.com', bj.insurance.adjusterEmail);
check('prose date of loss', bj.insurance.dateOfLoss === '2025-06-28', bj.insurance.dateOfLoss);
check('prose deductible', bj.financials.deductible === 1500, String(bj.financials.deductible));
check('prose RCV', bj.financials.totalApprovedRcv === 19875, String(bj.financials.totalApprovedRcv));
check('peril inferred from keywords', bj.insurance.typeOfLoss === 'Storm / Wind / Hail', bj.insurance.typeOfLoss);
check('carrier inferred from known carrier name', bj.insurance.carrier === 'Allstate', bj.insurance.carrier);
check('referred by', bj.insurance.referredBy === 'Cecilia Rolf', bj.insurance.referredBy);
check('missing loss address still reported as blocking', b.blockingMissingFields.includes('Loss Property Address'), JSON.stringify(b.blockingMissingFields));
check('at least 10 fields routed', b.extractionSummary.fieldsExtractedCount >= 10, String(b.extractionSummary.fieldsExtractedCount));
check(
  'provenance tags the branch-default estimator',
  b.provenance['estimator']?.source === 'FOUND' && (b.provenance['estimator']?.detail ?? '').includes('Russell Shive'),
  JSON.stringify(b.provenance['estimator'])
);

console.log('\n3. Bare contact block (single unlabelled email and phone)');
const c = parseRawIntakeText(
  'Hey John - this is Sarah from the agency, my number is (260) 555-0171 if you have questions. You can also reach me at sarah.j@allstate-agency.com.'
);
check('single phone used as main', c.jobData.customer.mainPhone === '1-260-555-0171', c.jobData.customer.mainPhone);
check('single email used for the customer', c.jobData.customer.email === 'sarah.j@allstate-agency.com', c.jobData.customer.email);
check('carrier matched from the email domain', c.jobData.insurance.carrier === 'Allstate', c.jobData.insurance.carrier);

console.log('\n4. Merging a paste into an existing record');
const existing = createEmptyJob();
existing.customer.customerName = 'Manual Entry';
existing.insurance.specialInstructions = 'Call before arrival';
existing.financials.totalApprovedRcv = 10000;
existing.financials.deductible = 1000;
existing.financials.netClaimValue = 9000;
existing.financials.downPayment = 5000;
existing.financials.midProgressPayment = 2500;
existing.financials.balancePayment = 2500;
existing.checklist.startDate = '2025-01-01';
const d = parseRawIntakeText('Claim Number: NEW-1234\nThe date of loss was 5/1/2025.\nCarrier: Travelers', existing);
check('manual customer name survives the merge', d.jobData.customer.customerName === 'Manual Entry', d.jobData.customer.customerName);
check('manual notes survive the merge', d.jobData.insurance.specialInstructions === 'Call before arrival', d.jobData.insurance.specialInstructions);
check('manual start date survives the merge', d.jobData.checklist.startDate === '2025-01-01', d.jobData.checklist.startDate);
check('new claim number merged in', d.jobData.insurance.claimNumber === 'NEW-1234', d.jobData.insurance.claimNumber);
check('new carrier merged in', d.jobData.insurance.carrier === 'Travelers', d.jobData.insurance.carrier);
check('new loss date merged in', d.jobData.insurance.dateOfLoss === '2025-05-01', d.jobData.insurance.dateOfLoss);
check('existing RCV kept when paste has none', d.jobData.financials.totalApprovedRcv === 10000, String(d.jobData.financials.totalApprovedRcv));
check('financials not wiped back to zero', d.jobData.financials.netClaimValue === 9000 && d.jobData.financials.downPayment === 5000, JSON.stringify(d.jobData.financials));
check('three extracted fields', d.extractionSummary.fieldsExtractedCount === 3, String(d.extractionSummary.fieldsExtractedCount));
check('three merged values', d.extractionSummary.fieldsUpdatedCount === 3, String(d.extractionSummary.fieldsUpdatedCount));
check(
  'insurance section lists the three routed fields',
  ['claimNumber', 'carrier', 'dateOfLoss'].every((key) =>
    (d.extractionSummary.sections.find((s) => s.section === 'insurance')?.fields ?? []).some((f) => f.key === key)
  ),
  JSON.stringify(d.extractionSummary.sections.map((s) => [s.section, s.fields.map((f) => f.key)]))
);

console.log('\n5. Peril mapping failures and successes');
const e = parseRawIntakeText('Type of Loss: Act of God');
check('unmappable peril warns instead of guessing', e.extractionSummary.warnings.length >= 1, JSON.stringify(e.extractionSummary.warnings));
check('unmappable peril leaves default untouched', e.jobData.insurance.typeOfLoss === 'Water - Supply Line Burst', e.jobData.insurance.typeOfLoss);
check('no provenance for unmappable peril', e.provenance['typeOfLoss'] === undefined, JSON.stringify(e.provenance['typeOfLoss']));
const f = parseRawIntakeText('Type of Loss: Sewage Backup');
check('sewage mapped to canonical option', f.jobData.insurance.typeOfLoss === 'Water - Sewage Backup', f.jobData.insurance.typeOfLoss);

console.log('\n6. Mortgage with no lien');
const g = parseRawIntakeText('Mortgage Company: None - free and clear\nLoan Number: none');
check('"None - free and clear" clears the mortgage flag', g.jobData.mortgage.hasMortgage === false, String(g.jobData.mortgage.hasMortgage));
check('no mortgage company stored for "None"', g.jobData.mortgage.mortgageCompany === '', g.jobData.mortgage.mortgageCompany);

console.log('\n7. Checklist flags');
const h = parseRawIntakeText(
  ['Deductible Collected: Yes', 'Xactimate: X2', 'Program Claim: No', 'Self Pay: Yes', 'Depreciation Withheld: Yes', 'Depreciation Amount: $1,250', 'Check Sent: No', 'Check Payable To: Hays + Sons Construction, Inc.'].join('\n')
);
check('deductible collected = Yes', h.jobData.checklist.hasDeductibleBeenCollected === 'Yes', h.jobData.checklist.hasDeductibleBeenCollected);
check('xactimate version', h.jobData.checklist.xactimateVersion === 'X2', h.jobData.checklist.xactimateVersion);
check('program claim = No', h.jobData.checklist.isProgramClaim === false);
check('self pay = Yes', h.jobData.checklist.isSelfPay === true);
check('depreciation withheld = Yes', h.jobData.checklist.isDepreciationWithheld === true);
check('depreciation amount', h.jobData.checklist.depreciationAmount === 1250, String(h.jobData.checklist.depreciationAmount));
check('check sent = No', h.jobData.checklist.hasCheckBeenSent === false);
check('check payable to', h.jobData.checklist.checkPayableTo === 'Hays + Sons Construction, Inc.', h.jobData.checklist.checkPayableTo);

console.log('\n8. Change order block');
const i = parseRawIntakeText(
  ['Change Order #: CO-02', 'Scope of Work: Add master bathroom tile', 'Change Amount: $3,400', 'Added Days: 5', 'Change Type: Increase (credit approved)', 'Insurance Related: Yes', 'Original Contract Sum: $28,450'].join('\n')
);
check('change order number', i.jobData.changeOrder.changeOrderNumber === 'CO-02', i.jobData.changeOrder.changeOrderNumber);
check('change order scope', i.jobData.changeOrder.scopeDescription === 'Add master bathroom tile', i.jobData.changeOrder.scopeDescription);
check('change amount', i.jobData.changeOrder.changeAmount === 3400, String(i.jobData.changeOrder.changeAmount));
check('added days', i.jobData.changeOrder.addedDays === 5, String(i.jobData.changeOrder.addedDays));
check('change type direction', i.jobData.changeOrder.changeType === 'increase', i.jobData.changeOrder.changeType);
check('insurance related flag', i.jobData.changeOrder.isInsuranceRelated === true);
check('original contract sum', i.jobData.changeOrder.originalContractSum === 28450, String(i.jobData.changeOrder.originalContractSum));

console.log('\n9. Unit helpers');
check('phone with extension', normalizePhone('(260) 555-0134 ext 12') === '1-260-555-0134', normalizePhone('(260) 555-0134 ext 12'));
check('accounting negative currency', parseCurrencyValue('($1,234.56)') === -1234.56, String(parseCurrencyValue('($1,234.56)')));
check('currency with words', parseCurrencyValue('$ 12,500 USD') === 12500, String(parseCurrencyValue('$ 12,500 USD')));
check('2-digit year date', normalizeDate('9/3/25') === '2025-09-03', normalizeDate('9/3/25'));
check('month-name date', normalizeDate('March 14, 2025') === '2025-03-14', normalizeDate('March 14, 2025'));
check('time with PM', normalizeTime('3:30 PM') === '15:30', normalizeTime('3:30 PM'));
check('time "noon"', normalizeTime('noon') === '12:00', normalizeTime('noon'));

console.log('\n10. Garbage input stays safe');
const j = parseRawIntakeText('asdf qwer zxcv');
check('no fields extracted from garbage', j.extractionSummary.fieldsExtractedCount === 0, String(j.extractionSummary.fieldsExtractedCount));
check('job number still generated', j.jobData.customer.jobNumber.startsWith('FW-'), j.jobData.customer.jobNumber);
check('all six blocking fields listed', j.blockingMissingFields.length === 6, JSON.stringify(j.blockingMissingFields));

console.log(
  `\n${failures === 0 ? 'All intake parser checks passed.' : `${failures} of ${checks} intake parser checks FAILED.`}`
);
process.exit(failures === 0 ? 0 : 1);
