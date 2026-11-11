/**
 * Emergency fallback: split the single apps-script/Code.gs into six smaller
 * .gs files.
 *
 * The backend normally ships as one file, but a ~2400-line paste was truncated
 * by the Apps Script editor once before. If that happens again, run this once
 * and paste the six smaller files instead. A truncated paste that lands inside
 * a block comment produces a baffling "Invalid or unexpected token" pointing at
 * the comment's opening line, not at the real problem.
 *
 * Apps Script concatenates every .gs file in a project into one global scope, so
 * splitting is purely cosmetic for the runtime: these are all `function`
 * declarations and top-level `var` initialisers that never reference each other
 * at load time, which means hoisting makes the file order irrelevant.
 *
 * Run once:  node scripts/split-once.mjs
 * Safe to re-run: it always regenerates every output file from Code.gs.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DIR = 'C:/Desktop/src/apps-script';
const SOURCE = join(DIR, 'Code.gs');
const EOL = '\r\n';

const text = readFileSync(SOURCE, 'utf8');
// Preserve the original line endings; split on either so we are not surprised.
const raw = text.split(/\r?\n/);
// A trailing newline yields a final empty element - drop it, we re-add it on write.
if (raw.length && raw[raw.length - 1] === '') raw.pop();

/** 0-based index of the first line containing `needle`. */
function at(needle) {
  const i = raw.findIndex((line) => line.includes(needle));
  if (i === -1) throw new Error(`Marker not found: ${needle}`);
  return i;
}

/** The `/* ---` line that opens a numbered section banner. */
const section = (label) => at(label) - 1;

const s1 = section(' * 1. CONFIGURATION');
const s4 = section(' * 4. WEB APP ENTRY POINTS');
const s5b = section(' * 5B. APPLICATION');
const sRegistration = at('/* --- Self-service registration');
const s6 = section(' * 6. ACTIONS');
const s8 = section(' * 8. SHEET ACCESS');

const HEADER = `/**
 * ============================================================================
 *  HAYS + SONS COMPLETE RESTORATION - CUSTOMER & JOB DATABASE
 *  Google Apps Script backend  -  1 of 6: configuration + provisioning
 * ============================================================================
 *
 *  THIS PROJECT IS SPLIT ACROSS SIX FILES. Paste each one into its own file in
 *  the Apps Script editor (the editor's "+" button adds a script file). The
 *  names below are only a guide - any file name works.
 *
 *    Code.gs          <- this file: configuration, provisioning, menu
 *    WebApp.gs        web app entry points and authentication
 *    Sessions.gs      accounts, sessions, login/logout, user administration
 *    Registration.gs  self-service sign-up
 *    Jobs.gs          job actions and record normalisation
 *    Support.gs       sheet access, utilities, self test
 *
 *  Apps Script merges every .gs file in a project into a single global scope, so
 *  the split is purely organisational - no imports and no load order to worry
 *  about.
 *
 *  QUICK START
 *    1. Create the six files and paste one of ours into each.
 *    2. Project Settings -> Show appsscript.json -> paste the manifest.
 *    3. Run ONE command and approve the permissions prompt:
 *         setupDatabase()
 *       That provisions the spreadsheet, every sheet, all headers, formatting
 *       and the README tab. It is idempotent, so running it again is safe.
 *       Add an admin in the same call with three arguments, run from a
 *       temporary wrapper because the editor cannot pass arguments:
 *         function bootstrap() {
 *           setupDatabase('you@example.com', 'Your Name', 'a-strong-password');
 *         }
 *    4. Run selfTest()  ->  should report PASS
 *    5. Deploy -> New deployment -> Web app
 *         Execute as:      Me
 *         Who has access:  Anyone
 *       Copy the /exec URL into the front-end as VITE_APPS_SCRIPT_URL
 *    6. SIGN-UP IS OPEN by default - anyone with the web app URL can create an
 *       account from the login page. To lock it down, run either of these from
 *       the function dropdown (no arguments, so they run directly, and both take
 *       effect immediately with no redeploy):
 *         disableRegistration()   -> no sign-up at all
 *         useInviteCode()         -> an invite code is required
 *
 *  If step 3 is skipped, the very first web request provisions the database
 *  automatically, so a fresh deployment is never left half-built.
 *
 *  SECURITY MODEL
 *    The app has its own login page. Credentials are checked against the "Users"
 *    sheet and a short-lived bearer token is issued, recorded in the "Sessions"
 *    sheet and sent with every subsequent request.
 *
 *    Passwords are never stored in plain text: each account carries a random
 *    salt and an iterated HMAC-SHA256 derivation. Accounts lock after repeated
 *    failures and sessions expire automatically.
 *
 *    The Google ID-token path (ALLOWED_CLIENT_ID / ALLOWED_EMAILS) remains
 *    available but optional. SHARED_SECRET is a deliberate developer bypass and
 *    must stay unset in production.
 *
 *    Self-service sign-up is OPEN by default: anyone who has the web app URL can
 *    create an account from the login page. It can be restricted to an invite
 *    code, or switched off entirely, and it can never create an administrator.
 *    The policy lives in the REGISTRATION_MODE Script Property:
 *      open (default) | invite | off
 *
 *  API
 *    POST /exec   Content-Type: text/plain;charset=utf-8
 *                 body: {"action":"login","email":"...","password":"..."}
 *                       {"action":"register","email":"...","name":"...","password":"...","inviteCode":"..."}
 *                       {"action":"saveJob","sessionToken":"<token>","job":{...}}
 *                 Every response is HTTP 200 with a JSON envelope:
 *                 {"ok":true,"data":{...}}  |  {"ok":false,"error":"...","code":"..."}
 *                 Always branch on 'ok', never on the HTTP status.
 * ============================================================================
 */`;

