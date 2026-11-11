/**
 * PDF content regression check.
 *
 * Guards against silent text truncation: every "marker" below is a phrase from
 * the END of a long clause/paragraph, so it only appears in the output if the
 * full text was rendered. (The layout auditor covers overflow/overlap; this
 * covers dropped content.)
 *
 * Run with:  npx tsx scripts/check-text.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.js';

const OUT_DIR = join(process.cwd(), 'src', 'out');

async function pageText(file: string): Promise<string> {
  const data = new Uint8Array(readFileSync(file));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  let text = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const item of content.items as any[]) {
      if (item && typeof item.str === 'string') text += item.str + ' ';
    }
  }
  return text.replace(/\s+/g, ' ');
}

const CASES: Array<{ file: string; markers: string[] }> = [
  {
    file: 'water_01_Preliminary_Report.pdf',
    markers: [
      'Contact 30 mins prior to arrival.',
      'Remediation equipment deployed 08/16.',
      'Moisture readings >80% in kitchen ceiling drywall.',
      'Accounting Person: Jami Hillock',
    ],
  },
  {
    file: 'water_02_Customer_Welcome_Letter.pdf',
    markers: [
      'until it is determined to be dry',
      'final payment is made.',
      'PHASE IV - FINAL WALK THROUGH',
      'kbelford@haysandsons.com',
    ],
  },
  {
    file: 'water_03_Mortgage_Authorization.pdf',
    markers: ['Request Inspections', 'XXX-XX-4482', 'Hays + Sons Representative Signature'],
  },
  {
    file: 'water_04_Structural_Repair_Agreement.pdf',
    markers: [
      'rendered by Hays and Sons Complete Restoration hereunder.',
      'caused by insurance.',
      "including reasonable attorney's fees.",
      'if the OWNER fails to timely pay any amount due.',
      'pursue a claim with your insurance company.',
      'form from Hays & Sons.',
      'Page 2 of 2',
    ],
  },
  {
    file: 'water_05_Notice_of_Cancellation.pdf',
    markers: ['already done by the CONTRACTOR, Hays & Sons Construction, Inc.', 'I HEREBY CANCEL THIS AGREEMENT.'],
  },
  {
    file: 'water_06_Change_Order_Addendum.pdf',
    markers: [
      'moisture barrier.',
      'paid in full for non-insured work.',
      'The new contract sum including this change order will be',
      '$28,050.00',
    ],
  },
  {
    file: 'water_07_Production_Checklist.pdf',
    markers: [
      'confirmed by homeowner.',
      'Upload Necessary Authorizations to Appropriate Insurance Company',
      'Connection, Innovation Property, and IMACC',
      '2026-10-30',
    ],
  },
  {
    file: 'water_08_Production_Notes.pdf',
    markers: [
      'PRODUCTION NOTES',
      'Loss & Damage Details',
      'Sudden pipe burst in upstairs guest bathroom',
      'Additional Production Notes',
      'Scope & Repairs Summary',
      'Crew arrives 7:30 AM weekdays',
      'Photos uploaded to DASH after each phase.',
    ],
  },
  { file: 'water_00_Complete_Packet.pdf', markers: ['Page 9 of 9', 'rendered by Hays and Sons Complete Restoration hereunder.'] },
];

let failures = 0;
for (const c of CASES) {
  const text = await pageText(join(OUT_DIR, c.file));
  const missing = c.markers.filter((m) => !text.includes(m));
  if (missing.length) {
    failures += missing.length;
    console.log(`FAIL  ${c.file}`);
    missing.forEach((m) => console.log(`        missing: "${m}"`));
  } else {
    console.log(`OK    ${c.file}  (${c.markers.length} markers)`);
  }
}

console.log(failures === 0 ? '\nAll content markers present.' : `\n${failures} marker(s) missing.`);
if (failures) process.exitCode = 1;
