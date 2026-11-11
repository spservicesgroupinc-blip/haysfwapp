/**
 * Generates the single copy-paste payload for the Apps Script editor.
 *
 * Why: the backend is one file (src/apps-script/Code.gs), but that folder also
 * holds appsscript.json, README.md and paste-chunks/, which are not the payload.
 * Pasting the wrong one surfaces as "someFunction_ is not defined" at runtime,
 * because Apps Script merges a project's .gs files into one global scope - so a
 * file that references helpers living in a file you did not paste fails only
 * when that line is reached.
 *
 * This writes ONE obvious file - src/apps-script/PASTE-INTO-APPS-SCRIPT.txt -
 * and proves it is pure ASCII, byte-identical to Code.gs, and ends on a lone "}".
 *
 * The .txt extension is deliberate: scripts/check-appsscript-ascii.ts globs *.gs
 * in that folder, and a second .gs copy would inflate its line-count report and
 * break the "verify the paste was not truncated" step.
 *
 * Run:  npm run apps:paste     (or: node scripts/make-paste-file.mjs)
 * Safe to re-run: it rebuilds the payload from scratch every time.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// Resolve against this script, never a hardcoded absolute path.
const here = dirname(fileURLToPath(import.meta.url));
const APPSCRIPT_DIR = resolve(here, '..', 'src', 'apps-script');
const SOURCE = join(APPSCRIPT_DIR, 'Code.gs');
const TARGET = join(APPSCRIPT_DIR, 'PASTE-INTO-APPS-SCRIPT.txt');

const raw = readFileSync(SOURCE, 'utf8');

// 1. Pure ASCII. The file is delivered by copy-paste, so one multi-byte character
//    (em dash, curly quote, NBSP) can become a stray delimiter and surface as a
//    confusing "Invalid or unexpected token" error on a later line.
const offenders = [];
raw.split(/\r?\n/).forEach((text, index) => {
  for (const char of text) {
    const codepoint = char.codePointAt(0) ?? 0;
    if (codepoint > 126 && codepoint !== 9) {
      offenders.push({ line: index + 1, codepoint, char, text: text.trim().slice(0, 80) });
    }
  }
});

if (offenders.length > 0) {
  console.error(`${offenders.length} non-ASCII character(s) in Code.gs - fix these first:\n`);
  for (const f of offenders) {
    console.error(
      `  Code.gs:${f.line}  U+${f.codepoint.toString(16).toUpperCase().padStart(4, '0')} "${f.char}"\n    ${f.text}`,
    );
  }
  console.error('\nReplace with ASCII equivalents (- for dashes, " for quotes, space for NBSP).');
  process.exit(1);
}

// 2. Write the payload.
writeFileSync(TARGET, raw, 'utf8');

// 3. Prove the copy is byte-exact, so the payload can never drift from Code.gs.
if (!readFileSync(TARGET).equals(Buffer.from(raw, 'utf8'))) {
  console.error('Copy check failed: the payload is not byte-identical to Code.gs.');
  process.exit(1);
}

const lines = raw.split(/\r?\n/);
const lineCount = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
const lastLine = lines[lineCount - 1] ?? '';

// A truncated paste always fails at the end of what arrived, so a known-good
// last line plus a line count is the fastest way to detect it.
if (lastLine !== '}') {
  console.error(`Last line is ${JSON.stringify(lastLine)}, expected "}".`);
  process.exit(1);
}

console.log('Paste payload written: src/apps-script/PASTE-INTO-APPS-SCRIPT.txt');
console.log(
  `  ${String(lineCount).padStart(4)} lines, ${Buffer.byteLength(raw, 'utf8')} bytes, byte-identical to Code.gs`,
);
console.log('\nPaste it into the Apps Script editor\'s Code.gs (Ctrl+A, Delete first).');
console.log('Then Ctrl+End: the last line must be "}" and the count must match the value above.');
console.log('The manifest goes in a separate box: Project Settings -> Show appsscript.json.');
