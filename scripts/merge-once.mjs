/**
 * One-off migration: merge the six split .gs files back into a single
 * apps-script/Code.gs. The exact inverse of split-once.mjs.
 *
 * Why: the backend is delivered by copy-paste into the Apps Script editor, and
 * one file is the simplest thing to paste and keep in sync. The split existed
 * only to dodge paste truncation; scripts/split-once.mjs can regenerate it if a
 * large paste ever truncates again.
 *
 * Run once:  node scripts/merge-once.mjs
 * Then delete the five partial files it names at the end - after that the repo
 * holds a single Code.gs and this script has done its job.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'C:/Desktop/src/apps-script';
const ORDER = ['Code.gs', 'WebApp.gs', 'Sessions.gs', 'Registration.gs', 'Jobs.gs', 'Support.gs'];
// Everything except Code.gs loses its top-of-file doc comment; Code.gs keeps its
// header, because that is the file that gets pasted and its banner stays current.
const STRIP_HEADER = new Set(ORDER.slice(1));

let eol = '\n';
const parts = [];
for (const name of ORDER) {
  let text = readFileSync(join(DIR, name), 'utf8');
  if (text.includes('\r\n')) eol = '\r\n';
  text = text.split(/\r?\n/).join('\n');

  if (STRIP_HEADER.has(name)) {
    if (!text.startsWith('/**')) throw new Error(name + ': expected a leading doc comment');
    const end = text.indexOf('*/');
    if (end === -1) throw new Error(name + ': unterminated doc comment');
    text = text.slice(end + 2).replace(/^\n+/, '');
  }

  parts.push({ name, text: text.replace(/\n+$/, '') });
}

const merged = parts.map((part) => part.text).join('\n\n') + '\n';

/** Every top-level `function name(` in a chunk of source, sorted. */
function functionNames(source) {
  return [...source.matchAll(/^function\s+([A-Za-z0-9_]+)\s*\(/gm)]
    .map((match) => match[1])
    .sort();
}

const before = ORDER.flatMap((name) => functionNames(readFileSync(join(DIR, name), 'utf8'))).sort();
const after = functionNames(merged);
if (JSON.stringify(before) !== JSON.stringify(after)) {
  throw new Error('Function set changed during the merge - aborting without writing.');
}

const counts = new Map();
for (const fn of after) counts.set(fn, (counts.get(fn) || 0) + 1);
const duplicates = [...counts].filter(([, count]) => count > 1);
if (duplicates.length > 0) {
  console.log('Duplicate function names: ' + duplicates.map(([fn, count]) => `${fn} x${count}`).join(', '));
}

writeFileSync(join(DIR, 'Code.gs'), merged.split('\n').join(eol), 'utf8');

console.log('Merged into Code.gs:');
for (const part of parts) {
  console.log(`  ${part.name.padEnd(18)} ${String(part.text.split('\n').length).padStart(5)} lines`);
}
console.log(`\nCode.gs now holds ${merged.split('\n').length - 1} lines and ${after.length} top-level functions.`);
console.log(`Line endings: ${eol === '\r\n' ? 'CRLF' : 'LF'}`);
console.log('\nNext: verify, then delete the five partial files:');
console.log('  WebApp.gs Sessions.gs Registration.gs Jobs.gs Support.gs');
