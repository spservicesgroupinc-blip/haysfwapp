/**
 * Local PDF smoke-test harness.
 *
 * Generates every Hays + Sons production document (plus the merged packet)
 * for each sample scenario into ./out so the rendered pages can be inspected.
 *
 * Run with:  npx tsx scripts/generate-sample-pdfs.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RestorationJobData, createEmptyJob } from '../src/types/jobData';
import { SAMPLE_WATER, SAMPLE_STORM, SAMPLE_FIRE } from './fixtures';
import {
  generatePreliminaryReport,
  generateWelcomeLetter,
  generateMortgageAuth,
  generateContract,
  generateCancellationNotice,
  generateChangeOrder,
  generateProductionChecklist,
  generateProductionNotes,
  generateCompletePacket,
} from '../src/services/pdfService';

const OUT_DIR = join(process.cwd(), 'src', 'out');
mkdirSync(OUT_DIR, { recursive: true });

type Generator = { name: string; run: (d: RestorationJobData) => Promise<Uint8Array> };

const DOCS: Generator[] = [
  { name: '01_Preliminary_Report', run: generatePreliminaryReport },
  { name: '02_Customer_Welcome_Letter', run: generateWelcomeLetter },
  { name: '03_Mortgage_Authorization', run: generateMortgageAuth },
  { name: '04_Structural_Repair_Agreement', run: generateContract },
  { name: '05_Notice_of_Cancellation', run: generateCancellationNotice },
  { name: '06_Change_Order_Addendum', run: generateChangeOrder },
  { name: '07_Production_Checklist', run: generateProductionChecklist },
  { name: '08_Production_Notes', run: generateProductionNotes },
  { name: '00_Complete_Packet', run: generateCompletePacket },
];

/** Deep-clones an empty job and blanks every scalar to stress-test empties. */
function blankJob(): RestorationJobData {
  const clone: any = JSON.parse(JSON.stringify(createEmptyJob()));
  const walk = (obj: any) => {
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (typeof value === 'string') obj[key] = '';
      else if (typeof value === 'number') obj[key] = 0;
      else if (value && typeof value === 'object') walk(value);
    }
  };
  walk(clone);
  return clone as RestorationJobData;
}

const SCENARIOS: Array<{ name: string; data: RestorationJobData }> = [
  { name: 'water', data: SAMPLE_WATER },
  { name: 'storm', data: SAMPLE_STORM },
  { name: 'fire', data: SAMPLE_FIRE },
  { name: 'blank', data: blankJob() },
];

const failures: string[] = [];
let generated = 0;

for (const scenario of SCENARIOS) {
  for (const doc of DOCS) {
    const label = `${scenario.name}/${doc.name}`;
    try {
      const bytes = await doc.run(scenario.data);
      const file = join(OUT_DIR, `${scenario.name}_${doc.name}.pdf`);
      writeFileSync(file, bytes);
      generated++;
      console.log(`  OK   ${label.padEnd(42)} ${String(bytes.byteLength).padStart(7)} bytes`);
    } catch (err: any) {
      failures.push(`${label}: ${err?.message || err}`);
      console.log(`  FAIL ${label.padEnd(42)} ${err?.message || err}`);
    }
  }
}

console.log(`\nGenerated ${generated}/${SCENARIOS.length * DOCS.length} files into ${OUT_DIR}`);
if (failures.length) {
  console.log(`\n${failures.length} FAILURE(S):`);
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exitCode = 1;
}
