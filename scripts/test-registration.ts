/**
 * Focused test harness for the self-service registration path in Code.gs.
 *
 * Registration is the only unauthenticated write endpoint in the backend, so its
 * guards matter more than anything else in the file. This loads Code.gs into a
 * Node VM with an in-memory stand-in for SpreadsheetApp, then drives the real
 * functions and asserts the security properties actually hold:
 *
 *   - off by default (fails closed)
 *   - weak invite codes rejected
 *   - wrong invite code never touches the Users sheet
 *   - 'admin' can never be minted by self-service
 *   - domain allow-list enforced
 *   - passwords stored as hashes, never plain text
 *   - the capability probe never leaks the invite code
 *
 * Run with:  npx tsx scripts/test-registration.ts
 */
import { createHmac } from 'node:crypto';
import vm from 'node:vm';
import { loadAppsScriptSource } from './appsscript-source';

const source = loadAppsScriptSource();

/** A cell counts as "empty" for last-row/last-column purposes. */
const isBlank = (v: any) => v === '' || v === null || v === undefined;

class FakeSheet {
  name: string;
  grid: any[][] = [];
  frozenRows = 0;
  hidden: number[] = [];

  constructor(name: string) {
    this.name = name;
  }

  getName() {
    return this.name;
  }
  getMaxRows() {
    return 1000;
  }

  getLastRow() {
    for (let r = this.grid.length - 1; r >= 0; r--) {
      const row = this.grid[r] || [];
      if (row.some((c) => !isBlank(c))) return r + 1;
    }
    return 0;
  }

  getLastColumn() {
    let max = 0;
    for (const row of this.grid) {
      if (!row) continue;
      for (let c = row.length - 1; c >= 0; c--) {
        if (!isBlank(row[c])) {
          if (c + 1 > max) max = c + 1;
          break;
        }
      }
    }
    return max;
  }

  getRange(row: number, col: number, numRows = 1, numCols = 1) {
    const sheet = this;
    const api = {
      getValues() {
        const out: any[][] = [];
        for (let r = 0; r < numRows; r++) {
          const src = sheet.grid[row - 1 + r] || [];
          const line: any[] = [];
          for (let c = 0; c < numCols; c++) {
            const v = src[col - 1 + c];
            line.push(v === undefined ? '' : v);
          }
          out.push(line);
        }
        return out;
      },
      setValues(values: any[][]) {
        for (let r = 0; r < values.length; r++) {
          const target = row - 1 + r;
          if (!sheet.grid[target]) sheet.grid[target] = [];
          for (let c = 0; c < values[r].length; c++) {
            sheet.grid[target][col - 1 + c] = values[r][c];
          }
        }
        return api;
      },
      setValue(value: any) {
        const target = row - 1;
        if (!sheet.grid[target]) sheet.grid[target] = [];
        sheet.grid[target][col - 1] = value;
        return api;
      },
    };
    // Every cosmetic setter just returns the range so calls can be chained.
    for (const noop of [
      'setNumberFormat',
      'setFontWeight',
      'setFontColor',
      'setBackground',
      'setVerticalAlignment',
      'setHorizontalAlignment',
      'setWrap',
      'setFontSize',
    ]) {
      (api as any)[noop] = () => api;
    }
    return api;
  }

  appendRow(row: any[]) {
    const target = this.getLastRow();
    this.grid[target] = row.slice();
  }
  deleteRow(rowNumber: number) {
    this.grid.splice(rowNumber - 1, 1);
  }
  deleteRows(start: number, count: number) {
    this.grid.splice(start - 1, count);
  }
  hideColumns() {}
  setRowHeight() {}
  setColumnWidth() {}
  clear() {
    this.grid = [];
  }
  getFrozenRows() {
    return this.frozenRows;
  }
  setFrozenRows(n: number) {
    this.frozenRows = n;
  }
}

class FakeSpreadsheet {
  id: string;
  private sheets: FakeSheet[] = [];

