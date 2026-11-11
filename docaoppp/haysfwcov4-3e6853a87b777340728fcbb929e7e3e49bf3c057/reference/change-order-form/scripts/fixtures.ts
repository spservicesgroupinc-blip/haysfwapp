/**
 * Test fixtures for the PDF harnesses.
 *
 * These deliberately live OUTSIDE src/ so the shipped application contains no
 * demo/sample data. Only the PDF generation/audit scripts import this file.
 *
 * The values here are load-bearing: `scripts/check-text.ts` asserts that text
 * from the END of long fields actually renders, so keep the tails of
 * `lossDescription` / `scopeDescription` / `projectManagerNotes` intact.
 */
import { RestorationJobData, createEmptyJob } from '../src/types/jobData';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function build(overrides: DeepPartial<RestorationJobData>): RestorationJobData {
  const base = createEmptyJob();
  const merge = (target: any, source: any) => {
    Object.keys(source).forEach((key) => {
      const value = source[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (!target[key] || typeof target[key] !== 'object') target[key] = {};
        merge(target[key], value);
      } else if (value !== undefined && value !== null) {
        target[key] = value;
      }
    });
    return target;
  };
  return merge(base, overrides as any) as RestorationJobData;
}

/** Water damage — the primary scenario, aligned to the content markers. */
export const SAMPLE_WATER: RestorationJobData = build({
  recordId: 'fixture-water-0001',
  dateCreated: '2026-08-15',
  customer: {
    jobNumber: 'FW-2026-0842',
    jobName: 'Wilson Residential Restoration',
    customerName: 'Megan Wilson',
    mailingAddress: '4111 S 200 W',
    mailingCityStateZip: 'Berne, IN 46711',
    lossAddress: '4111 S 200 W, Berne, IN 46711',
    lossContact: 'Megan Wilson',
    mainPhone: '1-260-555-0192',
    homePhone: '1-260-555-0192',
    mobilePhone: '1-260-555-8831',
    email: 'mwilson@example.com',
  },
  insurance: {
    carrier: 'State Farm Insurance',
    primaryAdjuster: 'David Miller',
    adjusterPhone: '1-260-555-4491',
    adjusterEmail: 'dmiller@statefarmclaims.com',
    independentAdjuster: 'Midwest Property Adjusters',
    brokerAgent: 'Sarah Jenkins Agency',
    agentPhone: '1-260-555-3211',
    policyNumber: 'SF-IN-9841209',
    claimNumber: 'CLM-2026-8812',
    referredBy: 'Insurance Carrier Roster',
    dateOfLoss: '2026-08-15',
    timeOfLoss: '14:30',
    dateReceived: '2026-08-16',
    timeReceived: '09:00',
    dateInsuredContacted: '2026-08-16',
    timeInsuredContacted: '10:15',
    dateInspected: '2026-08-18',
    typeOfLoss: 'Water - Supply Line Burst',
    typeOfLossSecondary: 'Structural Flooring Damage',
    roughEstimateAmount: 18500,
    lossDescription:
      'Sudden pipe burst in upstairs guest bathroom resulting in water migration through subflooring into kitchen ceiling and cabinetry below.',
    specialInstructions: 'Homeowner works from home Tuesdays and Thursdays. Contact 30 mins prior to arrival.',
    detailedFindings:
      'Moisture readings >80% in kitchen ceiling drywall. Hardwood flooring in hallway cupping. Remediation equipment deployed 08/16.',
  },
  financials: {
    totalApprovedRcv: 24850,
    deductible: 1000,
    netClaimValue: 23850,
    downPayment: 12425,
    midProgressPayment: 6212.5,
    balancePayment: 6212.5,
    commenceDays: 10,
    completeDays: 60,
  },
  team: {
    projectManager: 'Markus Henderson',
  },
  mortgage: {
    hasMortgage: true,
    mortgageCompany: 'Chase Home Lending',
    mortgagePhone: '1-800-848-9136',
    loanNumber: 'HL-88291044',
    last4Ssn: '4482',
  },
  changeOrder: {
    changeOrderNumber: 'CO-01',
    changeOrderDate: '2026-08-28',
    isInsuranceRelated: true,
    scopeDescription:
      'Additional water damage discovered behind master bathroom tile surround requiring replacement of backer board, framing sistering, and moisture barrier.',
    originalContractSum: 24850,
    netPreviousChanges: 0,
    changeAmount: 3200,
    changeType: 'increase',
    addedDays: 5,
  },
  checklist: {
    hasDeductibleBeenCollected: 'Yes',
    deductibleExplanation: 'Deductible collected via check #1042 at pre-construction walk.',
    isProgramClaim: true,
    hasCheckBeenSent: true,
    checkPayableTo: 'Hays and Sons & Megan Wilson',
    isDepreciationWithheld: true,
    depreciationAmount: 2600,
    startDate: '2026-09-01',
    finishDate: '2026-10-30',
    projectManagerNotes: 'All drywall and flooring samples selected and confirmed by homeowner.',
  },
  productionNotes: {
    scopeSummary: 'Replace water-damaged kitchen ceiling drywall, cabinetry, and hallway hardwood flooring.',
    materialsAndEquipment: 'Match existing oak flooring; paint to match; dehumidifiers staged in garage.',
    scheduleAndAccess: 'Crew arrives 7:30 AM weekdays; key code #4411 for front door.',
    safetyConsiderations: 'Containment around kitchen; respirator required for drywall removal.',
    communicationNotes: 'Update adjuster David Miller weekly; homeowner prefers text updates.',
    additionalNotes: 'Photos uploaded to DASH after each phase.',
  },
});

