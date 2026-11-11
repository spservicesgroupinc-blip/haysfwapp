// Bounds are the interiors of the outlined cells in the approved Letter form.
// Keeping these together makes the form controls and PDF edit targets agree.
function box<const Key extends string>(key: Key, label: string, group: string, top: number, bottom: number, x = 22.68, width = 64.46) {
  return { key, label, group, x, top, width, height: bottom - top };
}

export const CHECKLIST_BOXES = [
  box('jobNumberVerified', 'Verify job number', 'Homeowner information', 123.74, 139.82),
  box('deductibleVerified', 'Verify deductible', 'Homeowner information', 140.3, 156.38),
  box('emailVerified', 'Verify email address', 'Homeowner information', 173.54, 186.98),
  box('phoneVerified', 'Verify phone number', 'Homeowner information', 187.46, 201.02),
  box('alternatePhoneVerified', 'Verify alternate phone number', 'Homeowner information', 201.5, 215.06),
  box('preliminaryReportVerified', 'Preliminary report with correct information', 'Required documentation', 229.97, 246.17),
  box('repairAuthorizationVerified', 'Repair authorization / contract', 'Required documentation', 247.13, 260.69),
  box('xactimateVersionVerified', 'Verify Xactimate version', 'Required documentation', 261.65, 277.73),
  box('mortgageAuthorizationVerified', 'Signed mortgage authorization enclosed', 'Required documentation', 278.69, 302.45),
  box('documentExceptionsVerified', 'Missing documentation explained', 'Required documentation', 303.41, 316.97),
  box('scopeCopyVerified', 'Copy of scope', 'Required documentation', 229.97, 246.17, 384.07, 21.75),
  box('picturesVerified', 'Pictures / Matterport in DASH', 'Required documentation', 247.13, 260.69, 384.07, 21.75),
  box('approvedEstimateVerified', 'Two copies of approved estimate', 'Required documentation', 261.65, 277.73, 384.07, 21.75),
  box('buildingPermitVerified', 'Building permit enclosed / county verified', 'Required documentation', 278.69, 302.45, 384.07, 21.75),
  box('gmVerificationComplete', 'Checklist verified by GM', 'IPC requirements', 331.97, 348.05),
  box('insuranceAuthorizationsUploaded', 'Insurance authorizations uploaded', 'IPC requirements', 348.53, 364.73),
  box('welcomeLetterEmailed', 'New customer letter emailed with link', 'IPC requirements', 365.21, 378.65),
  box('insuranceCompanyVerified', 'Verify insurance company', 'Agent / adjuster information', 393.19, 406.75),
  box('agentNameVerified', 'Verify agent name', 'Agent / adjuster information', 407.23, 423.31),
  box('agentPhoneVerified', 'Verify agent phone number', 'Agent / adjuster information', 423.79, 439.87),
  box('adjusterNameVerified', 'Verify adjuster name', 'Agent / adjuster information', 440.35, 453.91),
  box('adjusterPhoneVerified', 'Verify adjuster phone number', 'Agent / adjuster information', 454.39, 470.47),
  box('adjusterEmailVerified', 'Verify adjuster email', 'Agent / adjuster information', 470.95, 484.51),
  box('contactsListedInDash', 'Contact information listed in DASH', 'Agent / adjuster information', 484.99, 501.07),
  box('claimNumberVerified', 'Verify claim number', 'Claim / check information', 515.59, 529.15),
  box('programClaimVerified', 'Verify program claim status', 'Claim / check information', 515.59, 529.15, 383.83, 33.99),
  box('checkSentVerified', 'Verify check sent status', 'Claim / check information', 529.64, 545.74),
  box('checkPayeeVerified', 'Verify check payable to', 'Claim / check information', 546.22, 559.78),
  box('mortgageOnCheckVerified', 'Verify mortgage on check', 'Claim / check information', 560.26, 573.7),
  box('depreciationVerified', 'Verify depreciation withheld', 'Claim / check information', 574.18, 587.74),
  box('contractAmountVerified', 'Verify contract amount', 'Claim / check information', 588.22, 606.58),
  box('estimatorVerified', 'Verify estimator', 'Claim / check information', 607.06, 620.62),
  box('managerNotesVerified', 'Verify project manager notes', 'Project manager notes', 651.7, 665.26),
] as const;

export type ChecklistBoxKey = typeof CHECKLIST_BOXES[number]['key'];