  constructor(id: string) {
    this.id = id;
  }

  getId() {
    return this.id;
  }
  getUrl() {
    return `https://docs.google.com/spreadsheets/d/${this.id}`;
  }
  getSheetByName(name: string) {
    return this.sheets.find((s) => s.name === name) || null;
  }
  insertSheet(name: string) {
    const sheet = new FakeSheet(name);
    this.sheets.push(sheet);
    return sheet;
  }
  deleteSheet(sheet: FakeSheet) {
    this.sheets = this.sheets.filter((s) => s !== sheet);
  }
  getSheets() {
    return this.sheets.slice();
  }
}

function createSandbox() {
  const properties: Record<string, string> = {};
  const spreadsheets = new Map<string, FakeSpreadsheet>();
  let uuidCounter = 0;

  const sandbox: any = {
    Logger: { log: () => {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => (k in properties ? properties[k] : null),
        setProperty: (k: string, v: string) => {
          properties[k] = String(v);
        },
        deleteProperty: (k: string) => {
          delete properties[k];
        },
      }),
    },
    Session: { getScriptTimeZone: () => 'America/Indiana/Indianapolis' },
    Utilities: {
      // Distinct every call so salts differ between accounts.
      getUuid: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
      formatDate: () => '2026-09-27',
      computeHmacSha256Signature: (value: unknown, key: unknown) => {
        const message =
          typeof value === 'string'
            ? Buffer.from(value, 'utf8')
            : Buffer.from((value as number[]).map((b) => (b < 0 ? b + 256 : b)));
        const digest = createHmac('sha256', Buffer.from(String(key), 'utf8')).update(message).digest();
        return Array.from(digest).map((b) => (b > 127 ? b - 256 : b));
      },
    },
    SpreadsheetApp: {
      create: (title: string) => {
        const book = new FakeSpreadsheet(`sheet-${spreadsheets.size + 1}`);
        (book as any).title = title;
        book.insertSheet('Sheet1');
        spreadsheets.set(book.getId(), book);
        return book;
      },
      openById: (id: string) => {
        const book = spreadsheets.get(id);
        if (!book) throw new Error(`No spreadsheet with id ${id}`);
        return book;
      },
    },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }) },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
    },
    UrlFetchApp: {},
    ContentService: {},
    console,
    __properties: properties,
    __spreadsheets: spreadsheets,
  };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'Code.gs' });
  return sandbox;
}

const sandbox = createSandbox();
const call = <T = any>(fn: string, ...args: any[]): T => {
  const f = sandbox[fn];
  if (typeof f !== 'function') throw new Error(`Code.gs does not define ${fn}()`);
  return f(...args) as T;
};

/** Runs fn and returns the app error code it threw, or null when it succeeded. */
function errorCodeOf(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (err: any) {
    return err?.appCode || `threw:${err?.message}`;
  }
}

const usersSheet = () => call('usersSheet_');
const usersRowCount = () => {
  const sheet = usersSheet();
  const last = sheet.getLastRow();
  return last < 2 ? 0 : last - 1;
};
const usersColumn = (header: string): any[] => {
  const sheet = usersSheet();
  const headers: string[] = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = headers.indexOf(header) + 1;
  if (col === 0) throw new Error(`No ${header} column`);
  const rows = usersRowCount();
  if (rows === 0) return [];
  return sheet.getRange(2, col, rows, 1).getValues().map((r: any[]) => r[0]);
};

let failures = 0;
let checks = 0;
function check(name: string, condition: boolean, detail = '') {
  checks++;
  if (condition) {
    console.log(`  OK    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? `  -> ${detail}` : ''}`);
  }
}

const CODE = 'invite-code-for-testing-1234';

console.log('\n1. Provisioning the database');
call('setupDatabase');
check('Users sheet exists', !!usersSheet());
check('Users sheet starts empty', usersRowCount() === 0, String(usersRowCount()));

