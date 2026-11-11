/**
 * Per-document editable field schemas for the click-to-edit PDF preview.
 *
 * Each entry describes one data field a generated PDF displays. The `key` is a
 * dot-path into `RestorationJobData` ('section.field') and MUST match the span
 * keys recorded by the generators in `pdfService.ts` — the span test
 * (scripts/test-pdf-spans.ts) asserts that every non-empty schema field has at
 * least one recorded span in its document.
 *
 * Composite fields (`parts`) render as one line in the PDF but are backed by
 * several jobData fields (e.g. mailing address + city/state/zip). Clicking
 * their span opens a small multi-input editor instead of a single input.
 *
 * Kinds drive the inline editor widget:
 *   text, multiline, phone, email, date, time, currency, int,
 *   boolean (Yes/No), yesNoPending (Yes/No/Pending), select (options[]).
 */

export type PdfFieldKind =
  | 'text'
  | 'multiline'
  | 'phone'
  | 'email'
  | 'date'
  | 'time'
  | 'currency'
  | 'int'
  | 'boolean'
  | 'yesNoPending'
  | 'select';

export interface PdfEditableField {
  /** Dot-path of the jobData field — also the span key. */
  key: string;
  label: string;
  kind: PdfFieldKind;
  /** Group heading in the fields drawer, e.g. 'Insurance Details'. */
  group: string;
  /** Composite: value composed of several jobData fields. */
  parts?: { field: string; label: string; kind: PdfFieldKind }[];
  /** Options for kind 'select'. */
  options?: string[];
  /** Drawer-only fields have no clickable span on the page (e.g. letterhead). */
  drawerOnly?: boolean;
}

const branchFields: PdfEditableField[] = [
  { key: 'branch.name', label: 'Branch Name', kind: 'text', group: 'Branch / Letterhead', drawerOnly: true },
  { key: 'branch.division', label: 'Division', kind: 'text', group: 'Branch / Letterhead', drawerOnly: true },
  { key: 'branch.address', label: 'Address', kind: 'text', group: 'Branch / Letterhead', drawerOnly: true },
  { key: 'branch.cityStateZip', label: 'City, State ZIP', kind: 'text', group: 'Branch / Letterhead', drawerOnly: true },
  { key: 'branch.phone', label: 'Phone', kind: 'phone', group: 'Branch / Letterhead', drawerOnly: true },
  { key: 'branch.fax', label: 'Fax', kind: 'phone', group: 'Branch / Letterhead', drawerOnly: true },
  { key: 'branch.managerName', label: 'Manager Name', kind: 'text', group: 'Branch / Letterhead', drawerOnly: true },
  { key: 'branch.managerEmail', label: 'Manager Email', kind: 'email', group: 'Branch / Letterhead', drawerOnly: true },
];

const mailingLine: PdfEditableField = {
  key: 'customer.mailingLine',
  label: 'Mailing Address',
  kind: 'text',
  group: 'Customer Details',
  parts: [
    { field: 'customer.mailingAddress', label: 'Address', kind: 'text' },
    { field: 'customer.mailingCityStateZip', label: 'City, State ZIP', kind: 'text' },
  ],
};

