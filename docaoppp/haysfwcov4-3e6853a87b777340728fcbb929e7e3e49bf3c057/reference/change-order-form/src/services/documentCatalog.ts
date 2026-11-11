/**
 * Canonical catalog of the eight Hays + Sons production deliverables.
 *
 * `DocumentGenerationPanel` renders the full list; the individual form pages use the same entries
 * to offer a quick Preview / Download without leaving the section they are editing. Generators and
 * production file names live here so both entry points can never drift apart.
 */
import type { RestorationJobData } from '../types/jobData';
import {
  generateCancellationNotice,
  generateChangeOrder,
  generateContract,
  generateMortgageAuth,
  generatePreliminaryReport,
  generateProductionChecklist,
  generateProductionNotes,
  generateWelcomeLetter,
} from './pdfService';

export interface JobDocument {
  /** Stable id used for React keys and per-button spinner state. */
  id: string;
  /** Production order code shown on badges (01–07). */
  code: string;
  /** Short name used on the quick Preview / Download actions. */
  label: string;
  /** Title shown in the preview modal. */
  title: string;
  /** Page range as it appears on the packet cover. */
  pages: string;
  /** One-line description used by the Documents & Output cards. */
  description: string;
  /** The pdf-lib generator for this document. */
  generator: (data: RestorationJobData) => Promise<Uint8Array>;
  /** Production-convention file name (job number sanitized for disk). */
  buildFileName: (data: RestorationJobData) => string;
}

export const safeJobNumber = (data: RestorationJobData): string =>
  (data.customer.jobNumber || 'FW-JOB').replace(/[^a-zA-Z0-9\-_]/g, '');

export const safeCustomerName = (data: RestorationJobData): string =>
  (data.customer.customerName || 'Customer').replace(/[^a-zA-Z0-9]/g, '_');

/** File name of the combined 9-page packet (deliverable 00). */
export const buildCombinedPacketFileName = (data: RestorationJobData): string =>
  `00_${safeJobNumber(data)}_${safeCustomerName(data)}_Combined_Production_Packet.pdf`;

export const DOC = {
  preliminaryReport: {
    id: 'prelim',
    code: '01',
    label: 'Preliminary Report',
    title: 'Preliminary Report',
    pages: 'Page 1',
    description: 'Carrier, claim adjuster, loss contact, inspect date, participants',
    generator: generatePreliminaryReport,
    buildFileName: (data: RestorationJobData) =>
      `01_${safeJobNumber(data)}_Preliminary_Report.pdf`,
  },
  welcomeLetter: {
    id: 'welcome',
    code: '02',
    label: 'Customer Welcome Letter',
    title: 'Customer Welcome Letter',
    pages: 'Page 2',
    description: 'Hays + Sons 4-phase process explanation & emergency dry-out scope',
    generator: generateWelcomeLetter,
    buildFileName: (data: RestorationJobData) =>
      `02_${safeJobNumber(data)}_Customer_Welcome_Letter.pdf`,
  },
  mortgageAuth: {
    id: 'mortgage',
    code: '03',
    label: 'Mortgage Authorization',
    title: 'Mortgage Authorization',
    pages: 'Page 3',
    description: 'Lender inspection release & joint draft endorsement authorization',
    generator: generateMortgageAuth,
    buildFileName: (data: RestorationJobData) =>
      `03_${safeJobNumber(data)}_Mortgage_Authorization.pdf`,
  },
  contract: {
    id: 'contract',
    code: '04',
    label: 'Structural Repair Agreement',
    title: 'Structural Repair Agreement',
    pages: 'Pages 4–5',
    description: 'RCV repairs, 50% down payment, 10-day start, 60-day complete, POA',
    generator: generateContract,
    buildFileName: (data: RestorationJobData) =>
      `04_${safeJobNumber(data)}_Structural_Repair_Agreement.pdf`,
  },
  cancellationNotice: {
    id: 'cancellation',
    code: '05',
    label: 'Notice of Cancellation',
    title: 'Notice of Cancellation',
    pages: 'Page 6',
    description: '3-day statutory cancellation rights under Indiana home improvement laws',
    generator: generateCancellationNotice,
    buildFileName: (data: RestorationJobData) =>
      `05_${safeJobNumber(data)}_Notice_of_Cancellation.pdf`,
  },
  changeOrder: {
    id: 'change_order',
    code: '06',
    label: 'Change Order / Addendum',
    title: 'Change Order / Addendum',
    pages: 'Page 7',
    description: 'Supplemental scope, +/- sum adjustments, and added contract days',
    generator: generateChangeOrder,
    buildFileName: (data: RestorationJobData) =>
      `06_${safeJobNumber(data)}_Change_Order_Addendum.pdf`,
  },
  productionChecklist: {
    id: 'checklist',
    code: '07',
    label: 'Production Checklist',
    title: 'Production Checklist',
    pages: 'Page 8',
    description: 'DASH tracking, deductible collection verify, Xactimate version, dates',
    generator: generateProductionChecklist,
    buildFileName: (data: RestorationJobData) =>
      `07_${safeJobNumber(data)}_Production_Checklist.pdf`,
  },
  productionNotes: {
    id: 'production_notes',
    code: '08',
    label: 'Production Notes',
    title: 'Production Notes',
    pages: 'Page 9',
    description: 'Auto-filled loss & damage summary with space for production team notes',
    generator: generateProductionNotes,
    buildFileName: (data: RestorationJobData) =>
      `08_${safeJobNumber(data)}_Production_Notes.pdf`,
  },
} satisfies Record<string, JobDocument>;

/** Documents in production order (01 → 08), used by the panel and the ZIP package. */
export const JOB_DOCUMENTS: JobDocument[] = [
  DOC.preliminaryReport,
  DOC.welcomeLetter,
  DOC.mortgageAuth,
  DOC.contract,
  DOC.cancellationNotice,
  DOC.changeOrder,
  DOC.productionChecklist,
  DOC.productionNotes,
];