/** Wind/storm — a second scenario to vary field values and text wrapping. */
export const SAMPLE_STORM: RestorationJobData = build({
  recordId: 'fixture-storm-0002',
  dateCreated: '2026-08-20',
  customer: {
    jobNumber: 'FW-2026-0914',
    jobName: 'Taylor Roof & Siding Restoration',
    customerName: 'Robert Taylor',
    mailingAddress: '1422 Northcrest Way',
    mailingCityStateZip: 'Fort Wayne, IN 46825',
    lossAddress: '1422 Northcrest Way, Fort Wayne, IN 46825',
    lossContact: 'Robert Taylor',
    mobilePhone: '1-260-705-4421',
    email: 'rtaylor77@gmail.com',
  },
  insurance: {
    carrier: 'Allstate Insurance',
    primaryAdjuster: 'Brenda Vance',
    adjusterPhone: '1-800-555-8291',
    adjusterEmail: 'bvance@allstate.com',
    independentAdjuster: 'Crawford & Company',
    brokerAgent: 'Kohlmeier Agency Fort Wayne',
    agentPhone: '1-260-484-2100',
    policyNumber: 'AL-8830192',
    claimNumber: 'CLM-ALL-99218',
    referredBy: 'Agent Referral',
    dateOfLoss: '2026-08-10',
    dateReceived: '2026-08-11',
    dateInspected: '2026-08-12',
    typeOfLoss: 'Storm / Wind / Hail',
    typeOfLossSecondary: 'Roof Sheathing & Attic Water Intrusion',
    roughEstimateAmount: 32000,
    lossDescription:
      'Severe windstorm caused tree limb impact to northwest roof plane, penetrating decking and allowing rain intrusion into attic insulation and master bedroom ceiling.',
    specialInstructions: 'Large guard dog secured in detached garage. Contact Robert 1 hour ahead of site visits.',
    detailedFindings:
      'Fourteen rafters require sistering or replacement. Blown insulation saturated and removed under emergency phase. Tarping secured 08/11.',
  },
  financials: {
    totalApprovedRcv: 34200,
    deductible: 1500,
    netClaimValue: 32700,
    downPayment: 17100,
    midProgressPayment: 8550,
    balancePayment: 8550,
    commenceDays: 10,
    completeDays: 60,
  },
  team: {
    projectManager: 'Markus Henderson',
    foreman: 'Dave Kowalski',
  },
  mortgage: {
    hasMortgage: true,
    mortgageCompany: 'Wells Fargo Home Mortgage',
    mortgagePhone: '1-800-416-1472',
    loanNumber: 'WF-009841284',
    last4Ssn: '8192',
    spouseLast4Ssn: '3310',
  },
  changeOrder: {
    changeOrderNumber: 'CO-01',
    changeOrderDate: '2026-08-25',
    scopeDescription:
      'Upgraded shingles to Class 4 Impact Resistant Architectural shingles and replaced rotted fascias discovered upon tear-off.',
    originalContractSum: 34200,
    changeAmount: 4150,
    changeType: 'increase',
    addedDays: 4,
  },
  checklist: {
    hasDeductibleBeenCollected: 'Yes',
    deductibleExplanation: 'Collected in full by check #4012.',
    isDepreciationWithheld: true,
    depreciationAmount: 4200,
    startDate: '2026-09-08',
    finishDate: '2026-10-18',
    projectManagerNotes: 'Shingle color: Timberline HDZ Charcoal confirmed by homeowner.',
  },
});