export const PDF_FIELD_SCHEMA: Record<string, PdfEditableField[]> = {
  prelim: [
    ...branchFields,
    { key: 'insurance.carrier', label: 'Insurance Carrier', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.primaryAdjuster', label: 'Primary Adjuster', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.independentAdjuster', label: 'Independent Adjuster', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.brokerAgent', label: 'Broker / Agent', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.policyNumber', label: 'Policy Number', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.claimNumber', label: 'Claim Number', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.reportedBy', label: 'Reported By', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.referredBy', label: 'Referred By', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.dateReceived', label: 'Date Received', kind: 'date', group: 'Insurance Details' },
    { key: 'insurance.timeReceived', label: 'Time Received', kind: 'time', group: 'Insurance Details' },
    { key: 'insurance.dateOfLoss', label: 'Date of Loss', kind: 'date', group: 'Insurance Details' },
    { key: 'insurance.timeOfLoss', label: 'Time of Loss', kind: 'time', group: 'Insurance Details' },
    { key: 'insurance.dateInsuredContacted', label: 'Date Insured Contacted', kind: 'date', group: 'Insurance Details' },
    { key: 'insurance.timeInsuredContacted', label: 'Time Insured Contacted', kind: 'time', group: 'Insurance Details' },
    { key: 'insurance.dateInspected', label: 'Date Inspected', kind: 'date', group: 'Insurance Details' },
    { key: 'insurance.typeOfLoss', label: 'Type of Loss', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.typeOfLossSecondary', label: 'Type of Loss (Secondary)', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.roughEstimateAmount', label: 'Rough Estimate', kind: 'currency', group: 'Insurance Details' },
    { key: 'insurance.lossDescription', label: 'Loss Description', kind: 'multiline', group: 'Insurance Details' },
    { key: 'insurance.specialInstructions', label: 'Special Instructions', kind: 'multiline', group: 'Insurance Details' },
    { key: 'insurance.detailedFindings', label: 'Detailed Findings', kind: 'multiline', group: 'Insurance Details' },
    { key: 'customer.jobNumber', label: 'Job Number', kind: 'text', group: 'Customer Details' },
    { key: 'customer.jobName', label: 'Job Name', kind: 'text', group: 'Customer Details' },
    { key: 'customer.customerName', label: 'Customer Name', kind: 'text', group: 'Customer Details' },
    mailingLine,
    { key: 'customer.mainPhone', label: 'Main Phone', kind: 'phone', group: 'Customer Details' },
    { key: 'customer.homePhone', label: 'Home Phone', kind: 'phone', group: 'Customer Details' },
    { key: 'customer.mobilePhone', label: 'Mobile Phone', kind: 'phone', group: 'Customer Details' },
    { key: 'customer.email', label: 'Email', kind: 'email', group: 'Customer Details' },
    { key: 'customer.lossAddress', label: 'Loss Address', kind: 'text', group: 'Customer Details' },
    { key: 'customer.lossContact', label: 'Loss Contact', kind: 'text', group: 'Customer Details' },
    { key: 'financials.deductible', label: 'Deductible', kind: 'currency', group: 'Financials' },
    { key: 'team.estimator', label: 'Estimator', kind: 'text', group: 'Team' },
    { key: 'team.supervisor', label: 'Supervisor', kind: 'text', group: 'Team' },
    { key: 'team.coordinator', label: 'Coordinator', kind: 'text', group: 'Team' },
    { key: 'team.foreman', label: 'Foreman', kind: 'text', group: 'Team' },
    { key: 'team.marketingPerson', label: 'Marketing Person', kind: 'text', group: 'Team' },
    { key: 'team.accountingPerson', label: 'Accounting Person', kind: 'text', group: 'Team' },
  ],

  welcome: [
    ...branchFields,
    { key: 'customer.customerName', label: 'Customer Name', kind: 'text', group: 'Customer Details' },
    mailingLine,
    { key: 'customer.jobNumber', label: 'Job Number', kind: 'text', group: 'Customer Details' },
    { key: 'customer.lossAddress', label: 'Loss Address', kind: 'text', group: 'Customer Details' },
    { key: 'insurance.claimNumber', label: 'Claim Number', kind: 'text', group: 'Insurance Details' },
    { key: 'team.estimator', label: 'Estimator', kind: 'text', group: 'Team' },
    { key: 'team.projectManager', label: 'Project Manager', kind: 'text', group: 'Team' },
  ],

  mortgage: [
    ...branchFields,
    { key: 'mortgage.hasMortgage', label: 'Has Mortgage', kind: 'boolean', group: 'Mortgage Details' },
    { key: 'mortgage.mortgageCompany', label: 'Mortgage Company', kind: 'text', group: 'Mortgage Details' },
    { key: 'mortgage.mortgagePhone', label: 'Mortgage Phone', kind: 'phone', group: 'Mortgage Details' },
    { key: 'mortgage.loanNumber', label: 'Loan Number', kind: 'text', group: 'Mortgage Details' },
    { key: 'mortgage.last4Ssn', label: 'Last 4 SSN', kind: 'text', group: 'Mortgage Details' },
    { key: 'mortgage.spouseLast4Ssn', label: 'Spouse Last 4 SSN', kind: 'text', group: 'Mortgage Details' },
    { key: 'customer.jobNumber', label: 'Job Number', kind: 'text', group: 'Customer Details' },
    { key: 'customer.customerName', label: 'Customer Name', kind: 'text', group: 'Customer Details' },
    { key: 'customer.lossAddress', label: 'Loss Address', kind: 'text', group: 'Customer Details' },
    { key: 'insurance.carrier', label: 'Insurance Carrier', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.claimNumber', label: 'Claim Number', kind: 'text', group: 'Insurance Details' },
  ],

  contract: [
    ...branchFields,
    { key: 'customer.customerName', label: 'Customer Name', kind: 'text', group: 'Customer Details' },
    { key: 'customer.lossAddress', label: 'Loss Address', kind: 'text', group: 'Customer Details' },
    { key: 'customer.mailingCityStateZip', label: 'City, State ZIP', kind: 'text', group: 'Customer Details' },
    {
      key: 'customer.phoneLine',
      label: 'Phone',
      kind: 'text',
      group: 'Customer Details',
      parts: [
        { field: 'customer.mobilePhone', label: 'Mobile Phone', kind: 'phone' },
        { field: 'customer.mainPhone', label: 'Main Phone', kind: 'phone' },
      ],
    },
    { key: 'customer.jobNumber', label: 'Job Number', kind: 'text', group: 'Customer Details' },
    { key: 'customer.email', label: 'Email', kind: 'email', group: 'Customer Details' },
    { key: 'insurance.carrier', label: 'Insurance Carrier', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.claimNumber', label: 'Claim Number', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.policyNumber', label: 'Policy Number', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.primaryAdjuster', label: 'Primary Adjuster', kind: 'text', group: 'Insurance Details' },
    { key: 'financials.commenceDays', label: 'Commence (days)', kind: 'int', group: 'Financials' },
    { key: 'financials.completeDays', label: 'Complete (days)', kind: 'int', group: 'Financials' },
    { key: 'financials.totalApprovedRcv', label: 'Total Approved RCV', kind: 'currency', group: 'Financials' },
    { key: 'financials.deductible', label: 'Deductible', kind: 'currency', group: 'Financials' },
    { key: 'team.estimator', label: 'Estimator', kind: 'text', group: 'Team' },
    { key: 'team.projectManager', label: 'Project Manager', kind: 'text', group: 'Team' },
  ],

  cancellation: [
    ...branchFields,
    { key: 'customer.jobNumber', label: 'Job Number', kind: 'text', group: 'Customer Details' },
    { key: 'customer.customerName', label: 'Customer Name', kind: 'text', group: 'Customer Details' },
    { key: 'customer.lossAddress', label: 'Loss Address', kind: 'text', group: 'Customer Details' },
    { key: 'insurance.dateReceived', label: 'Agreement Date', kind: 'date', group: 'Insurance Details' },
  ],

  change_order: [
    ...branchFields,
    { key: 'changeOrder.changeOrderNumber', label: 'Change Order Number', kind: 'text', group: 'Change Order' },
    { key: 'changeOrder.changeOrderDate', label: 'Change Order Date', kind: 'date', group: 'Change Order' },
    { key: 'changeOrder.isInsuranceRelated', label: 'Insurance Related', kind: 'boolean', group: 'Change Order' },
    { key: 'changeOrder.scopeDescription', label: 'Scope Description', kind: 'multiline', group: 'Change Order' },
    { key: 'changeOrder.originalContractSum', label: 'Original Contract Sum', kind: 'currency', group: 'Change Order' },
    { key: 'changeOrder.netPreviousChanges', label: 'Net Previous Changes', kind: 'currency', group: 'Change Order' },
    { key: 'changeOrder.changeAmount', label: 'Change Amount', kind: 'currency', group: 'Change Order' },
    {
      key: 'changeOrder.changeType',
      label: 'Change Type',
      kind: 'select',
      group: 'Change Order',
      options: ['increase', 'decrease', 'unchanged'],
    },
    { key: 'changeOrder.addedDays', label: 'Added Days', kind: 'int', group: 'Change Order' },
    { key: 'customer.customerName', label: 'Customer Name', kind: 'text', group: 'Customer Details' },
    { key: 'customer.jobNumber', label: 'Job Number', kind: 'text', group: 'Customer Details' },
    { key: 'customer.lossAddress', label: 'Loss Address', kind: 'text', group: 'Customer Details' },
    { key: 'insurance.carrier', label: 'Insurance Carrier', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.claimNumber', label: 'Claim Number', kind: 'text', group: 'Insurance Details' },
  ],

  checklist: [
    ...branchFields,
    {
      key: 'checklist.hasDeductibleBeenCollected',
      label: 'Deductible Collected',
      kind: 'yesNoPending',
      group: 'Checklist',
      options: ['Yes', 'No', 'Pending'],
    },
    { key: 'checklist.deductibleExplanation', label: 'Deductible Explanation', kind: 'multiline', group: 'Checklist' },
    { key: 'checklist.xactimateVersion', label: 'Xactimate Version', kind: 'text', group: 'Checklist' },
    { key: 'checklist.isSelfPay', label: 'Self Pay', kind: 'boolean', group: 'Checklist' },
    { key: 'checklist.isProgramClaim', label: 'Program Claim', kind: 'boolean', group: 'Checklist' },
    { key: 'checklist.hasCheckBeenSent', label: 'Check Has Been Sent', kind: 'boolean', group: 'Checklist' },
    { key: 'checklist.checkToWhom', label: 'Check To Whom', kind: 'text', group: 'Checklist' },
    { key: 'checklist.checkPayableTo', label: 'Check Payable To', kind: 'text', group: 'Checklist' },
    { key: 'checklist.isDepreciationWithheld', label: 'Depreciation Withheld', kind: 'boolean', group: 'Checklist' },
    { key: 'checklist.depreciationAmount', label: 'Depreciation Amount', kind: 'currency', group: 'Checklist' },
    { key: 'checklist.startDate', label: 'Start Date', kind: 'date', group: 'Checklist' },
    { key: 'checklist.finishDate', label: 'Finish Date', kind: 'date', group: 'Checklist' },
    { key: 'checklist.projectManagerNotes', label: 'Project Manager Notes', kind: 'multiline', group: 'Checklist' },
    { key: 'customer.customerName', label: 'Customer Name', kind: 'text', group: 'Customer Details' },
    { key: 'customer.jobNumber', label: 'Job Number', kind: 'text', group: 'Customer Details' },
    { key: 'customer.lossAddress', label: 'Loss Address', kind: 'text', group: 'Customer Details' },
    { key: 'customer.jobName', label: 'Job Name', kind: 'text', group: 'Customer Details' },
    { key: 'customer.email', label: 'Email', kind: 'email', group: 'Customer Details' },
    { key: 'customer.mainPhone', label: 'Main Phone', kind: 'phone', group: 'Customer Details' },
    { key: 'customer.mobilePhone', label: 'Mobile Phone', kind: 'phone', group: 'Customer Details' },
    { key: 'financials.deductible', label: 'Deductible', kind: 'currency', group: 'Financials' },
    { key: 'financials.totalApprovedRcv', label: 'Total Approved RCV', kind: 'currency', group: 'Financials' },
    { key: 'insurance.carrier', label: 'Insurance Carrier', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.brokerAgent', label: 'Broker / Agent', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.agentPhone', label: 'Agent Phone', kind: 'phone', group: 'Insurance Details' },
    { key: 'insurance.primaryAdjuster', label: 'Primary Adjuster', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.adjusterPhone', label: 'Adjuster Phone', kind: 'phone', group: 'Insurance Details' },
    { key: 'insurance.adjusterEmail', label: 'Adjuster Email', kind: 'email', group: 'Insurance Details' },
    { key: 'insurance.claimNumber', label: 'Claim Number', kind: 'text', group: 'Insurance Details' },
    { key: 'team.estimator', label: 'Estimator', kind: 'text', group: 'Team' },
    { key: 'team.projectManager', label: 'Project Manager', kind: 'text', group: 'Team' },
    { key: 'mortgage.hasMortgage', label: 'Has Mortgage', kind: 'boolean', group: 'Mortgage Details' },
    { key: 'mortgage.mortgageCompany', label: 'Mortgage Company', kind: 'text', group: 'Mortgage Details' },
  ],

  production_notes: [
    ...branchFields,
    { key: 'productionNotes.scopeSummary', label: 'Scope Summary', kind: 'multiline', group: 'Production Notes' },
    { key: 'productionNotes.materialsAndEquipment', label: 'Materials & Equipment', kind: 'multiline', group: 'Production Notes' },
    { key: 'productionNotes.scheduleAndAccess', label: 'Schedule & Access', kind: 'multiline', group: 'Production Notes' },
    { key: 'productionNotes.safetyConsiderations', label: 'Safety Considerations', kind: 'multiline', group: 'Production Notes' },
    { key: 'productionNotes.communicationNotes', label: 'Communication Notes', kind: 'multiline', group: 'Production Notes' },
    { key: 'productionNotes.additionalNotes', label: 'Additional Notes', kind: 'multiline', group: 'Production Notes' },
    { key: 'customer.jobNumber', label: 'Job Number', kind: 'text', group: 'Customer Details' },
    { key: 'customer.jobName', label: 'Job Name', kind: 'text', group: 'Customer Details' },
    { key: 'customer.customerName', label: 'Customer Name', kind: 'text', group: 'Customer Details' },
    { key: 'customer.lossAddress', label: 'Loss Address', kind: 'text', group: 'Customer Details' },
    { key: 'insurance.dateOfLoss', label: 'Date of Loss', kind: 'date', group: 'Insurance Details' },
    { key: 'insurance.timeOfLoss', label: 'Time of Loss', kind: 'time', group: 'Insurance Details' },
    { key: 'insurance.typeOfLoss', label: 'Type of Loss', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.typeOfLossSecondary', label: 'Type of Loss (Secondary)', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.carrier', label: 'Insurance Carrier', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.claimNumber', label: 'Claim Number', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.policyNumber', label: 'Policy Number', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.primaryAdjuster', label: 'Primary Adjuster', kind: 'text', group: 'Insurance Details' },
    { key: 'insurance.adjusterPhone', label: 'Adjuster Phone', kind: 'phone', group: 'Insurance Details' },
    { key: 'insurance.lossDescription', label: 'Loss Description', kind: 'multiline', group: 'Insurance Details' },
    { key: 'financials.deductible', label: 'Deductible', kind: 'currency', group: 'Financials' },
    { key: 'financials.totalApprovedRcv', label: 'Total Approved RCV', kind: 'currency', group: 'Financials' },
    { key: 'financials.netClaimValue', label: 'Net Claim Value', kind: 'currency', group: 'Financials' },
  ],
};

/** Returns the editable-field schema for a document id (documentCatalog DOC key). */
export function getPdfFieldSchema(docId: string): PdfEditableField[] {
  return PDF_FIELD_SCHEMA[docId] ?? [];
}
