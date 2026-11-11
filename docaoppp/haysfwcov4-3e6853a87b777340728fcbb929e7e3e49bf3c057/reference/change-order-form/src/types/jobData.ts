export interface CustomerData {
  jobNumber: string;
  jobName: string;
  customerName: string;
  mailingAddress: string;
  mailingCityStateZip: string;
  lossAddress: string;
  lossContact: string;
  mainPhone: string;
  homePhone: string;
  mobilePhone: string;
  email: string;
}

export interface InsuranceData {
  carrier: string;
  primaryAdjuster: string;
  adjusterPhone: string;
  adjusterEmail: string;
  independentAdjuster: string;
  brokerAgent: string;
  agentPhone: string;
  policyNumber: string;
  claimNumber: string;
  reportedBy: string;
  referredBy: string;
  dateOfLoss: string;
  timeOfLoss: string;
  dateReceived: string;
  timeReceived: string;
  dateInsuredContacted: string;
  timeInsuredContacted: string;
  dateInspected: string;
  typeOfLoss: string;
  typeOfLossSecondary: string;
  roughEstimateAmount: number | '';
  lossDescription: string;
  specialInstructions: string;
  detailedFindings: string;
}

export interface FinancialData {
  totalApprovedRcv: number | '';
  deductible: number | '';
  netClaimValue: number;
  downPayment: number; // 50%
  midProgressPayment: number; // 25%
  balancePayment: number; // 25%
  commenceDays: number; // default 10
  completeDays: number; // default 60
}

export interface TeamData {
  estimator: string;
  supervisor: string;
  coordinator: string;
  projectManager: string;
  foreman: string;
  marketingPerson: string;
  accountingPerson: string;
}

export interface MortgageData {
  hasMortgage: boolean;
  mortgageCompany: string;
  mortgagePhone: string;
  loanNumber: string;
  last4Ssn: string;
  spouseLast4Ssn: string;
}

export interface ChangeOrderData {
  changeOrderNumber: string;
  changeOrderDate: string;
  isInsuranceRelated: boolean;
  scopeDescription: string;
  originalContractSum: number | '';
  netPreviousChanges: number | '';
  changeAmount: number | '';
  changeType: 'increase' | 'decrease' | 'unchanged';
  addedDays: number | '';
}

export interface ProductionNotesData {
  /** Narrative summary of the scope and repairs for this loss. */
  scopeSummary: string;
  /** Materials, finishes, and equipment required for production. */
  materialsAndEquipment: string;
  /** Scheduling notes, site access, and staging details. */
  scheduleAndAccess: string;
  /** Safety considerations and hazards on the job site. */
  safetyConsiderations: string;
  /** Communication notes for the customer, adjuster, and crew. */
  communicationNotes: string;
  /** Free-form catch-all for anything else the production team tracks. */
  additionalNotes: string;
}

export interface BranchData {
  name: string;
  division: string;
  address: string;
  cityStateZip: string;
  phone: string;
  fax: string;
  managerName: string;
  managerEmail: string;
}

export interface RestorationJobData {
  /**
   * Immutable database key. Assigned by the customer database on first save and
   * never regenerated. Undefined on a brand-new record that has never been saved.
   */
  recordId?: string;
  id: string;
  branch: BranchData;
  dateCreated: string;
  /** ISO timestamp of the last save to the customer database. */
  updatedAt?: string;
  /** Record schema version, for future migrations. */
  schemaVersion?: number;
  customer: CustomerData;
  insurance: InsuranceData;
  financials: FinancialData;
  team: TeamData;
  mortgage: MortgageData;
  changeOrder: ChangeOrderData;
  // Production Notes — free-form fields filled by the production team.
  productionNotes: ProductionNotesData;
  // Production Checklist specific flags
  checklist: {
    hasDeductibleBeenCollected: 'Yes' | 'No' | 'Pending';
    deductibleExplanation: string;
    xactimateVersion: string;
    isSelfPay: boolean;
    isProgramClaim: boolean;
    hasCheckBeenSent: boolean;
    checkToWhom: string;
    checkPayableTo: string;
    isDepreciationWithheld: boolean;
    depreciationAmount: number | '';
    startDate: string;
    finishDate: string;
    projectManagerNotes: string;
  };
}

/** Current record schema version. Bump when the stored record shape changes. */
export const RECORD_SCHEMA_VERSION = 1;

/**
 * Generates an immutable record key. Uses the Web Crypto API when available and
 * falls back to a timestamp + random suffix in non-secure contexts.
 */
export function createRecordId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through to the manual generator */
  }
  return `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Generates the human-facing job number used in documents and the job log. */
export function createJobNumber(): string {
  return `FW-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

/** Today's date as `YYYY-MM-DD`, matching the rest of the record. */
export function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * A complete, empty job record. The single source of truth for "new job", so a
 * blank record can never drift from the type or leave inputs uncontrolled.
 */
