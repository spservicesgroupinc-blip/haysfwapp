/**
 * Splits apps-script/Code.gs into paste-sized parts.
 *
 * Why: pasting the whole ~89KB file into the Apps Script editor can arrive cut
 * short (evidence: only the first ~623 lines / ~25KB land, and the parser then
 * reports "Unexpected end of input" at the end of what arrived). The parts are
 * contiguous byte-exact slices that end on a top-level "}" line, so pasting
 * part1, part2, ... one after another into the SAME Code.gs reproduces the
 * file exactly - still one single file in the Apps Script project.
 *
 * Run:  npm run apps:chunks     (or: node scripts/make-paste-chunks.mjs)
 * Safe to re-run: it rebuilds src/apps-script/paste-chunks/ every time.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// Resolve against this script, never a hardcoded absolute path. An earlier
// version pointed at C:/Desktop/src/apps-script, so it happily rebuilt the
// chunks from a stale copy while the repo's Code.gs moved on - which surfaces
// later as a "someFunction_ is not defined" error inside the Apps Script editor.
const here = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(here, '..', 'src', 'apps-script');
const SOURCE = join(DIR, 'Code.gs');
const OUT = join(DIR, 'paste-chunks');

// Comfortably below the ~25KB / ~623-line limit observed in the paste path.
const MAX_LINES = 480;
const MAX_BYTES = 18000;
const MIN_LINES = 80;

const raw = readFileSync(SOURCE, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
const lines = raw.split(/\r?\n/);
if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

const startsTopLevel = (line) => /^(function |var |\/\*\*|\/\* |\/\/ )/.test(line);

/**
 * A line whose content is "}" at column 0, followed (after any blank lines) by
 * a new top-level declaration or comment block - a safe place to end a part.
 */
const boundaries = [];
for (let i = 1; i < lines.length - 1; i++) {
  if (lines[i] !== '}') continue;
  let j = i + 1;
  while (j < lines.length && lines[j] === '') j++;
  if (j < lines.length && startsTopLevel(lines[j])) boundaries.push(i);
}

const chunks = [];
let start = 0;
while (start < lines.length) {
  let end = -1;
  for (const candidate of boundaries) {
    if (candidate < start + MIN_LINES) continue;
    if (candidate - start + 1 > MAX_LINES) break;
    const size = Buffer.byteLength(lines.slice(start, candidate + 1).join(eol) + eol, 'utf8');
    if (size > MAX_BYTES) break;
    end = candidate;
  }
  if (end === -1) end = Math.min(start + MAX_LINES - 1, lines.length - 1);
  chunks.push([start, end]);
  start = end + 1;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// The source may or may not end with a newline; the parts have to match it either
// way, otherwise the byte-exact check below fails for a cosmetic difference.
const endsWithEol = raw.endsWith(eol);

const manifest = [];
chunks.forEach(([from, to], index) => {
  const isLast = index === chunks.length - 1;
  const text = lines.slice(from, to + 1).join(eol) + (isLast && !endsWithEol ? '' : eol);
  const name = 'part' + (index + 1) + '.txt';
  writeFileSync(join(OUT, name), text, 'utf8');
  manifest.push({
    name,
    lines: to - from + 1,
    bytes: Buffer.byteLength(text, 'utf8'),
    last: lines[to],
    text,
  });
});

// The parts, pasted one after another, must rebuild the source byte for byte.
const rebuilt = manifest.map((part) => part.text).join('');
if (rebuilt !== raw) {
  throw new Error('Chunk check failed: the parts do not rebuild Code.gs exactly.');
}

console.log('Paste parts written to src/apps-script/paste-chunks/');
console.log('Paste them in order into ONE Code.gs (Ctrl+End between pastes).\n');
let lineCursor = 1;
for (const part of manifest) {
  console.log(
    '  ' + part.name.padEnd(10) +
    ' lines ' + String(lineCursor).padStart(4) + '-' + String(lineCursor + part.lines - 1).padStart(4) +
    '  ' + String(part.lines).padStart(3) + ' lines  ' + (part.bytes / 1024).toFixed(1) + ' KB' +
    '  ends: ' + JSON.stringify(part.last)
  );
  lineCursor += part.lines;
}
console.log('\nTotal: ' + manifest.length + ' parts, ' + lines.length + ' lines, source byte-identical.');