const BANNERS = {
  'WebApp.gs': `/**
 * HAYS + SONS CUSTOMER & JOB DATABASE - 2 of 6: web app entry points and auth
 *
 * The POST router plus the authentication chain: session token, then the
 * developer shared secret, then the Google ID-token path. See Code.gs for the
 * full project overview.
 */`,
  'Sessions.gs': `/**
 * HAYS + SONS CUSTOMER & JOB DATABASE - 3 of 6: accounts and sessions
 *
 * Password hashing, session issue/validate/revoke, login and logout, and the
 * editor-only user administration helpers. See Code.gs for the overview.
 */`,
  'Registration.gs': `/**
 * HAYS + SONS CUSTOMER & JOB DATABASE - 4 of 6: self-service sign-up
 *
 * The only endpoint reachable without credentials, so it carries the most
 * guards: open/invite/off modes, an optional domain allow-list, and a hard rule
 * that self-service can never mint an administrator. See Code.gs for the overview.
 */`,
  'Jobs.gs': `/**
 * HAYS + SONS CUSTOMER & JOB DATABASE - 5 of 6: jobs and record normalisation
 *
 * Save/list/get/delete/search plus the round-trip safety net that repairs
 * anything a spreadsheet can do to the record shape. See Code.gs for the overview.
 */`,
  'Support.gs': `/**
 * HAYS + SONS CUSTOMER & JOB DATABASE - 6 of 6: sheet access, utilities, self test
 *
 * Low-level spreadsheet access, small conversion helpers, and selfTest(), which
 * exercises the whole system against the real spreadsheet. See Code.gs for the
 * overview.
 */`,
};

/** Raw line slices straight out of the monolith - no added banners. */
const slices = [
  ['Code.gs', raw.slice(s1, s4)],
  ['WebApp.gs', raw.slice(s4, s5b)],
  ['Sessions.gs', raw.slice(s5b, sRegistration)],
  ['Registration.gs', raw.slice(sRegistration, s6)],
  ['Jobs.gs', raw.slice(s6, s8)],
  ['Support.gs', raw.slice(s8)],
];

const BANNER_FOR = { 'Code.gs': HEADER, ...BANNERS };

// Guard against a bad split: every source line must land in exactly one file.
const originalCount = raw.slice(s1).length;
const splitCount = slices.reduce((n, [, body]) => n + body.length, 0);
if (originalCount !== splitCount) {
  throw new Error(`Line accounting mismatch: source ${originalCount}, split ${splitCount}`);
}

const withBanner = ([name, body]) => {
  const banner = BANNER_FOR[name];
  const content = banner ? [...banner.split('\n'), '', ...body] : body.slice();
  while (content.length && content[content.length - 1].trim() === '') content.pop();
  return content;
};

const summary = [];
const all = [];
for (const slice of slices) {
  const [name] = slice;
  const content = withBanner(slice);
  writeFileSync(join(DIR, name), content.join(EOL) + EOL, 'utf8');
  summary.push(`${name.padEnd(18)} ${String(content.length).padStart(5)} lines`);
  all.push(content.join(EOL));
}

console.log('Split written:');
console.log(summary.join('\n'));

// The concatenation must still be valid JavaScript - checked by the caller.
const concatPath = join(tmpdir(), 'appsscript-concat-check.js');
writeFileSync(concatPath, all.join(EOL) + EOL, 'utf8');
console.log(`\nConcatenation for syntax checking: ${concatPath}`);
console.log(`Source body lines: ${originalCount} (old top-of-file doc comment excluded)`);
console.log(`Split files: ${slices.length} - each well under the size that was truncating.`);