console.log('\n2. Registration is OPEN by default - anybody with the URL can sign up');
const infoOpen = call('api_registrationInfo_');
check('enabled with no configuration at all', infoOpen.enabled === true);
check('mode is open', infoOpen.mode === 'open', String(infoOpen.mode));
check('no invite code is required', infoOpen.requiresInviteCode === false);

const walkUp = call('api_register_', {
  email: 'walkup@example.com',
  name: 'Walk Up',
  password: 'password123',
});
check('an account is created with no invite code', !!walkUp.token);
check('open sign-up still yields editor, never admin', walkUp.user.role === 'editor', walkUp.user.role);
check('the account reached the sheet', usersRowCount() === 1, String(usersRowCount()));

console.log('\n3. Switching to invite mode');
check(
  'a short invite code is rejected',
  errorCodeOf(() => call('setRegistrationCode', 'short')) === 'weak_registration_code'
);
check('mode survives the rejection', call('registrationMode_') === 'open', call('registrationMode_').toString());
check(
  'invite mode without a code is refused',
  errorCodeOf(() => call('setRegistrationMode', 'invite')) === 'invite_code_required'
);

call('setRegistrationCode', CODE);
check('mode is now invite', call('registrationMode_') === 'invite', call('registrationMode_').toString());
check('sign-up now requires a code', call('registrationRequiresCode_') === true);

const infoEnabled = call('api_registrationInfo_');
check('probe reports enabled', infoEnabled.enabled === true);
check('probe reports editor as the default role', infoEnabled.defaultRole === 'editor');
check('probe reports minPasswordLength 8', infoEnabled.minPasswordLength === 8);
check(
  'probe never leaks the invite code',
  JSON.stringify(infoEnabled).indexOf(CODE) === -1,
  JSON.stringify(infoEnabled)
);

console.log('\n4. Invite code is checked before the Users sheet is touched');
const rowsBeforeBadCode = usersRowCount();
check(
  'wrong invite code rejected',
  errorCodeOf(() =>
    call('api_register_', { email: 'a@example.com', name: 'A', password: 'password123', inviteCode: 'wrong-code-here' })
  ) === 'invalid_invite_code'
);
check('missing invite code rejected', errorCodeOf(() =>
  call('api_register_', { email: 'a@example.com', name: 'A', password: 'password123' })
) === 'invalid_invite_code');
check('no account was created by the bad attempts', usersRowCount() === rowsBeforeBadCode, String(usersRowCount()));
check('bad address rejected', errorCodeOf(() =>
  call('api_register_', { email: 'not-an-email', name: 'A', password: 'password123', inviteCode: CODE })
) === 'invalid_email');

console.log('\n5. Password policy');
check('short password rejected', errorCodeOf(() =>
  call('api_register_', { email: 'a@example.com', name: 'A', password: 'short', inviteCode: CODE })
) === 'weak_password');
check('still no extra account', usersRowCount() === rowsBeforeBadCode, String(usersRowCount()));
check(
  'open mode enforces the same password minimum',
  errorCodeOf(() => {
    call('setRegistrationMode', 'open');
    call('api_register_', { email: 'shorty@example.com', name: 'S', password: 'abc' });
  }) === 'weak_password'
);
call('setRegistrationCode', CODE);

console.log('\n6. Successful self-registration with an invite code');
const rowsBeforeValid = usersRowCount();
const registered = call('api_register_', {
  email: '  NEW.User@Example.COM  ',
  name: 'New User',
  password: 'password123',
  inviteCode: CODE,
});
check('returns a token', typeof registered.token === 'string' && registered.token.length > 0);
check('email is normalised to lower case', registered.user.email === 'new.user@example.com', registered.user.email);
check('name is preserved', registered.user.name === 'New User');
check('role is editor, never admin', registered.role === 'editor', registered.role);
check('exactly one account was added', usersRowCount() === rowsBeforeValid + 1, String(usersRowCount()));

