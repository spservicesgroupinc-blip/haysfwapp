/**
 * PDF layout auditor.
 *
 * Loads every generated PDF and inspects the real text geometry (via pdf.js)
 * to objectively detect the classic "unprofessional PDF" defects:
 *
 *   1. OFF_PAGE   - glyphs drawn outside the 612x792 page box
 *   2. MARGIN     - glyphs closer than TOO_CLOSE pt to a page edge
 *   3. OVERLAP    - two text runs sharing a baseline whose x-ranges collide
 *   4. NARROW_GAP - text that runs into the printable right edge (near-touch)
 *
 * Run with:  npx tsx scripts/audit-pdfs.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.js';

const OUT_DIR = join(process.cwd(), 'src', 'out');
const PAGE_W = 612;
const PAGE_H = 792;
const TOO_CLOSE = 26; // pt from a page edge before we call it a margin breach
const TOL = 1.0; // geometry tolerance (pt)

type Item = { text: string; x: number; y: number; w: number; h: number };
type Finding = { kind: string; page: number; detail: string };

async function auditFile(file: string): Promise<{ findings: Finding[]; pages: number }> {
  const data = new Uint8Array(readFileSync(file));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  const findings: Finding[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: Item[] = [];

    for (const raw of content.items as any[]) {
      if (!raw || typeof raw.str !== 'string') continue;
      const text = raw.str;
      if (!text.trim()) continue;
      const t = raw.transform as number[];
      items.push({ text, x: t[4], y: t[5], w: raw.width ?? 0, h: raw.height ?? 0 });
    }

    for (const it of items) {
      const right = it.x + it.w;
      const top = it.y + it.h;
      const snippet = it.text.length > 42 ? it.text.slice(0, 42) + '\u2026' : it.text;

      if (it.x < -TOL || right > PAGE_W + TOL || it.y < -TOL || top > PAGE_H + TOL) {
        findings.push({
          kind: 'OFF_PAGE',
          page: p,
          detail: `x=${it.x.toFixed(1)} right=${right.toFixed(1)} y=${it.y.toFixed(1)} "${snippet}"`,
        });
      } else if (it.x < TOO_CLOSE || right > PAGE_W - TOO_CLOSE || it.y < 18 || top > PAGE_H - 24) {
        findings.push({
          kind: 'MARGIN',
          page: p,
          detail: `x=${it.x.toFixed(1)} right=${right.toFixed(1)} y=${it.y.toFixed(1)} "${snippet}"`,
        });
      }
    }

    // Baseline-bucket overlap detection.
    const byLine = new Map<number, Item[]>();
    for (const it of items) {
      const key = Math.round(it.y / 2) * 2;
      const arr = byLine.get(key) ?? [];
      arr.push(it);
      byLine.set(key, arr);
    }
    for (const [, group] of byLine) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        const prevEnd = prev.x + prev.w;
        if (cur.x < prevEnd - 2) {
          findings.push({
            kind: 'OVERLAP',
            page: p,
            detail: `"${prev.text.slice(0, 26)}" ends ${prevEnd.toFixed(1)} vs "${cur.text.slice(0, 26)}" starts ${cur.x.toFixed(1)}`,
          });
        }
      }
    }
  }

  return { findings, pages: doc.numPages };
}

const files = readdirSync(OUT_DIR).filter((f) => f.endsWith('.pdf')).sort();
let totalFindings = 0;
let filesWithIssues = 0;

for (const file of files) {
  try {
    const { findings, pages } = await auditFile(join(OUT_DIR, file));
    totalFindings += findings.length;
    if (findings.length) filesWithIssues++;
    const status = findings.length === 0 ? 'CLEAN' : `${findings.length} ISSUE(S)`;
    console.log(`\n${status}  ${file}  (${pages} page${pages === 1 ? '' : 's'})`);
    const byKind = findings.reduce<Record<string, number>>((acc, f) => {
      acc[f.kind] = (acc[f.kind] ?? 0) + 1;
      return acc;
    }, {});
    if (findings.length) {
      console.log(`   summary: ${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join('  ')}`);
      for (const f of findings.slice(0, 12)) {
        console.log(`   [p${f.page}] ${f.kind}: ${f.detail}`);
      }
      if (findings.length > 12) console.log(`   ... and ${findings.length - 12} more`);
    }
  } catch (err: any) {
    totalFindings++;
    filesWithIssues++;
    console.log(`\nERROR  ${file}: ${err?.message || err}`);
  }
}

console.log(`\n==== ${files.length} files | ${filesWithIssues} with issues | ${totalFindings} findings ====`);
