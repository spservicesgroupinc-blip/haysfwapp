/**
 * Guard: `Code.gs` must be pure ASCII.
 *
 * The Apps Script editor is fed this file by copy-paste. Any multi-byte
 * character (em dash, curly quote, non-breaking space, zero-width space)
 * risks being mangled by the clipboard, the browser, or a non-UTF-8 editor,
 * which turns a harmless punctuation mark into a stray delimiter and produces
 * a confusing "Invalid or unexpected token" error on a *later* line.
 *
 * Keeping the file ASCII-only removes that entire class of failure and keeps
 * the copy-paste workflow reliable. It also prints each file's line count so a
 * paste can be checked against the editor (Ctrl+End; last line must be "}").
 *
 * Run: npx tsx scripts/check-appsscript-ascii.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, '..', 'src', 'apps-script');

const files = readdirSync(dir)
  .filter((name) => name.endsWith('.gs'))
  .sort();

if (files.length === 0) {
  console.error(`No .gs files found in ${dir}`);
  process.exit(1);
}

// The backend ships as ONE pasteable file. A leftover split (the six-file
// fallback) or a stray copy here would silently inflate the line count this
// check prints - and that count is what a paste gets verified against in the
// Apps Script editor. Worse, pasting a split file on its own makes helpers
// defined in its siblings (`currentSchemaVersion_`, for one) vanish, which
// surfaces at run time as "X is not defined". Refuse to guess.
if (files.length > 1) {
  console.error(`Expected exactly one .gs file in ${dir}, found ${files.length}:`);
  for (const name of files) console.error(`  ${name}`);
  console.error(
    '\nsrc/apps-script/ must contain only Code.gs. Use src/apps-script/paste-chunks/ ' +
      '(npm run apps:chunks) to get past the editor\'s paste-size limit instead of splitting the file.',
  );
  process.exit(1);
}

interface Finding {
  file: string;
  line: number;
  codepoint: number;
  char: string;
  text: string;
}

const findings: Finding[] = [];
const perFile: { name: string; lines: number }[] = [];
let totalLines = 0;

for (const name of files) {
  const lines = readFileSync(join(dir, name), 'utf8').split(/\r?\n/);
  // A trailing newline yields one empty element; it is not a line.
  const lineCount = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
  perFile.push({ name, lines: lineCount });
  totalLines += lineCount;

  lines.forEach((text, index) => {
    for (const char of text) {
      const codepoint = char.codePointAt(0) ?? 0;
      // Allow tab (9). Reject everything else above printable ASCII.
      if (codepoint > 126 && codepoint !== 9) {
        findings.push({
          file: name,
          line: index + 1,
          codepoint,
          char,
          text: text.trim().slice(0, 80),
        });
      }
    }
  });
}

if (findings.length > 0) {
  console.error(`${findings.length} non-ASCII character(s) found.\n`);
  for (const f of findings) {
    console.error(
      `  ${f.file}:${f.line}  U+${f.codepoint.toString(16).toUpperCase().padStart(4, '0')} "${f.char}"\n    ${f.text}`,
    );
  }
  console.error(
    '\nReplace with ASCII equivalents (- for dashes, " for quotes, space for NBSP).',
  );
  process.exit(1);
}

const fileLabel = files.length === 1 ? 'The Apps Script file is' : `All ${files.length} Apps Script files are`;
console.log(`${fileLabel} pure ASCII (${totalLines} lines). Safe to copy-paste.\n`);
for (const entry of perFile) {
  console.log(`  ${entry.name.padEnd(18)} ${String(entry.lines).padStart(4)} lines`);
}
console.log(
  '\nAfter pasting into the Apps Script editor: the line count must match the value above and the last line must be "}" (Ctrl+End).',
);