const newUserRow = usersColumn('Email').indexOf('new.user@example.com');
const storedHash = String(usersColumn('PasswordHash')[newUserRow]);
check('password hash is 64 hex chars', /^[0-9a-f]{64}$/.test(storedHash), storedHash);
check('hash is not the password', storedHash !== 'password123');
check('hash does not contain the password', storedHash.indexOf('password123') === -1);
check(
  'test helper confirms it is not plain text',
  call('storedHashIsNotPlainText_', 'new.user@example.com', 'password123') === true
);
check('role cell says editor', String(usersColumn('Role')[newUserRow]) === 'editor');
check(
  'account is active',
  usersColumn('Active')[newUserRow] === true || usersColumn('Active')[newUserRow] === 'TRUE'
);

console.log('\n7. The new session actually authorises requests');
const authorized = call('authorize_', { sessionToken: registered.token });
check('token authorises', authorized.email === 'new.user@example.com');
check('authorisation method is session', authorized.method === 'session');

console.log('\n8. Duplicate email');
const rowsBeforeDuplicate = usersRowCount();
check('duplicate rejected', errorCodeOf(() =>
  call('api_register_', { email: 'new.user@example.com', name: 'Impostor', password: 'password123', inviteCode: CODE })
) === 'email_in_use');
check('no duplicate row created', usersRowCount() === rowsBeforeDuplicate, String(usersRowCount()));

console.log('\n9. Self-service can never mint an administrator');
call('setRegistrationCode', CODE, '', 'admin');
check('role is clamped away from admin', call('selfRegistrationRole_') === 'editor');
const second = call('api_register_', {
  email: 'second@example.com',
  name: 'Second',
  password: 'password123',
  inviteCode: CODE,
});
check('second account is editor', second.user.role === 'editor', second.user.role);
check('no admin exists in the sheet', usersColumn('Role').indexOf('admin') === -1);

console.log('\n10. Domain allow-list');
call('setRegistrationCode', CODE, 'haysandsons.com');
const infoDomains = call('api_registrationInfo_');
check('allowedDomains reported', JSON.stringify(infoDomains.allowedDomains) === '["haysandsons.com"]');
check('outside domain rejected', errorCodeOf(() =>
  call('api_register_', { email: 'x@gmail.com', name: 'X', password: 'password123', inviteCode: CODE })
) === 'forbidden');
check('lookalike domain rejected', errorCodeOf(() =>
  call('api_register_', { email: 'x@not-haysandsons.com', name: 'X', password: 'password123', inviteCode: CODE })
) === 'forbidden');
check('approved domain accepted', !!call('api_register_', {
  email: 'ok@haysandsons.com',
  name: 'OK',
  password: 'password123',
  inviteCode: CODE,
}).token);

console.log('\n11. Closing registration again');
call('setRegistrationCode', '');
check('disabled', call('registrationEnabled_') === false);
check('register refuses again', errorCodeOf(() =>
  call('api_register_', { email: 'later@example.com', name: 'L', password: 'password123', inviteCode: CODE })
) === 'registration_disabled');
check('old invite code no longer works', errorCodeOf(() =>
  call('api_register_', { email: 'later@example.com', name: 'L', password: 'password123', inviteCode: CODE })
) === 'registration_disabled');

console.log('\n12. Registered users can sign in through the normal login');
const login = call('api_login_', { email: 'new.user@example.com', password: 'password123' });
check('login issues a token', !!login.token);
check('login returns the account', login.user.email === 'new.user@example.com');
check('login returns editor role', login.user.role === 'editor');
check('wrong password still fails', errorCodeOf(() =>
  call('api_login_', { email: 'new.user@example.com', password: 'totally-wrong-here' })
) === 'invalid_credentials');

console.log('\n13. Routing: register is reachable without a session, jobs are not');
call('setRegistrationCode', CODE);
const routed = call('dispatch_', {
  action: 'register',
  email: 'routed@example.com',
  name: 'Routed',
  password: 'password123',
  inviteCode: CODE,
});
check('dispatch routes register without auth', routed.ok === true, JSON.stringify(routed).slice(0, 160));
check('dispatch returns a session token', !!routed.data.token);

