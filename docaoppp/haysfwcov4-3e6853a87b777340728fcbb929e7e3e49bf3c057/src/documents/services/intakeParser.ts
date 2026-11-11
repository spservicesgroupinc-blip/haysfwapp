import { ProductionNotesData, RestorationJobData, createEmptyJob } from '../types/jobData';

export type FieldProvenanceType = 'EXTRACTED' | 'FOUND' | 'CALCULATED' | 'DRAFTED' | 'UNRESOLVED';

export interface ProvenanceRecord {
  [fieldKey: string]: {
    source: FieldProvenanceType;
    detail?: string;
  };
}

/** Master-record sections that pasted intake text can be routed into. */
export type SectionKey =
  | 'customer'
  | 'insurance'
  | 'financials'
  | 'team'
  | 'mortgage'
  | 'changeOrder'
  | 'productionNotes'
  | 'checklist';

export const SECTION_LABELS: Record<SectionKey, string> = {
  customer: 'Customer & Loss',
  insurance: 'Insurance & Claim',
  financials: 'Financials',
  team: 'Team',
  mortgage: 'Mortgage',
  changeOrder: 'Change Order',
  productionNotes: 'Production Notes',
  checklist: 'Production Checklist',
};

/** One value the parser found in pasted text and routed into the record. */
export interface ExtractedFieldSummary {
  key: string;
  label: string;
  section: SectionKey;
  value: string;
  source: FieldProvenanceType;
  /** True when the value replaced or added something in the record. */
  changed: boolean;
}

export interface ExtractedSectionSummary {
  section: SectionKey;
  label: string;
  fields: ExtractedFieldSummary[];
}

export interface IntakeParseResult {
  jobData: RestorationJobData;
  provenance: ProvenanceRecord;
  blockingMissingFields: string[];
  extractionSummary: {
    fieldsExtractedCount: number;
    fieldsUpdatedCount: number;
    sections: ExtractedSectionSummary[];
    warnings: string[];
    /** Short narrative the AI wrote about the document and extraction quality. */
    aiNotes?: string;
  };
}

/**
 * Structured extraction returned by the DeepSeek intake analysis call.
 * Section objects mirror the Master Job Record shape; values are raw JSON
 * (strings, numbers, booleans, null) that the intake engine sanitizes before
 * they are routed into the record.
 */
export interface AiIntakePayload {
  customer: Record<string, unknown>;
  insurance: Record<string, unknown>;
  financials: Record<string, unknown>;
  team: Record<string, unknown>;
  mortgage: Record<string, unknown>;
  changeOrder: Record<string, unknown>;
  productionNotes: Record<string, unknown>;
  checklist: Record<string, unknown>;
  /** Friendly labels of core fields the AI could not find in the source. */
  missingCoreFields?: string[];
  /** 1-2 sentence summary the AI wrote about the document. */
  analysisNotes?: string;
}

/**
 * Normalizes phone strings to standard 1-XXX-XXX-XXXX
 */