/** Fire — a third scenario with the largest amounts. */
export const SAMPLE_FIRE: RestorationJobData = build({
  recordId: 'fixture-fire-0003',
  dateCreated: '2026-08-22',
  customer: {
    jobNumber: 'FW-2026-0975',
    jobName: 'Miller Kitchen Fire Reconstruction',
    customerName: 'Sarah Miller',
    mailingAddress: '802 W 7th Street',
    mailingCityStateZip: 'Auburn, IN 46706',
    lossAddress: '802 W 7th Street, Auburn, IN 46706',
    lossContact: 'Sarah Miller',
    mobilePhone: '1-260-312-8874',
    email: 'smiller.auburn@outlook.com',
  },
  insurance: {
    carrier: 'Liberty Mutual',
    primaryAdjuster: 'Thomas Briggs',
    adjusterPhone: '1-800-225-2467',
    adjusterEmail: 'tbriggs@libertymutual.com',
    independentAdjuster: 'Sedgwick CMS',
    brokerAgent: 'DeKalb County Insurance Partners',
    agentPhone: '1-260-925-3300',
    policyNumber: 'LM-IN-776102',
    claimNumber: 'CLM-2026-00449',
    referredBy: 'Carrier Direct Program',
    dateOfLoss: '2026-08-18',
    dateReceived: '2026-08-19',
    dateInspected: '2026-08-20',
    typeOfLoss: 'Fire & Smoke Damage',
    typeOfLossSecondary: 'Water Extinguishment & HVAC Soot Contamination',
    roughEstimateAmount: 55000,
    lossDescription:
      'Stovetop grease fire ignited range hood and upper cabinets, spreading heavy soot throughout the first floor and HVAC ductwork.',
    specialInstructions: 'Family staying in temporary rental. Lockbox code on rear patio door.',
    detailedFindings:
      'Full kitchen gut required down to studs. Thermal fogging and negative air scrubbing completed during emergency mitigation.',
  },
  financials: {
    totalApprovedRcv: 58900,
    deductible: 2500,
    netClaimValue: 56400,
    downPayment: 29450,
    midProgressPayment: 14725,
    balancePayment: 14725,
    commenceDays: 10,
    completeDays: 60,
  },
  team: {
    projectManager: 'Markus Henderson',
    foreman: 'Troy Billings',
  },
  mortgage: {
    hasMortgage: true,
    mortgageCompany: 'Rocket Mortgage',
    mortgagePhone: '1-800-251-1400',
    loanNumber: 'RM-33491028',
    last4Ssn: '5501',
    spouseLast4Ssn: '9082',
  },
  changeOrder: {
    changeOrderNumber: 'CO-01',
    changeOrderDate: '2026-09-02',
    scopeDescription:
      'Cabinet upgrade to solid plywood boxes with soft-close hardware, plus replacement of ductwork serving the first floor.',
    originalContractSum: 58900,
    changeAmount: 6800,
    changeType: 'increase',
    addedDays: 6,
  },
  checklist: {
    hasDeductibleBeenCollected: 'Pending',
    deductibleExplanation: 'Payment plan arranged with homeowner; first installment due at pre-construction.',
    isProgramClaim: true,
    hasCheckBeenSent: true,
    isDepreciationWithheld: true,
    depreciationAmount: 6100,
    startDate: '2026-09-15',
    finishDate: '2026-11-20',
    projectManagerNotes: 'Homeowner selecting finishes with designer. Appliance lead times run 4-6 weeks.',
  },
});