const routedInfo = call('dispatch_', { action: 'registrationInfo' });
check('dispatch routes registrationInfo', routedInfo.ok === true && routedInfo.data.enabled === true);

const routedJobs = call('dispatch_', { action: 'listJobs' });
check('listJobs is still protected', routedJobs.ok === false && routedJobs.code === 'unauthenticated', JSON.stringify(routedJobs));

const routedBad = call('dispatch_', { action: 'register', email: 'nope@example.com', name: 'N', password: 'password123', inviteCode: 'wrong' });
check('bad invite code surfaces as a clean envelope', routedBad.ok === false && routedBad.code === 'invalid_invite_code');

console.log('\n14. No-argument helpers (usable from the Apps Script Run button)');
call('disableRegistration');
check('disableRegistration closes sign-up', call('registrationEnabled_') === false);
check(
  'refusals are reported as registration_disabled',
  errorCodeOf(() =>
    call('api_register_', { email: 'closed@example.com', name: 'C', password: 'password123' })
  ) === 'registration_disabled'
);

call('enableRegistration');
check('enableRegistration reopens sign-up', call('registrationEnabled_') === true);
check('reopened in open mode', call('registrationMode_') === 'open', call('registrationMode_').toString());
check('no invite code is required', call('registrationRequiresCode_') === false);

const reopened = call('api_register_', {
  email: 'reopened@example.com',
  name: 'Reopened',
  password: 'password123',
});
check('an account can be created with no code', !!reopened.token);
check('the reopened account is editor', reopened.user.role === 'editor', reopened.user.role);

const generated = call('generateInviteCode_');
check('generated code clears the minimum length', generated.length >= 12, generated);
check('generated code contains no whitespace', /\s/.test(generated) === false, generated);

const inviteState = call('useInviteCode');
check('useInviteCode switches to invite mode', inviteState.mode === 'invite', String(inviteState.mode));
check('useInviteCode returns the code it stored', inviteState.inviteCode === call('registrationCode_'));
check(
  'open sign-up no longer works',
  errorCodeOf(() =>
    call('api_register_', { email: 'nocode@example.com', name: 'N', password: 'password123' })
  ) === 'invalid_invite_code'
);
check(
  'the generated code works',
  !!call('api_register_', {
    email: 'withcode@example.com',
    name: 'W',
    password: 'password123',
    inviteCode: inviteState.inviteCode,
  }).token
);

const rotated = call('useInviteCode').inviteCode;
check('running it again rotates the code', rotated !== inviteState.inviteCode);
check(
  'the superseded code stops working',
  errorCodeOf(() =>
    call('api_register_', {
      email: 'stale@example.com',
      name: 'S',
      password: 'password123',
      inviteCode: inviteState.inviteCode,
    })
  ) === 'invalid_invite_code'
);

call('disableRegistration');
check('disableRegistration closes it again', call('registrationEnabled_') === false);

console.log('\n15. Explicit mode control');
check(
  'an unknown mode is rejected',
  errorCodeOf(() => call('setRegistrationMode', 'banana')) === 'invalid_mode'
);
check('open is accepted', call('setRegistrationMode', 'open').mode === 'open');
check('off is accepted', call('setRegistrationMode', 'off').mode === 'off');
check(
  'invite without a code is refused',
  errorCodeOf(() => {
    call('setRegistrationCode', '');
    call('setRegistrationMode', 'invite');
  }) === 'invite_code_required'
);
check('the README tab can describe the policy', typeof call('describeRegistrationMode_') === 'string');

console.log(
  `\n${failures === 0 ? 'All registration checks passed.' : `${failures} of ${checks} registration checks FAILED.`}`
);
process.exit(failures === 0 ? 0 : 1);