export function normalizePhone(raw: string): string {
  const withoutExtension = raw.replace(/\b(?:ext|extension|x)\.?\s*\d{1,6}\b/i, '').trim();
  const digits = withoutExtension.replace(/\D/g, '');
  if (digits.length === 10) {
    return `1-${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `1-${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return withoutExtension;
}

/**
 * Normalizes currency strings ("$12,500", "12,500.00", "(1,000)") to numbers
 */
export function parseCurrencyValue(raw: string): number | '' {
  if (!raw) return '';
  const trimmed = raw.trim();
  const negative = /^\(.*\)$/.test(trimmed) || /^(?:-\s*\$?|\$\s*-)/.test(trimmed);
  const match = trimmed.match(/-?\$?\s*([\d,]+(?:\.\d{1,2})?)/);
  if (!match) return '';
  const value = parseFloat(match[1].replace(/,/g, ''));
  if (isNaN(value)) return '';
  const signed = negative ? -value : value;
  return Math.round(signed * 100) / 100;
}

/** Formats a number for the review chips in the intake panel. */
export function formatUsd(value: number): string {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Normalizes common dates (MM/DD/YYYY, MM/DD/YY, YYYY-MM-DD, Month DD, YYYY) into YYYY-MM-DD
 */
export function normalizeDate(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const yearFirst = trimmed.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/);
  if (yearFirst) {
    return `${yearFirst[1]}-${yearFirst[2].padStart(2, '0')}-${yearFirst[3].padStart(2, '0')}`;
  }

  const mdy = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (mdy) {
    let year = mdy[3];
    if (year.length === 2) year = (parseInt(year, 10) > 60 ? '19' : '20') + year;
    const month = mdy[1].padStart(2, '0');
    const day = mdy[2].padStart(2, '0');
    if (parseInt(month, 10) >= 1 && parseInt(month, 10) <= 12) {
      return `${year}-${month}-${day}`;
    }
  }

  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }
  return '';
}

/**
 * Normalizes clock times ("3:30 PM", "15:30", "3pm", "noon") into 24h HH:MM
 */
export function normalizeTime(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value) return '';
  if (value.includes('noon')) return '12:00';
  if (value.includes('midnight')) return '00:00';
  const match = value.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/) || value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return '';
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2] ?? '0', 10);
  const period = (match[3] ?? '').toLowerCase();
  if (period === 'p' && hours < 12) hours += 12;
  if (period === 'a' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ *
 * Intake routing engine
 *
 * Pasted intake text (DASH logs, Xactimate recap lines, carrier emails,
 * field notes) is scanned with a table of labelled field definitions.
 * Every definition knows which section of the master record it belongs
 * to, how to validate/normalise its value, and how to recognise the
 * label when customers write it differently ("Claim #" vs "Claim No").
 * ------------------------------------------------------------------ */

type FieldKind =
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
  | 'ssn4';

interface SanitizedValue {
  value: any;
  display: string;
}

interface FieldDef {
  key: string;
  label: string;
  section: SectionKey;
  aliases: string[];
  kind: FieldKind;
  path: string;
  /** How many lines a value may span (default 1). */
  maxLines?: number;
  /** Normalises free text onto a fixed option list (peril, change type, ...). */
  canonicalize?: (value: string) => string | null;
  /** Values like "None" / "N/A" stay meaningful for this field instead of being rejected. */
  allowPlaceholders?: boolean;
  apply?: (job: RestorationJobData, value: any) => void;
  fallback?: (rawText: string, state: EngineState) => { value: any; display: string; detail: string } | null;
}

interface EngineState {
  job: RestorationJobData;
  provenance: ProvenanceRecord;
  consumedLines: Set<number>;
  entries: Map<string, ExtractedFieldSummary>;
  extractedCount: number;
  warnings: string[];
}

interface LabelCandidate {
  text: string;
  lines: number[];
}

interface DefMatchers {
  exact: RegExp;
  anchored: RegExp;
  flex: RegExp | null;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
const DATE_TOKEN_RE = /\b(?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{2,4})\b/i;
const TIME_TOKEN_RE = /\b(\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?|\d{1,2}\s*[ap]\.?m\.?)\b/i;
const PLACEHOLDER_RE = /^(?:tbd|tba|t\.b\.d\.?|n\/?a|none|unknown|not available|see notes|see below|pending|to be determined|missing|\?+|none provided)$/i;
const LABEL_SEP = '(?:[:=]|\\t|\\s{2,}|\\s-\\s|\\u2013|\\u2014|\\s+(?:is|was|are|were|of|on|at)\\.?\\s+)';

const KNOWN_CARRIERS = [
  'State Farm',
  'Allstate',
  'Farmers Insurance',
  'USAA',
  'Liberty Mutual',
  'Nationwide',
  'Travelers',
  'Erie Insurance',
  'Auto-Owners',
  'Cincinnati Insurance',
  'Hastings Mutual',
  'Indiana Farm Bureau',
  'Westfield Insurance',
  'American Family',
  'Shelter Insurance',
  'Central Mutual',
  'Country Financial',
  'West Bend',
  'Progressive',
  'The Hartford',
  'Utica National',
  'Pekin Insurance',
  'MMG Insurance',
  'Lemonade',
  'Farmers',
  'Foremost',
  'MetLife',
  'Safeco',
  'Acuity',
  'Donegal',
  'Motorists',
  'Secura',
  'Chubb',
  'Erie',
  'Hippo',
  'Openly',
];

const PERIL_CANONICAL = [
  'Water - Supply Line Burst',
  'Water - Sewage Backup',
  'Fire & Smoke Damage',
  'Storm / Wind / Hail',
  'Vehicle Impact / Structural',
  'Mold Remediation',
];

const PERIL_RULES: Array<{ peril: string; re: RegExp }> = [
  { peril: 'Water - Sewage Backup', re: /sewag|sewer|black water|sump pump|drain backup/i },
  { peril: 'Mold Remediation', re: /mold|mildew|microbial/i },
  { peril: 'Fire & Smoke Damage', re: /fire|smoke|soot|grease/i },
  { peril: 'Vehicle Impact / Structural', re: /vehicle|car (?:hit|crashed|impact)|auto impact|truck hit|structural collapse/i },
  { peril: 'Storm / Wind / Hail', re: /storm|wind|hail|tornado|hurricane|lightning|fallen tree/i },
  { peril: 'Water - Supply Line Burst', re: /supply line|burst|busted|pipe|plumb|water heater|frozen|freeze|ice dam|appliance|dishwasher|washing machine|washer|refrigerat|ice maker|toilet|bathtub|overflow|roof leak|leak|water damage|flood/i },
];

function canonicalizePeril(value: string): string | null {
  const lowered = value.toLowerCase();
  const canonical = PERIL_CANONICAL.find((peril) => lowered.includes(peril.toLowerCase()));
  if (canonical) return canonical;
  for (const rule of PERIL_RULES) {
    if (rule.re.test(value)) return rule.peril;
  }
  return null;
}

function inferPerilFromText(rawText: string): string | null {
  for (const rule of PERIL_RULES) {
    if (rule.re.test(rawText)) return rule.peril;
  }
  return null;
}

function canonicalizeChangeType(value: string): string | null {
  if (/increas|additional|added|up\b|more/i.test(value)) return 'increase';
  if (/decreas|credit|reduction|remov|lower|down\b/i.test(value)) return 'decrease';
  if (/unchanged|no change|same|zero|none/i.test(value)) return 'unchanged';
  return null;
}

function canonicalizeXactimate(value: string): string | null {
  if (/online/i.test(value)) return 'Xactimate Online';
  const version = value.match(/\bX([123])\b/i);
  if (version) return `X${version[1]}`;
  return null;
}

function findKnownCarrier(rawText: string): string | null {
  for (const carrier of KNOWN_CARRIERS) {
    const pattern = new RegExp(`\\b${escapeRegExp(carrier)}\\b`, 'i');
    const match = pattern.exec(rawText);
    if (!match) continue;
    if (carrier.length <= 6) {
      // Short names (Erie, Chubb) need claims context to avoid city/street false positives.
      const window = rawText.slice(Math.max(0, match.index - 60), match.index + 60);
      if (!/insur|claim|carrier|policy|adjust/i.test(window)) continue;
    }
    return carrier;
  }
  return null;
}

/** Finds an amount that sits next to one of the supplied keywords, in either order. */
function currencyFromContext(rawText: string, keywords: string[]): { value: number; detail: string } | null {
  for (const keyword of keywords) {
    const escaped = escapeRegExp(keyword);
    const patterns = [
      new RegExp(`${escaped}[^\\n\\d]{0,28}\\$?\\s*([\\d,]{3,}(?:\\.\\d{1,2})?)`, 'i'),
      new RegExp(`\\$\\s*([\\d,]{3,}(?:\\.\\d{1,2})?)[^\\n]{0,28}${escaped}`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = rawText.match(pattern);
      if (!match) continue;
      const value = parseCurrencyValue(match[1]);
      if (value !== '') {
        return { value, detail: `Amount found next to "${keyword}" in the pasted text` };
      }
    }
  }
  return null;
}

function uniqueMatches(text: string, pattern: RegExp): string[] {
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  const matches = text.match(new RegExp(pattern.source, flags)) || [];
  return Array.from(new Set(matches));
}

function uniquePhoneNumbers(rawText: string): string[] {
  const digitsSeen = new Set<string>();
  const phones: string[] = [];
  for (const match of uniqueMatches(rawText, PHONE_RE)) {
    const normalized = normalizePhone(match);
    const digits = normalized.replace(/\D/g, '');
    if (digits.length < 10 || digitsSeen.has(digits)) continue;
    digitsSeen.add(digits);
    phones.push(normalized);
  }
  return phones;
}

function fallbackCustomerEmail(rawText: string, state: EngineState): { value: string; display: string; detail: string } | null {
  const emails = uniqueMatches(rawText, EMAIL_RE).filter((email) => {
    const normalized = email.toLowerCase();
    return (
      normalized !== (state.job.insurance.adjusterEmail || '').toLowerCase() &&
      normalized !== (state.job.insurance.brokerAgent || '').toLowerCase()
    );
  });
  if (emails.length === 0) return null;
  if (emails.length === 1) {
    return { value: emails[0], display: emails[0], detail: 'Only email address found in the pasted text' };
  }
  // Several addresses on file: pick the one sitting on (or next to) the insured's
  // own line, which is how contact details appear in forwarded assignment emails.
  const lowerText = rawText.toLowerCase();
  const textLines = lowerText.split('\n');
  const name = state.job.customer.customerName.toLowerCase();
  const nameLine = name ? textLines.findIndex((line) => line.includes(name)) : -1;
  const insuredLine = textLines.findIndex((line) => line.includes('insured'));
  const anchorLine = insuredLine >= 0 ? insuredLine : nameLine;
  if (anchorLine < 0) return null;
  let best: { email: string; lineDistance: number; charDistance: number } | null = null;
  for (const email of emails) {
    const lineIndex = textLines.findIndex((line) => line.includes(email.toLowerCase()));
    if (lineIndex < 0) continue;
    const lineDistance = Math.abs(lineIndex - anchorLine);
    if (lineDistance > 3) continue;
    const charDistance = Math.abs(lowerText.indexOf(email.toLowerCase()) - anchorLine * 40);
    if (!best || lineDistance < best.lineDistance || (lineDistance === best.lineDistance && charDistance < best.charDistance)) {
      best = { email, lineDistance, charDistance };
    }
  }
  if (!best) return null;
  return { value: best.email, display: best.email, detail: "Email address closest to the insured's contact details" };
}

function deductibleCollectedFallback(rawText: string): { value: 'Yes' | 'No' | 'Pending'; display: string; detail: string } | null {
  const match = rawText.match(/deductible[^\n]{0,60}?\b(collected|received|paid|pending|outstanding|not (?:yet )?collected)\b/i);
  if (!match) return null;
  const word = match[1].toLowerCase();
  const value = /pending/.test(word) ? 'Pending' : /not|outstanding/.test(word) ? 'No' : 'Yes';
  return { value, display: value, detail: `Deductible status read from "${word}" in the pasted text` };
}

function xactimateFallback(rawText: string): { value: string; display: string; detail: string } | null {
  if (!/xactimate|xact\s*imate/i.test(rawText)) return null;
  const version = rawText.match(/\bX[123]\b/i);
  if (version) {
    const value = version[0].toUpperCase();
    return { value, display: value, detail: 'Xactimate version found in the pasted text' };
  }
  if (/xactimate\s+online/i.test(rawText)) {
    return { value: 'Xactimate Online', display: 'Xactimate Online', detail: 'Online Xactimate workspace found' };
  }
  return null;
}

function splitAddress(raw: string): { street: string; cityStateZip: string } | null {
  const value = raw.replace(/\s+/g, ' ').trim();
  if (!value) return null;
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length >= 2) {
    const tail = parts.slice(1).join(', ');
    if (/\b\d{5}(?:-\d{4})?\b/.test(tail) || /^[A-Za-z .'-]+$/.test(parts[1])) {
      return { street: parts[0], cityStateZip: tail };
    }
  }
  const oneLine = value.match(/^(.*\S)\s+([A-Za-z][A-Za-z .'-]{2,}),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (oneLine) {
    return { street: oneLine[1], cityStateZip: `${oneLine[2]}, ${oneLine[3]} ${oneLine[4]}` };
  }
  return null;
}

const FIELD_DEFS: FieldDef[] = [
  /* ---- Insurance & claim ------------------------------------------- */
  {
    key: 'carrier',
    label: 'Insurance Carrier',
    section: 'insurance',
    kind: 'text',
    path: 'insurance.carrier',
    aliases: ['Insurance Carrier', 'Insurance Company', 'Carrier Name', 'Insurance Co', 'Carrier', 'Insurer', 'Insurance'],
    fallback: (rawText) => {
      const carrier = findKnownCarrier(rawText);
      return carrier
        ? { value: carrier, display: carrier, detail: `Matched known carrier "${carrier}" in the pasted text` }
        : null;
    },
  },
  {
    key: 'claimNumber',
    label: 'Claim Number',
    section: 'insurance',
    kind: 'text',
    path: 'insurance.claimNumber',
    aliases: ['Customer Claim Number', 'Claim Number', 'Claim #', 'Claim No', 'Claim Ref', 'Claim'],
    fallback: (rawText) => {
      const match = rawText.match(/\b(CLM-[A-Za-z0-9-]{3,})\b/i);
      return match
        ? { value: match[1], display: match[1], detail: `Found standalone claim number "${match[1]}"` }
        : null;
    },
  },
  {
    key: 'policyNumber',
    label: 'Policy Number',
    section: 'insurance',
    kind: 'text',
    path: 'insurance.policyNumber',
    aliases: ['Policy Number', 'Policy #', 'Policy No', 'Policy Ref', 'Policy'],
  },
  {
    key: 'primaryAdjuster',
    label: 'Primary Adjuster',
    section: 'insurance',
    kind: 'text',
    path: 'insurance.primaryAdjuster',
    aliases: ['Primary Adjuster', 'Adjuster Name', 'Assigned Adjuster', 'Claim Adjuster', 'Field Adjuster', 'Desk Adjuster', 'Adjuster'],
  },
  {
    key: 'independentAdjuster',
    label: 'Independent Adjuster',
    section: 'insurance',
    kind: 'text',
    path: 'insurance.independentAdjuster',
    aliases: ['Independent Adjuster', 'Independent Insurance Adjuster', 'IA Firm', 'Third Party Adjuster', 'TPA Adjuster'],
  },
  {
    key: 'adjusterPhone',
    label: 'Adjuster Phone',
    section: 'insurance',
    kind: 'phone',
    path: 'insurance.adjusterPhone',
    aliases: ['Adjuster Phone Number', 'Adjuster Phone', 'Adjuster Cell', 'Adjuster Direct', 'Adjuster Tel', 'Adjuster Number'],
  },
  {
    key: 'adjusterEmail',
    label: 'Adjuster Email',
    section: 'insurance',
    kind: 'email',
    path: 'insurance.adjusterEmail',
    aliases: ['Adjuster Email Address', 'Adjuster E-mail', 'Adjuster Email'],
  },
  {
    key: 'brokerAgent',
    label: 'Broker / Agent',
    section: 'insurance',
    kind: 'text',
    path: 'insurance.brokerAgent',
    aliases: ['Broker/Agent', 'Broker Agent', 'Insurance Agent', 'Agent Name', 'Broker Name', 'Agent', 'Broker'],
  },
  {
    key: 'agentPhone',
    label: 'Agent Phone',
    section: 'insurance',
    kind: 'phone',
    path: 'insurance.agentPhone',
    aliases: ['Agent Phone Number', 'Agent Phone', 'Agent Cell', 'Broker Phone', 'Agent Number'],
  },
  {
    key: 'reportedBy',
    label: 'Reported By',
    section: 'insurance',
    kind: 'text',
    path: 'insurance.reportedBy',
    aliases: ['Reported By', 'Report Source', 'Reported'],
  },
  {
    key: 'referredBy',
    label: 'Referred By',
    section: 'insurance',
    kind: 'text',
    path: 'insurance.referredBy',
    aliases: ['Referred By', 'Referral Source', 'Referral', 'Lead Source', 'Referred'],
  },
  {
    key: 'dateOfLoss',
    label: 'Date of Loss',
    section: 'insurance',
    kind: 'date',
    path: 'insurance.dateOfLoss',
    aliases: ['Date of Loss', 'Loss Date', 'Date of Occurrence', 'Occurrence Date', 'Date Loss Occurred', 'DOL'],
  },
  {
    key: 'timeOfLoss',
    label: 'Time of Loss',
    section: 'insurance',
    kind: 'time',
    path: 'insurance.timeOfLoss',
    aliases: ['Time of Loss', 'Loss Time', 'Time of Occurrence', 'Occurrence Time'],
  },
  {
    key: 'dateReceived',
    label: 'Date Received',
    section: 'insurance',
    kind: 'date',
    path: 'insurance.dateReceived',
    aliases: ['Date Received', 'Received Date', 'Date Assigned', 'Assignment Date', 'Date Reported'],
  },
  {
    key: 'timeReceived',
    label: 'Time Received',
    section: 'insurance',
    kind: 'time',
    path: 'insurance.timeReceived',
    aliases: ['Time Received', 'Received Time', 'Time Assigned'],
  },
  {
    key: 'dateInsuredContacted',
    label: 'Date Insured Contacted',
    section: 'insurance',
    kind: 'date',
    path: 'insurance.dateInsuredContacted',
    aliases: ['Date Insured Contacted', 'Insured Contacted On', 'Date Contacted', 'Contact Date'],
  },
  {
    key: 'timeInsuredContacted',
    label: 'Time Insured Contacted',
    section: 'insurance',
    kind: 'time',
    path: 'insurance.timeInsuredContacted',
    aliases: ['Time Insured Contacted', 'Time Contacted'],
  },
  {
    key: 'dateInspected',
    label: 'Date Inspected',
    section: 'insurance',
    kind: 'date',
    path: 'insurance.dateInspected',
    aliases: ['Date Inspected', 'Inspection Date', 'Date of Inspection', 'Inspected On'],
  },
  {
    key: 'typeOfLoss',
    label: 'Type of Loss',
    section: 'insurance',
    kind: 'text',
    path: 'insurance.typeOfLoss',
    aliases: ['Type of Loss', 'Loss Type', 'Type of Claim', 'Cause of Loss', 'Loss Cause', 'Peril Type', 'Peril', 'Cause'],
    canonicalize: canonicalizePeril,
    fallback: (rawText) => {
      const peril = inferPerilFromText(rawText);
      return peril ? { value: peril, display: peril, detail: 'Loss type inferred from keywords in the pasted text' } : null;
    },
  },
  {
    key: 'typeOfLossSecondary',
    label: 'Secondary Loss',
    section: 'insurance',
    kind: 'text',
    path: 'insurance.typeOfLossSecondary',
    aliases: ['Secondary Loss', 'Secondary Peril', 'Secondary Cause', 'Loss Type 2'],
    canonicalize: canonicalizePeril,
  },
  {
    key: 'roughEstimateAmount',
    label: 'Rough Estimate',
    section: 'insurance',
    kind: 'currency',
    path: 'insurance.roughEstimateAmount',
    aliases: ['Rough Estimate Amount', 'Rough Estimate', 'Initial Estimate', 'Preliminary Estimate', 'Estimated Damage', 'Damage Estimate', 'Estimate Amount'],
  },
  {
    key: 'lossDescription',
    label: 'Loss Description',
    section: 'insurance',
    kind: 'multiline',
    path: 'insurance.lossDescription',
    maxLines: 4,
    aliases: ['Loss Description', 'Damage Description', 'Cause of Loss Narrative', 'Description of Damage', 'Scope of Damage', 'Damage Narrative', 'Loss Narrative', 'Summary of Loss', 'Description', 'Details', 'Narrative'],
  },
  {
    key: 'specialInstructions',
    label: 'Special Instructions',
    section: 'insurance',
    kind: 'multiline',
    path: 'insurance.specialInstructions',
    maxLines: 3,
    aliases: ['Special Instructions', 'Carrier Instructions', 'Special Handling', 'Special Notes', 'Important Notes'],
  },
  {
    key: 'detailedFindings',
    label: 'Detailed Findings',
    section: 'insurance',
    kind: 'multiline',
    path: 'insurance.detailedFindings',
    maxLines: 4,
    aliases: ['Detailed Findings', 'Inspection Findings', 'Field Findings', 'Field Notes', 'Technician Notes', 'Tech Notes', 'Observations', 'Inspection Notes', 'Findings'],
  },

  /* ---- Customer & loss ---------------------------------------------- */
  {
    key: 'jobNumber',
    label: 'Job Number',
    section: 'customer',
    kind: 'text',
    path: 'customer.jobNumber',
    aliases: ['Job Number', 'Job #', 'Job No', 'Job ID', 'JobNumber', 'DASH Job'],
    fallback: (rawText) => {
      const match = rawText.match(/\b(FW-\d{4}-\d{2,6})\b/) || rawText.match(/\b(JOB-\d{4,8})\b/i);
      return match ? { value: match[1], display: match[1], detail: `Found standalone job number "${match[1]}"` } : null;
    },
  },
  {
    key: 'jobName',
    label: 'Job Name',
    section: 'customer',
    kind: 'text',
    path: 'customer.jobName',
    aliases: ['Job Name', 'Project Name', 'Project'],
  },
  {
    key: 'customerName',
    label: 'Customer Name',
    section: 'customer',
    kind: 'text',
    path: 'customer.customerName',
    aliases: ['Customer Name', 'Insured Name', 'Homeowner Name', 'Policyholder Name', 'Policy Holder', 'Property Owner', 'Client Name', 'Customer', 'Insured', 'Homeowner', 'Policyholder', 'Owner', 'Name'],
  },
  {
    key: 'lossContact',
    label: 'Loss Contact',
    section: 'customer',
    kind: 'text',
    path: 'customer.lossContact',
    aliases: ['Loss Contact', 'On-Site Contact', 'Site Contact', 'Property Contact', 'Contact Name', 'Contact Person', 'Primary Contact'],
  },
  {
    key: 'lossAddress',
    label: 'Loss Address',
    section: 'customer',
    kind: 'text',
    path: 'customer.lossAddress',
    aliases: ['Loss Address', 'Loss Property Address', 'Loss Location', 'Location of Loss', 'Property Address', 'Risk Address', 'Job Address', 'Job Site Address', 'Service Address', 'Site Address', 'Address of Loss', 'Customer Address', 'Address'],
    apply: (job, value) => {
      job.customer.lossAddress = value;
      if (!job.customer.mailingAddress) {
        const split = splitAddress(value);
        job.customer.mailingAddress = split ? split.street : value;
        if (split) job.customer.mailingCityStateZip = split.cityStateZip;
      }
    },
  },
  {
    key: 'mailingAddress',
    label: 'Mailing Address',
    section: 'customer',
    kind: 'text',
    path: 'customer.mailingAddress',
    aliases: ['Mailing Address', 'Mail Address', 'Billing Address', 'Mailing'],
    apply: (job, value) => {
      const split = splitAddress(value);
      job.customer.mailingAddress = split ? split.street : value;
      if (split) job.customer.mailingCityStateZip = split.cityStateZip;
    },
  },
  {
    key: 'mainPhone',
    label: 'Main Phone',
    section: 'customer',
    kind: 'phone',
    path: 'customer.mainPhone',
    aliases: ['Main Phone Number', 'Main Phone', 'Main Number', 'Primary Phone', 'Best Phone', 'Contact Phone', 'Office Phone', 'Phone Number', 'Phone', 'Telephone', 'Tel'],
    fallback: (rawText, state) => {
      const { job } = state;
      if (job.customer.mainPhone || job.customer.homePhone || job.customer.mobilePhone) return null;
      const phones = uniquePhoneNumbers(rawText);
      if (phones.length === 0 || phones.length > 2) return null;
      return {
        value: phones[0],
        display: phones[0],
        detail: phones.length === 1 ? 'Only phone number in the pasted text' : 'First of two phone numbers - verify before sending documents',
      };
    },
  },
  {
    key: 'homePhone',
    label: 'Home Phone',
    section: 'customer',
    kind: 'phone',
    path: 'customer.homePhone',
    aliases: ['Home Phone', 'House Phone', 'Home Number'],
  },
  {
    key: 'mobilePhone',
    label: 'Mobile Phone',
    section: 'customer',
    kind: 'phone',
    path: 'customer.mobilePhone',
    aliases: ['Mobile Number', 'Mobile Phone', 'Cell Phone Number', 'Cell Phone', 'Cell Number', 'Mobile', 'Cell'],
    fallback: (rawText, state) => {
      const { job } = state;
      if (job.customer.mobilePhone || job.customer.homePhone) return null;
      const phones = uniquePhoneNumbers(rawText);
      if (phones.length !== 2) return null;
      const other = phones.find((phone) => phone !== job.customer.mainPhone);
      return other
        ? { value: other, display: other, detail: 'Second phone number in the pasted text - verify before sending documents' }
        : null;
    },
  },
  {
    key: 'email',
    label: 'Email',
    section: 'customer',
    kind: 'email',
    path: 'customer.email',
    aliases: ['Email Address', 'E-mail Address', 'Email', 'E-mail', 'E Mail'],
    fallback: (rawText, state) => fallbackCustomerEmail(rawText, state),
  },

  /* ---- Financials ---------------------------------------------------- */
  {
    key: 'totalApprovedRcv',
    label: 'Total Approved RCV',
    section: 'financials',
    kind: 'currency',
    path: 'financials.totalApprovedRcv',
    aliases: ['Total Approved RCV', 'Approved RCV', 'Total RCV', 'RCV Total', 'RCV Amount', 'Replacement Cost Value', 'Replacement Cost', 'Approved Amount', 'Grand Total', 'Estimate Total', 'Total Estimate', 'Total Approved', 'RCV'],
    fallback: (rawText) => {
      const result = currencyFromContext(rawText, ['Total Approved RCV', 'Approved RCV', 'Total RCV', 'RCV', 'Replacement Cost Value', 'Replacement Cost', 'Estimate Total', 'Grand Total']);
      return result ? { value: result.value, display: formatUsd(result.value), detail: result.detail } : null;
    },
  },
  {
    key: 'deductible',
    label: 'Deductible',
    section: 'financials',
    kind: 'currency',
    path: 'financials.deductible',
    aliases: ['Deductible Amount', 'Insurance Deductible', 'Out of Pocket', 'Out-of-Pocket', 'Deductible', 'DED'],
    fallback: (rawText) => {
      const result = currencyFromContext(rawText, ['Deductible Amount', 'Deductible', 'Out of Pocket', 'Out-of-Pocket']);
      return result ? { value: result.value, display: formatUsd(result.value), detail: result.detail } : null;
    },
  },

  /* ---- Team ---------------------------------------------------------- */
  {
    key: 'estimator',
    label: 'Estimator',
    section: 'team',
    kind: 'text',
    path: 'team.estimator',
    aliases: ['Estimator Name', 'Estimator', 'Sales Representative', 'Sales Rep'],
  },
  {
    key: 'supervisor',
    label: 'Supervisor',
    section: 'team',
    kind: 'text',
    path: 'team.supervisor',
    aliases: ['Production Supervisor', 'Supervisor Name', 'Supervisor'],
  },
  {
    key: 'coordinator',
    label: 'Coordinator',
    section: 'team',
    kind: 'text',
    path: 'team.coordinator',
    aliases: ['Office Coordinator', 'Scheduling Coordinator', 'Coordinator Name', 'Coordinator', 'Scheduler'],
  },
  {
    key: 'projectManager',
    label: 'Project Manager',
    section: 'team',
    kind: 'text',
    path: 'team.projectManager',
    aliases: ['Project Manager Name', 'Project Manager', 'Construction Manager', 'PM Name', 'PM'],
  },
  {
    key: 'foreman',
    label: 'Foreman',
    section: 'team',
    kind: 'text',
    path: 'team.foreman',
    aliases: ['Crew Chief', 'Lead Technician', 'Lead Tech', 'Crew Lead', 'Foreman'],
  },
  {
    key: 'marketingPerson',
    label: 'Marketing Person',
    section: 'team',
    kind: 'text',
    path: 'team.marketingPerson',
    aliases: ['Marketing Representative', 'Marketing Person', 'Marketing Rep', 'Marketing'],
  },
  {
    key: 'accountingPerson',
    label: 'Accounting Person',
    section: 'team',
    kind: 'text',
    path: 'team.accountingPerson',
    aliases: ['Accounting Representative', 'Accounting Person', 'Accounting Rep', 'Billing Contact', 'Accounting Contact', 'Accounting'],
  },

  /* ---- Mortgage ------------------------------------------------------ */
  {
    key: 'hasMortgage',
    label: 'Has Mortgage',
    section: 'mortgage',
    kind: 'boolean',
    path: 'mortgage.hasMortgage',
    aliases: ['Has Mortgage', 'Mortgage Loan', 'Is There a Mortgage'],
  },
  {
    key: 'mortgageCompany',
    label: 'Mortgage Company',
    section: 'mortgage',
    kind: 'text',
    path: 'mortgage.mortgageCompany',
    allowPlaceholders: true,
    aliases: ['Mortgage Company Name', 'Mortgage Company', 'Mortgage Co', 'Lienholder', 'Lien Holder', 'Mortgage Holder', 'Lender', 'Mortgage', 'Bank'],
    apply: (job, value) => {
      const none = /^(none|no|n\/?a|na|paid|free|not applicable)\b/i.test(String(value).trim());
      job.mortgage.hasMortgage = !none;
      if (!none) job.mortgage.mortgageCompany = value;
    },
  },
  {
    key: 'mortgagePhone',
    label: 'Mortgage Phone',
    section: 'mortgage',
    kind: 'phone',
    path: 'mortgage.mortgagePhone',
    aliases: ['Mortgage Company Phone', 'Mortgage Phone', 'Lender Phone', 'Bank Phone'],
  },
  {
    key: 'loanNumber',
    label: 'Loan Number',
    section: 'mortgage',
    kind: 'text',
    path: 'mortgage.loanNumber',
    aliases: ['Mortgage Loan Number', 'Loan Account Number', 'Loan Number', 'Loan #', 'Loan No', 'Loan'],
    apply: (job, value) => {
      job.mortgage.loanNumber = value;
      job.mortgage.hasMortgage = true;
    },
  },
  {
    key: 'last4Ssn',
    label: 'Last 4 SSN',
    section: 'mortgage',
    kind: 'ssn4',
    path: 'mortgage.last4Ssn',
    aliases: ['Last 4 of SSN', 'Last Four of SSN', 'SSN Last 4', 'Last 4 SSN', 'Social Security Number', 'Social Security', 'SSN'],
  },

  /* ---- Change order -------------------------------------------------- */
  {
    key: 'changeOrderNumber',
    label: 'Change Order Number',
    section: 'changeOrder',
    kind: 'text',
    path: 'changeOrder.changeOrderNumber',
    aliases: ['Change Order Number', 'Change Order #', 'Change Order No', 'CO Number', 'CO #', 'Change Order'],
  },
  {
    key: 'changeOrderDate',
    label: 'Change Order Date',
    section: 'changeOrder',
    kind: 'date',
    path: 'changeOrder.changeOrderDate',
    aliases: ['Change Order Date', 'CO Date'],
  },
  {
    key: 'originalContractSum',
    label: 'Original Contract Sum',
    section: 'changeOrder',
    kind: 'currency',
    path: 'changeOrder.originalContractSum',
    aliases: ['Original Contract Sum', 'Original Contract Amount', 'Original Contract', 'Contract Sum', 'Contract Amount', 'Contract Price'],
  },
  {
    key: 'scopeDescription',
    label: 'Change Order Scope',
    section: 'changeOrder',
    kind: 'multiline',
    path: 'changeOrder.scopeDescription',
    maxLines: 3,
    aliases: ['Scope Description', 'Scope of Work', 'Change Order Scope', 'Change Scope', 'Additional Scope', 'Added Scope', 'Work Description'],
  },
  {
    key: 'changeAmount',
    label: 'Change Amount',
    section: 'changeOrder',
    kind: 'currency',
    path: 'changeOrder.changeAmount',
    aliases: ['Change Order Amount', 'Change Amount', 'CO Amount', 'Additional Amount', 'Additional Cost', 'Change Total', 'Change Order Total'],
  },
  {
    key: 'changeType',
    label: 'Change Type',
    section: 'changeOrder',
    kind: 'text',
    path: 'changeOrder.changeType',
    aliases: ['Change Type', 'Direction of Change'],
    canonicalize: canonicalizeChangeType,
    apply: (job, value) => {
      job.changeOrder.changeType = value as RestorationJobData['changeOrder']['changeType'];
    },
  },
  {
    key: 'addedDays',
    label: 'Added Days',
    section: 'changeOrder',
    kind: 'int',
    path: 'changeOrder.addedDays',
    aliases: ['Added Days', 'Additional Days', 'Days Added', 'Time Extension', 'Extra Days'],
  },
  {
    key: 'isInsuranceRelated',
    label: 'Insurance Related',
    section: 'changeOrder',
    kind: 'boolean',
    path: 'changeOrder.isInsuranceRelated',
    aliases: ['Insurance Related', 'Carrier Related', 'Insurance Claim Related'],
  },
  {
    key: 'netPreviousChanges',
    label: 'Net Previous Changes',
    section: 'changeOrder',
    kind: 'currency',
    path: 'changeOrder.netPreviousChanges',
    aliases: ['Net Previous Changes', 'Previous Changes', 'Prior Change Orders'],
  },

  /* ---- Production checklist ------------------------------------------ */
  {
    key: 'hasDeductibleBeenCollected',
    label: 'Deductible Collected',
    section: 'checklist',
    kind: 'yesNoPending',
    path: 'checklist.hasDeductibleBeenCollected',
    aliases: ['Has Deductible Been Collected', 'Deductible Collected', 'Deductible Paid', 'Deductible Received', 'Deductible Status'],
    fallback: (rawText) => deductibleCollectedFallback(rawText),
  },
  {
    key: 'deductibleExplanation',
    label: 'Deductible Explanation',
    section: 'checklist',
    kind: 'multiline',
    path: 'checklist.deductibleExplanation',
    maxLines: 3,
    aliases: ['Deductible Explanation', 'Deductible Notes', 'Deductible Details'],
  },
  {
    key: 'xactimateVersion',
    label: 'Xactimate Version',
    section: 'checklist',
    kind: 'text',
    path: 'checklist.xactimateVersion',
    aliases: ['Xactimate Version', 'Xactimate', 'Xact Version', 'Estimating Platform'],
    canonicalize: canonicalizeXactimate,
    fallback: (rawText) => xactimateFallback(rawText),
  },
  {
    key: 'isSelfPay',
    label: 'Self Pay',
    section: 'checklist',
    kind: 'boolean',
    path: 'checklist.isSelfPay',
    aliases: ['Self Pay', 'Self-Pay', 'Self Pay Job', 'Cash Job', 'Non-Insurance Job'],
  },
  {
    key: 'isProgramClaim',
    label: 'Program Claim',
    section: 'checklist',
    kind: 'boolean',
    path: 'checklist.isProgramClaim',
    aliases: ['Program Claim', 'Carrier Program', 'TPA Claim', 'Program Job', 'Insurance Program'],
  },
  {
    key: 'hasCheckBeenSent',
    label: 'Check Sent',
    section: 'checklist',
    kind: 'boolean',
    path: 'checklist.hasCheckBeenSent',
    aliases: ['Has Check Been Sent', 'Check Sent', 'Check Mailed', 'Payment Sent'],
  },
  {
    key: 'checkToWhom',
    label: 'Check To Whom',
    section: 'checklist',
    kind: 'text',
    path: 'checklist.checkToWhom',
    aliases: ['Check To Whom', 'Check Written To', 'Check Should Be Made Out To', 'Check To', 'Make Check Out To'],
  },
  {
    key: 'checkPayableTo',
    label: 'Check Payable To',
    section: 'checklist',
    kind: 'text',
    path: 'checklist.checkPayableTo',
    aliases: ['Check Payable To', 'Payable To', 'Payee', 'Check Payable'],
  },
  {
    key: 'isDepreciationWithheld',
    label: 'Depreciation Withheld',
    section: 'checklist',
    kind: 'boolean',
    path: 'checklist.isDepreciationWithheld',
    aliases: ['Depreciation Withheld', 'Depreciation Held', 'Recoverable Depreciation Held', 'Depreciation On Hold'],
  },
  {
    key: 'depreciationAmount',
    label: 'Depreciation Amount',
    section: 'checklist',
    kind: 'currency',
    path: 'checklist.depreciationAmount',
    aliases: ['Depreciation Amount', 'Recoverable Depreciation', 'Held Depreciation', 'Depreciation Held Amount'],
  },
  {
    key: 'startDate',
    label: 'Start Date',
    section: 'checklist',
    kind: 'date',
    path: 'checklist.startDate',
    aliases: ['Projected Start Date', 'Construction Start Date', 'Scheduled Start Date', 'Work Start Date', 'Start Date', 'Construction Start', 'Projected Start', 'Scheduled Start', 'Date Started'],
  },
  {
    key: 'finishDate',
    label: 'Completion Date',
    section: 'checklist',
    kind: 'date',
    path: 'checklist.finishDate',
    aliases: ['Estimated Completion Date', 'Projected Completion Date', 'Scheduled Completion Date', 'Target Completion Date', 'Completion Date', 'Finish Date', 'Date Completed', 'Estimated Completion', 'Projected Completion', 'Target Completion', 'Scheduled Completion'],
  },
  {
    key: 'projectManagerNotes',
    label: 'PM Notes',
    section: 'checklist',
    kind: 'multiline',
    path: 'checklist.projectManagerNotes',
    maxLines: 4,
    aliases: ['Project Manager Notes', 'Manager Notes', 'Production Notes', 'Internal Notes', 'Job Notes', 'Site Notes', 'PM Notes', 'Notes'],
  },
];

const ALL_ALIASES = Array.from(new Set(FIELD_DEFS.flatMap((def) => def.aliases)));
const BOUNDARY_RE = new RegExp(`\\s+(?:${aliasAlternation(ALL_ALIASES)})\\s*[:=]`, 'i');

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function aliasAlternation(aliases: string[]): string {
  return aliases
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
}

function buildMatchers(def: FieldDef): DefMatchers {
  const all = aliasAlternation(def.aliases);
  const bullet = '(?:[-*\\u2022\\u25CF]\\s*)?';
  const multi = def.aliases.filter((alias) => alias.includes(' '));
  return {
    exact: new RegExp(`^\\s*${bullet}(?:${all})\\s*[:=]?\\s*$`, 'i'),
    anchored: new RegExp(`^\\s*${bullet}(?:${all})\\s*${LABEL_SEP}\\s*(.*)$`, 'i'),
    flex: multi.length > 0 ? new RegExp(`(?:^|[\\s(])(?:${aliasAlternation(multi)})\\s*${LABEL_SEP}\\s*(.*)$`, 'i') : null,
  };
}

function trimRest(value: string): string {
  return value.replace(/^\s*:\s*/, '').trim();
}

function matchLabelLine(line: string, matchers: DefMatchers): { rest: string } | null {
  if (matchers.exact.test(line)) return { rest: '' };
  const anchored = line.match(matchers.anchored);
  if (anchored) return { rest: trimRest(anchored[1]) };
  if (matchers.flex) {
    const flex = line.match(matchers.flex);
    if (flex) return { rest: trimRest(flex[1]) };
  }
  return null;
}

function isLabelLikeLine(line: string): boolean {
  return /^\s*(?:[-*\u2022\u25CF]\s*)?[A-Za-z][A-Za-z0-9 \/&#'().-]{1,45}\s*(?::|=|\u2013|\u2014|\t|\s{2,})\s*\S/.test(line);
}

function cleanLineValue(line: string): string {
  let value = line.replace(/\u00a0/g, ' ').trim();
  value = value.replace(/^[-*\u2022\u25CF\u25E6\u25AA\u2023\u00b7>|:\s]+/, '');
  value = value.replace(/[,;(]\s*(?:phone|cell|mobile|e-?mail|tel(?:ephone)?|fax)\b.*$/i, '');
  const cut = value.search(BOUNDARY_RE);
  if (cut > 0) value = value.slice(0, cut);
  value = value.replace(/[\s;|,]+$/, '');
  return value.replace(/\s+/g, ' ').trim();
}

function cleanTextValue(raw: string, multiline: boolean, maxLength: number): string {
  const cleaned = raw
    .split('\n')
    .map((line) => cleanLineValue(line))
    .filter((line) => line.length > 0);
  let value = multiline ? cleaned.join('\n') : cleaned.join(' ');
  value = value.replace(/[ \t]+/g, ' ').trim();
  if (value.length > maxLength) value = value.slice(0, maxLength).trim();
  if (!/[A-Za-z0-9]/.test(value)) return '';
  if (/^[A-Za-z][A-Za-z0-9 \/:#&'().-]{1,44}:$/.test(value)) return '';
  return value;
}

function extractCurrency(text: string): number | '' {
  const trimmed = text.trim();
  if (/^\(?[+-]?\s*\$?\s*-?\d[\d,]*(?:\.\d{1,2})?\)?(?:\s+[a-z.()]{0,20})?$/i.test(trimmed)) {
    return parseCurrencyValue(trimmed);
  }
  const dollar = trimmed.match(/\(?-?\s*\$\s*-?[\d,]+(?:\.\d{1,2})?\)?/);
  if (dollar) return parseCurrencyValue(dollar[0]);
  return '';
}

function parseYesNo(text: string): boolean | null {
  const value = text.trim().replace(/^[-*\u2022\u25CF:.\s]+/, '');
  if (/^(yes|y|true|1|x|✓|✔)\b/i.test(value)) return true;
  if (/^(no|n|false|0)\b/i.test(value)) return false;
  if (value.startsWith('\u2611')) return true;
  if (value.startsWith('\u2610')) return false;
  return null;
}

function parseYesNoPending(text: string): 'Yes' | 'No' | 'Pending' | null {
  const value = text.toLowerCase();
  if (/pending|partial|payment plan|arranged|not yet|will pay|scheduled/.test(value)) return 'Pending';
  if (/^(no|n|false|0)\b/.test(value.trim()) || /not collected|hasn'?t|uncollected|outstanding|due/.test(value)) return 'No';
  if (/^(yes|y|true|1)\b/.test(value.trim()) || /collect|paid|receiv|done|complete/.test(value)) return 'Yes';
  return null;
}

function sanitizeValue(def: FieldDef, raw: string): SanitizedValue | null {
  const text = raw.replace(/\u00a0/g, ' ');
  switch (def.kind) {
    case 'text': {
      const value = cleanTextValue(text, false, 200);
      if (!value || (!def.allowPlaceholders && PLACEHOLDER_RE.test(value))) return null;
      return { value, display: value };
    }
    case 'multiline': {
      const value = cleanTextValue(text, true, 600);
      if (!value || (!def.allowPlaceholders && PLACEHOLDER_RE.test(value))) return null;
      return { value, display: value.replace(/\n/g, ' \u00b7 ') };
    }
    case 'phone': {
      const match = text.match(PHONE_RE);
      if (!match) return null;
      const value = normalizePhone(match[0]);
      if (value.replace(/\D/g, '').length < 7) return null;
      return { value, display: value };
    }
    case 'email': {
      const match = text.match(EMAIL_RE);
      if (!match) return null;
      return { value: match[0], display: match[0] };
    }
    case 'date': {
      const token = text.match(DATE_TOKEN_RE);
      const iso = normalizeDate(token ? token[0] : text);
      return iso ? { value: iso, display: iso } : null;
    }
    case 'time': {
      const token = text.match(TIME_TOKEN_RE);
      const normalized = token ? normalizeTime(token[0]) : normalizeTime(text);
      return normalized ? { value: normalized, display: normalized } : null;
    }
    case 'currency': {
      const value = extractCurrency(text);
      return value === '' ? null : { value, display: formatUsd(value) };
    }
    case 'int': {
      const match = text.match(/\d+/);
      if (!match) return null;
      const value = parseInt(match[0], 10);
      return isNaN(value) ? null : { value, display: String(value) };
    }
    case 'boolean': {
      const value = parseYesNo(text);
      return value === null ? null : { value, display: value ? 'Yes' : 'No' };
    }
    case 'yesNoPending': {
      const value = parseYesNoPending(text);
      return value ? { value, display: value } : null;
    }
    case 'ssn4': {
      const digits = text.replace(/\D/g, '');
      if (digits.length < 4) return null;
      const value = digits.slice(-4);
      return { value, display: '\u2022\u2022\u2022\u2022 ' + value };
    }
  }
}

function collectCandidates(def: FieldDef, lines: string[], state: EngineState): LabelCandidate[] {
  const candidates: LabelCandidate[] = [];
  const matchers = buildMatchers(def);
  const maxContinuation = def.maxLines ?? 1;

  for (let i = 0; i < lines.length; i++) {
    const label = matchLabelLine(lines[i], matchers);
    if (!label) continue;

    const used = [i];
    let text = label.rest;

    if (!text.trim()) {
      // The label line carries no value: take the next content line.
      for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
        if (state.consumedLines.has(j)) continue;
        if (!lines[j].trim()) continue;
        if (isLabelLikeLine(lines[j])) break;
        text = lines[j].trim();
        used.push(j);
        break;
      }
    } else if (maxContinuation > 1) {
      let taken = 1;
      for (let j = i + 1; j < lines.length && taken < maxContinuation; j++) {
        if (state.consumedLines.has(j)) break;
        if (!lines[j].trim()) break;
        if (isLabelLikeLine(lines[j])) break;
        text += '\n' + lines[j].trim();
        used.push(j);
        taken += 1;
      }
    }

    candidates.push({ text, lines: used });

    if (label.rest.trim() && used.length === 1) {
      // Keep a same-label retry in case the inline text turns out to be prose
      // ("Date of Loss: see carrier report" followed by "01/15/2025").
      for (let j = i + 1; j < lines.length && j <= i + 2; j++) {
        if (state.consumedLines.has(j)) continue;
        if (!lines[j].trim()) continue;
        if (isLabelLikeLine(lines[j])) break;
        candidates.push({ text: lines[j].trim(), lines: [j] });
        break;
      }
    }
  }

  return candidates;
}

function createEngineState(existingJob?: RestorationJobData): EngineState {
  const job = existingJob ? (JSON.parse(JSON.stringify(existingJob)) as RestorationJobData) : createEmptyJob();
  return {
    job,
    provenance: {},
    consumedLines: new Set<number>(),
    entries: new Map<string, ExtractedFieldSummary>(),
    extractedCount: 0,
    warnings: [],
  };
}

function getPathValue(source: any, path: string): any {
  return path.split('.').reduce((acc: any, part) => (acc == null ? acc : acc[part]), source);
}

function setPathValue(target: any, path: string, value: any): void {
  const parts = path.split('.');
  const last = parts.pop() as string;
  const parent = parts.reduce((acc: any, part) => (acc == null ? acc : acc[part]), target);
  if (parent && last) parent[last] = value;
}

function summarize(
  state: EngineState,
  def: Pick<FieldDef, 'key' | 'label' | 'section'>,
  display: string,
  source: FieldProvenanceType,
  changed: boolean
): void {
  const existing = state.entries.get(def.key);
  state.entries.set(def.key, {
    key: def.key,
    label: def.label,
    section: def.section,
    value: display,
    source,
    changed: changed || (existing ? existing.changed : false),
  });
}

function applyExtractedValue(state: EngineState, def: FieldDef, sanitized: SanitizedValue, detail: string): void {
  const before = getPathValue(state.job, def.path);
  if (def.apply) def.apply(state.job, sanitized.value);
  else setPathValue(state.job, def.path, sanitized.value);
  const after = getPathValue(state.job, def.path);
  state.provenance[def.key] = { source: 'EXTRACTED', detail };
  summarize(state, def, sanitized.display, 'EXTRACTED', JSON.stringify(before) !== JSON.stringify(after));
  state.extractedCount += 1;
}

function recordDerived(
  state: EngineState,
  def: Pick<FieldDef, 'key' | 'label' | 'section'>,
  display: string,
  source: FieldProvenanceType,
  detail: string
): void {
  state.provenance[def.key] = { source, detail };
  summarize(state, def, display, source, true);
}

function buildSections(entries: Map<string, ExtractedFieldSummary>): ExtractedSectionSummary[] {
  const order: SectionKey[] = ['customer', 'insurance', 'financials', 'team', 'mortgage', 'changeOrder', 'productionNotes', 'checklist'];
  const bySection = new Map<SectionKey, ExtractedFieldSummary[]>();
  for (const entry of entries.values()) {
    const list = bySection.get(entry.section) ?? [];
    list.push(entry);
    bySection.set(entry.section, list);
  }
  return order
    .filter((section) => bySection.has(section))
    .map((section) => ({ section, label: SECTION_LABELS[section], fields: bySection.get(section) as ExtractedFieldSummary[] }));
}

function collectBlockingFields(job: RestorationJobData): string[] {
  const blocking: string[] = [];
  if (!job.customer.customerName) blocking.push('Customer Name (Property Owner)');
  if (!job.customer.lossAddress) blocking.push('Loss Property Address');
  if (!job.insurance.carrier) blocking.push('Insurance Carrier');
  if (!job.insurance.claimNumber) blocking.push('Claim Number');
  if (job.financials.totalApprovedRcv === '') blocking.push('Total Approved RCV ($)');
  if (job.financials.deductible === '') blocking.push('Deductible ($)');
  return blocking;
}

function finishMissingDefaults(state: EngineState, hadExistingJob: boolean): void {
  const { job } = state;

  if (!job.customer.jobNumber) {
    job.customer.jobNumber = `FW-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    recordDerived(state, { key: 'jobNumber', label: 'Job Number', section: 'customer' }, job.customer.jobNumber, 'CALCULATED', 'Generated a new branch job number');
  }

  if (!job.customer.jobName && job.customer.customerName) {
    job.customer.jobName = `${job.customer.customerName} Restoration`;
    recordDerived(state, { key: 'jobName', label: 'Job Name', section: 'customer' }, job.customer.jobName, 'DRAFTED', 'Derived from the customer name');
  }

  if (!job.customer.mainPhone && job.customer.mobilePhone) {
    job.customer.mainPhone = job.customer.mobilePhone;
    recordDerived(state, { key: 'mainPhone', label: 'Main Phone', section: 'customer' }, job.customer.mainPhone, 'FOUND', 'Only phone number provided - used as main contact');
  }

  if (typeof job.financials.totalApprovedRcv === 'number') {
    const rcv = job.financials.totalApprovedRcv;
    const deductible = typeof job.financials.deductible === 'number' ? job.financials.deductible : 0;
    job.financials.netClaimValue = Math.max(0, Math.round((rcv - deductible) * 100) / 100);
    const cents = Math.round(rcv * 100);
    const downCents = Math.round(cents * 0.5);
    const midCents = Math.round(cents * 0.25);
    job.financials.downPayment = downCents / 100;
    job.financials.midProgressPayment = midCents / 100;
    job.financials.balancePayment = (cents - downCents - midCents) / 100;
    recordDerived(state, { key: 'netClaimValue', label: 'Net Claim Value', section: 'financials' }, formatUsd(job.financials.netClaimValue), 'CALCULATED', 'Formula: RCV - deductible');
    recordDerived(state, { key: 'downPayment', label: 'Down Payment (50%)', section: 'financials' }, formatUsd(job.financials.downPayment), 'CALCULATED', 'Formula: 50% of total RCV');
    recordDerived(state, { key: 'midProgressPayment', label: 'Mid-Progress Payment (25%)', section: 'financials' }, formatUsd(job.financials.midProgressPayment), 'CALCULATED', 'Formula: 25% of total RCV');
    recordDerived(state, { key: 'balancePayment', label: 'Balance Payment (25%)', section: 'financials' }, formatUsd(job.financials.balancePayment), 'CALCULATED', 'Formula: 25% balance of total RCV');
  } else if (!hadExistingJob) {
    state.provenance['netClaimValue'] = { source: 'CALCULATED', detail: 'Formula: RCV - Deductible' };
    state.provenance['downPayment'] = { source: 'CALCULATED', detail: 'Formula: 50% of Total RCV' };
    state.provenance['midProgressPayment'] = { source: 'CALCULATED', detail: 'Formula: 25% of Total RCV' };
    state.provenance['balancePayment'] = { source: 'CALCULATED', detail: 'Formula: 25% Remaining Balance' };
  }

  if (!job.insurance.lossDescription && job.customer.customerName) {
    job.insurance.lossDescription = `Restoration and reconstruction services required following ${job.insurance.typeOfLoss} at ${job.customer.lossAddress || 'property location'}.`;
    recordDerived(state, { key: 'lossDescription', label: 'Loss Description', section: 'insurance' }, job.insurance.lossDescription, 'DRAFTED', 'Factual summary derived from the loss peril');
  }

  if (!state.entries.has('estimator')) {
    state.provenance['estimator'] = { source: 'FOUND', detail: `Standard branch default: ${job.team.estimator}` };
  }
}

/**
 * Parses raw text from DASH, Xactimate estimate summaries, carrier logs, or intake emails
 * into the normalized Master Job Record with full provenance tracking.
 *
 * When an existing job is supplied the paste is MERGED into it: fields the intake
 * text does not mention keep their current values, so customers can paste several
 * sources (carrier email, then estimate recap) without wiping earlier work.
 */
export function parseRawIntakeText(rawText: string, existingJob?: RestorationJobData): IntakeParseResult {
  const state = createEngineState(existingJob);
  if (!existingJob) state.job.customer.jobNumber = '';

  const lines = rawText.replace(/\r\n?/g, '\n').split('\n');

  for (const def of FIELD_DEFS) {
    let applied = false;

    for (const candidate of collectCandidates(def, lines, state)) {
      const sanitized = sanitizeValue(def, candidate.text);
      if (!sanitized) continue;

      candidate.lines.forEach((index) => state.consumedLines.add(index));

      let { value, display } = sanitized;
      if (def.canonicalize && typeof value === 'string') {
        const canonical = def.canonicalize(value);
        if (!canonical) {
          state.warnings.push(`Could not map "${display}" to a standard ${def.label.toLowerCase()} - please pick it manually.`);
          applied = true;
          break;
        }
        value = canonical;
        display = canonical;
      }

      const detail = display.length > 80 ? `Found in pasted text (${display.slice(0, 60).trim()}...)` : `Found in pasted text: "${display}"`;
      applyExtractedValue(state, def, { value, display }, detail);
      applied = true;
      break;
    }

    if (applied) continue;

    if (def.fallback) {
      const fallback = def.fallback(rawText, state);
      if (fallback) {
        applyExtractedValue(state, def, { value: fallback.value, display: fallback.display }, fallback.detail);
      }
    }
  }

  finishMissingDefaults(state, Boolean(existingJob));

  return {
    jobData: state.job,
    provenance: state.provenance,
    blockingMissingFields: collectBlockingFields(state.job),
    extractionSummary: {
      fieldsExtractedCount: state.extractedCount,
      fieldsUpdatedCount: Array.from(state.entries.values()).filter((entry) => entry.source === 'EXTRACTED' && entry.changed).length,
      sections: buildSections(state.entries),
      warnings: state.warnings,
    },
  };
}

/* ------------------------------------------------------------------ *
 * AI (DeepSeek) extraction routing
 *
 * The DeepSeek intake service returns a structured extraction of the
 * document. This engine sanitizes each AI value, routes it into the
 * master record through the same labelled field definitions and
 * provenance tracking as the rules parser, and computes the same
 * derived defaults (payments, net claim value, drafted descriptions).
 * ------------------------------------------------------------------ */

/** Coerces an AI value (JSON number or "$12,500.00"-style string) to a number. */
function coerceAiNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return isFinite(raw) ? raw : null;
  if (typeof raw === 'boolean' || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const negative = /^\(.*\)$/.test(trimmed) || trimmed.startsWith('-');
  const match = trimmed.match(/-?\$?\s*([\d,]+(?:\.\d{1,2})?)/);
  if (!match) return null;
  const value = parseFloat(match[1].replace(/,/g, ''));
  if (isNaN(value)) return null;
  return negative ? -value : value;
}

/** Sanitizes one AI-provided value against the field definition's rules. */
function sanitizeAiValue(def: FieldDef, raw: unknown): SanitizedValue | null {
  if (raw === undefined || raw === null) return null;

  switch (def.kind) {
    case 'text': {
      const value = String(raw).replace(/\u00a0/g, ' ').trim().slice(0, 200);
      if (!value || (!def.allowPlaceholders && PLACEHOLDER_RE.test(value))) return null;
      return { value, display: value };
    }
    case 'multiline': {
      const value = String(raw).replace(/\u00a0/g, ' ').trim().slice(0, 600);
      if (!value || (!def.allowPlaceholders && PLACEHOLDER_RE.test(value))) return null;
      return { value, display: value.replace(/\n/g, ' \u00b7 ') };
    }
    case 'phone': {
      const normalized = normalizePhone(String(raw));
      if (normalized.replace(/\D/g, '').length < 10) return null;
      return { value: normalized, display: normalized };
    }
    case 'email': {
      const match = String(raw).match(EMAIL_RE);
      if (!match) return null;
      return { value: match[0], display: match[0] };
    }
    case 'date': {
      const iso = normalizeDate(String(raw));
      return iso ? { value: iso, display: iso } : null;
    }
    case 'time': {
      const normalized = normalizeTime(String(raw));
      return normalized ? { value: normalized, display: normalized } : null;
    }
    case 'currency': {
      const value = coerceAiNumber(raw);
      return typeof value === 'number' && isFinite(value)
        ? { value: Math.round(value * 100) / 100, display: formatUsd(value) }
        : null;
    }
    case 'int': {
      const value = coerceAiNumber(raw);
      return typeof value === 'number' && isFinite(value)
        ? { value: Math.round(value), display: String(Math.round(value)) }
        : null;
    }
    case 'boolean': {
      if (raw === true) return { value: true, display: 'Yes' };
      if (raw === false) return { value: false, display: 'No' };
      const lower = String(raw).trim().toLowerCase();
      if (lower === 'yes' || lower === 'true') return { value: true, display: 'Yes' };
      if (lower === 'no' || lower === 'false') return { value: false, display: 'No' };
      return null;
    }
    case 'yesNoPending': {
      const text = String(raw).trim();
      const value =
        text === 'Yes' || text === 'No' || text === 'Pending' ? text : parseYesNoPending(text);
      return value ? { value, display: value } : null;
    }
    case 'ssn4': {
      const digits = String(raw).replace(/\D/g, '');
      if (digits.length < 4) return null;
      const value = digits.slice(-4);
      return { value, display: '\u2022\u2022\u2022\u2022 ' + value };
    }
  }
}

const AI_PROD_NOTE_LABELS: Record<keyof ProductionNotesData, string> = {
  scopeSummary: 'Scope Summary',
  materialsAndEquipment: 'Materials & Equipment',
  scheduleAndAccess: 'Schedule & Access',
  safetyConsiderations: 'Safety Considerations',
  communicationNotes: 'Communication Notes',
  additionalNotes: 'Additional Notes',
};

/**
 * Routes a DeepSeek AI extraction into the Master Job Record.
 *
 * Mirrors parseRawIntakeText: when an existing job is supplied the AI result is
 * MERGED into it - fields the document does not mention keep their current
 * values - and all derived defaults (payment splits, net claim value, drafted
 * loss description) are computed the same way. Provenance records the source
 * as AI (DeepSeek) extractions so the review chips distinguish them from the
 * built-in rules parser.
 */
export function applyAiExtractionToJob(
  payload: AiIntakePayload,
  existingJob?: RestorationJobData
): IntakeParseResult {
  const state = createEngineState(existingJob);
  if (!existingJob) state.job.customer.jobNumber = '';

  const aiByKey: Record<string, unknown> = {
    ...(payload.customer || {}),
    ...(payload.insurance || {}),
    ...(payload.financials || {}),
    ...(payload.team || {}),
    ...(payload.mortgage || {}),
    ...(payload.changeOrder || {}),
    ...(payload.checklist || {}),
  };

  for (const def of FIELD_DEFS) {
    const rawValue = aiByKey[def.key];
    if (rawValue === undefined || rawValue === null) continue;

    const sanitized = sanitizeAiValue(def, rawValue);
    if (!sanitized) {
      const printable = String(rawValue).trim();
      if (printable && printable.toLowerCase() !== 'null') {
        state.warnings.push(
          `AI could not map "${printable.slice(0, 40)}" to ${def.label} - left unchanged.`
        );
      }
      continue;
    }

    let { value, display } = sanitized;
    if (def.canonicalize && typeof value === 'string') {
      const canonical = def.canonicalize(value);
      if (canonical) {
        value = canonical;
        display = canonical;
      } else if (def.key === 'changeType') {
        state.warnings.push(
          `AI could not map "${display}" to increase/decrease/unchanged - left unchanged.`
        );
        continue;
      }
    }

    const short = display.length > 70 ? display.slice(0, 67).trim() + '...' : display;
    applyExtractedValue(state, def, { value, display }, `AI (DeepSeek) extracted: "${short}"`);
  }

  // Production Notes - drafted by the AI from the loss narrative. Never clobber
  // notes the production team has already typed.
  for (const key of Object.keys(AI_PROD_NOTE_LABELS) as Array<keyof ProductionNotesData>) {
    const rawValue = payload.productionNotes[key];
    if (rawValue === undefined || rawValue === null) continue;
    const value = String(rawValue).replace(/\u00a0/g, ' ').trim().slice(0, 600);
    if (!value) continue;
    if ((state.job.productionNotes[key] || '').trim()) continue;
    state.job.productionNotes[key] = value;
    recordDerived(
      state,
      { key, label: AI_PROD_NOTE_LABELS[key], section: 'productionNotes' },
      value.replace(/\n/g, ' ').slice(0, 80),
      'DRAFTED',
      'AI drafted from the loss narrative in the document'
    );
  }

  // Mailing city/state/ZIP - split out by the AI from the address block.
  const cityZip = String(payload.customer.mailingCityStateZip ?? '').trim();
  if (cityZip && cityZip !== state.job.customer.mailingCityStateZip) {
    state.job.customer.mailingCityStateZip = cityZip.slice(0, 100);
    recordDerived(
      state,
      { key: 'mailingCityStateZip', label: 'Mailing City/State/ZIP', section: 'customer' },
      cityZip.slice(0, 100),
      'EXTRACTED',
      'AI (DeepSeek) extracted the city/state/ZIP from the address'
    );
  }

  // Spouse last-4 SSN - tracked on the record but not exposed as a labelled field.
  const spouseRaw = payload.mortgage.spouseLast4Ssn;
  if (spouseRaw !== undefined && spouseRaw !== null) {
    const digits = String(spouseRaw).replace(/\D/g, '');
    if (digits.length >= 4 && !state.job.mortgage.spouseLast4Ssn) {
      state.job.mortgage.spouseLast4Ssn = digits.slice(-4);
      recordDerived(
        state,
        { key: 'spouseLast4Ssn', label: 'Spouse Last 4 SSN', section: 'mortgage' },
        '\u2022\u2022\u2022\u2022 ' + digits.slice(-4),
        'EXTRACTED',
        'AI (DeepSeek) extracted the spouse last-4 SSN'
      );
    }
  }

  // AI-reported gaps become review warnings.
  for (const label of payload.missingCoreFields || []) {
    const trimmed = String(label).trim();
    if (trimmed) state.warnings.push(`Not found in the document: ${trimmed}`);
  }

  finishMissingDefaults(state, Boolean(existingJob));

  return {
    jobData: state.job,
    provenance: state.provenance,
    blockingMissingFields: collectBlockingFields(state.job),
    extractionSummary: {
      fieldsExtractedCount: state.extractedCount,
      fieldsUpdatedCount: Array.from(state.entries.values()).filter(
        (entry) => entry.source === 'EXTRACTED' && entry.changed
      ).length,
      sections: buildSections(state.entries),
      warnings: state.warnings,
      aiNotes: (payload.analysisNotes || '').trim() || undefined,
    },
  };
}