export function createEmptyJob(): RestorationJobData {
  return {
    recordId: createRecordId(),
    id: 'JOB-' + Date.now().toString().slice(-6),
    branch: DEFAULT_BRANCH_INFO,
    dateCreated: todayIso(),
    updatedAt: '',
    schemaVersion: RECORD_SCHEMA_VERSION,
    customer: {
      jobNumber: createJobNumber(),
      jobName: '',
      customerName: '',
      mailingAddress: '',
      mailingCityStateZip: 'Fort Wayne, IN 46808',
      lossAddress: '',
      lossContact: '',
      mainPhone: '',
      homePhone: '',
      mobilePhone: '',
      email: '',
    },
    insurance: {
      carrier: '',
      primaryAdjuster: '',
      adjusterPhone: '',
      adjusterEmail: '',
      independentAdjuster: '',
      brokerAgent: '',
      agentPhone: '',
      policyNumber: '',
      claimNumber: '',
      reportedBy: 'Insured',
      referredBy: '',
      dateOfLoss: todayIso(),
      timeOfLoss: '12:00',
      dateReceived: todayIso(),
      timeReceived: '09:00',
      dateInsuredContacted: todayIso(),
      timeInsuredContacted: '10:00',
      dateInspected: todayIso(),
      typeOfLoss: 'Water - Supply Line Burst',
      typeOfLossSecondary: '',
      roughEstimateAmount: '',
      lossDescription: '',
      specialInstructions: '',
      detailedFindings: '',
    },
    financials: {
      totalApprovedRcv: '',
      deductible: '',
      netClaimValue: 0,
      downPayment: 0,
      midProgressPayment: 0,
      balancePayment: 0,
      commenceDays: 10,
      completeDays: 60,
    },
    team: {
      estimator: 'Russell Shive',
      supervisor: 'Kenny Belford',
      coordinator: 'Rhnea Schinbeckler',
      projectManager: '',
      foreman: 'To be determined',
      marketingPerson: 'Cecilia Rolf',
      accountingPerson: 'Jami Hillock',
    },
    mortgage: {
      hasMortgage: false,
      mortgageCompany: '',
      mortgagePhone: '',
      loanNumber: '',
      last4Ssn: '',
      spouseLast4Ssn: '',
    },
    changeOrder: {
      changeOrderNumber: 'CO-01',
      changeOrderDate: todayIso(),
      isInsuranceRelated: true,
      scopeDescription: '',
      originalContractSum: '',
      netPreviousChanges: 0,
      changeAmount: '',
      changeType: 'increase',
      addedDays: 0,
    },
    productionNotes: {
      scopeSummary: '',
      materialsAndEquipment: '',
      scheduleAndAccess: '',
      safetyConsiderations: '',
      communicationNotes: '',
      additionalNotes: '',
    },
    checklist: {
      hasDeductibleBeenCollected: 'No',
      deductibleExplanation: '',
      xactimateVersion: 'X1',
      isSelfPay: false,
      isProgramClaim: false,
      hasCheckBeenSent: false,
      checkToWhom: 'Hays + Sons Construction, Inc.',
      checkPayableTo: '',
      isDepreciationWithheld: false,
      depreciationAmount: '',
      startDate: '',
      finishDate: '',
      projectManagerNotes: '',
    },
  };
}

export const DEFAULT_BRANCH_INFO: BranchData = {
  name: 'Hays + Sons Complete Restoration',
  division: 'Hays and Sons - Fort Wayne',
  address: '909 Production Road',
  cityStateZip: 'Fort Wayne, IN, 46808',
  phone: '1-260-471-9110',
  fax: '1-260-471-9112',
  managerName: 'Kenneth Belford',
  managerEmail: 'kbelford@haysandsons.com',
};

/**
 * Fills any missing nested section (e.g. `productionNotes` on records saved
 * before that section existed) with blank defaults so older stored records can
 * be opened and edited without crashing.
 */
export function ensureRecordDefaults(record: RestorationJobData): RestorationJobData {
  const base = createEmptyJob();
  return {
    ...base,
    ...record,
    branch: { ...base.branch, ...(record.branch ?? {}) },
    customer: { ...base.customer, ...(record.customer ?? {}) },
    insurance: { ...base.insurance, ...(record.insurance ?? {}) },
    financials: { ...base.financials, ...(record.financials ?? {}) },
    team: { ...base.team, ...(record.team ?? {}) },
    mortgage: { ...base.mortgage, ...(record.mortgage ?? {}) },
    changeOrder: { ...base.changeOrder, ...(record.changeOrder ?? {}) },
    productionNotes: { ...base.productionNotes, ...(record.productionNotes ?? {}) },
    checklist: { ...base.checklist, ...(record.checklist ?? {}) },
  };
}

// Sample/demo data deliberately lives outside the application source (see
// scripts/fixtures.ts). The app always starts from createEmptyJob() so no
// fabricated customer records can ever ship in the bundle.

