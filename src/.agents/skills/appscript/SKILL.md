---
name: appscript
description: Describe what this skill does and when to use it. Include keywords that help agents identify relevant tasks.
---
# Skill: Google Apps Script (GAS) Backend & Auth Engine

## Purpose
Enables the AI agent to architect, generate, and connect full-stack web applications (React, Vue, Vanilla JS) to a Google Workspace backend utilizing Google Sheets as a relational database, Google Drive as blob storage, and Google Apps Script (GAS) as an authenticated REST API.

---

## 1. Non-Negotiable Operational Constraints

When generating client-side and server-side code for GAS backends, you MUST adhere to these rules:

1. **The CORS & Preflight Rule (`text/plain` only):**
   - Google Apps Script Web Apps DO NOT handle HTTP `OPTIONS` preflight requests properly.
   - Front-end fetch calls MUST NEVER send `Content-Type: application/json` or custom headers (e.g., `Authorization: Bearer ...`). This triggers an `OPTIONS` flight check that GAS fails.
   - Front-end MUST set `headers: { "Content-Type": "text/plain;charset=utf-8" }` and pass JSON strings in the body.
   - Always parse the body in GAS using `JSON.parse(e.postData.contents)`.
2. **The 302 Redirect Rule:**
   - GAS Web Apps always respond to web requests by issuing a 302 redirect to a temporary CDN hosting domain (`script.googleusercontent.com`).
   - Standard browser `fetch()` follows redirects automatically by default, but NEVER set `redirect: "manual"` or `mode: "no-cors"`. `no-cors` makes responses opaque, preventing JSON parsing.
3. **The Concurrency & Locking Rule:**
   - Google Sheets lacks row-level transactions. Concurrent writes corrupt row indices.
   - Mutating routes (Insert, Update, Delete, Register) MUST use `LockService.getScriptLock()` with a minimum timeout of 10,000ms–15,000ms.
   - Read routes (Select, Login) MUST NOT be locked, allowing high-throughput concurrent reads.
4. **The Deployment Configuration:**
   - Web App deployments MUST ALWAYS specify:
     - **Execute as:** `Me` (the owner/developer).
     - **Who has access:** `Anyone` (anonymous invocation via your app's frontend).

---

## 2. Standard Server Template (`Code.gs`)

Whenever the user requests a backend, generate this battle-tested router structure:

```javascript
/**
 * GAS Backend Router & API Engine
 * Store JWT_SECRET in: Project Settings > Script Properties
 */
const SCRIPT_PROP = PropertiesService.getScriptProperties();
const SECRET_KEY = SCRIPT_PROP.getProperty("JWT_SECRET") || "change-this-32-char-random-secret-key";

function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return jsonResponse({ success: false, error: "Empty request payload" });
  }

  try {
    const payload = JSON.parse(e.postData.contents);
    const { action, data, token } = payload;
    let result = {};

    // -------------------------
    // 1. PUBLIC ROUTES (No Lock)
    // -------------------------
    if (action === "auth_login") {
      return jsonResponse(AuthController.login(data));
    }

    // -------------------------
    // 2. PUBLIC ROUTES (Locked)
    // -------------------------
    if (action === "auth_register") {
      return withLock(() => AuthController.register(data));
    }

    // -------------------------
    // 3. AUTHENTICATION CHECK
    // -------------------------
    const authUser = AuthController.verify(token);
    if (!authUser) {
      return jsonResponse({ success: false, error: "Unauthorized: Invalid or expired session" });
    }

    // -------------------------
    // 4. PROTECTED ROUTES
    // -------------------------
    switch (action) {
      case "db_select":
        // Reads do not require locks
        result = DBController.select(data.sheetName, data.query, authUser);
        break;
      case "db_insert":
        result = withLock(() => DBController.insert(data.sheetName, data.record, authUser));
        break;
      case "db_update":
        result = withLock(() => DBController.update(data.sheetName, data.keyField, data.keyValue, data.updates, authUser));
        break;
      case "db_delete":
        result = withLock(() => DBController.delete(data.sheetName, data.keyField, data.keyValue, authUser));
        break;
      case "drive_upload":
        result = withLock(() => StorageController.upload(data, authUser));
        break;
      default:
        result = { success: false, error: `Unrecognized action: ${action}` };
    }

    return jsonResponse(result);

  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function withLock(callback) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000); // 15-second write lock
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

---

## 3. Cryptographic Authentication Subsystem

Agents must NEVER store plain passwords or roll insecure auth. Use this exact implementation for user verification and stateless session signing:

```javascript
const AuthController = {
  register: function({ email, password, role }) {
    if (!email || !password) return { success: false, error: "Email and password required" };
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("Users");
    if (!sheet) {
      sheet = ss.insertSheet("Users");
      sheet.appendRow(["user_id", "email", "salt", "password_hash", "role", "created_at"]);
    }

    const normalizedEmail = email.trim().toLowerCase();
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][1]).toLowerCase() === normalizedEmail) {
        return { success: false, error: "Account already exists" };
      }
    }

    const salt = Utilities.getUuid();
    const hash = this._hash(password, salt);
    const userId = "usr_" + Utilities.getUuid().slice(0, 8);
    sheet.appendRow([userId, normalizedEmail, salt, hash, role || "user", new Date().toISOString()]);

    const token = this._signToken({ userId, email: normalizedEmail, role: role || "user" });
    return { success: true, token, user: { userId, email: normalizedEmail, role: role || "user" } };
  },

  login: function({ email, password }) {
    if (!email || !password) return { success: false, error: "Missing credentials" };
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Users");
    if (!sheet) return { success: false, error: "Database uninitialized" };

    const rows = sheet.getDataRange().getValues();
    const normalizedEmail = email.trim().toLowerCase();

    for (let i = 1; i < rows.length; i++) {
      const [userId, rowEmail, salt, storedHash, role] = rows[i];
      if (String(rowEmail).toLowerCase() === normalizedEmail) {
        const computedHash = this._hash(password, salt);
        if (computedHash === storedHash) {
          const token = this._signToken({ userId, email: normalizedEmail, role });
          return { success: true, token, user: { userId, email: normalizedEmail, role } };
        }
        return { success: false, error: "Invalid credentials" };
      }
    }
    return { success: false, error: "Account not found" };
  },

  verify: function(token) {
    if (!token || typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signature] = parts;
    const dataToVerify = `${headerB64}.${payloadB64}`;
    const expectedSigBytes = Utilities.computeHmacSha256Signature(dataToVerify, SECRET_KEY);
    const expectedSig = Utilities.base64EncodeWebSafe(expectedSigBytes);

    if (signature !== expectedSig) return null;

    const payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(payloadB64)).getDataAsString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  },

  _hash: function(pwd, salt) {
    const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pwd + salt, Utilities.Charset.UTF_8);
    return raw.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
  },

  _signToken: function(payload) {
    const header = Utilities.base64EncodeWebSafe(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = Utilities.base64EncodeWebSafe(JSON.stringify({
      ...payload,
      exp: Math.floor(Date.now() / 1000) + (7 * 24 * 3600) // 7 days
    }));
    const data = `${header}.${body}`;
    const sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(data, SECRET_KEY));
    return `${data}.${sig}`;
  }
};
```

---

## 4. Generic Sheet-As-Database Controller (ORM Pattern)

Provide this generic CRUD controller to avoid hardcoding individual sheets. Note the use of batch operations (`setValues`) over slow loops (`setValue`).

```javascript
const DBController = {
  select: function(sheetName, query = {}, user) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) return { success: false, error: `Sheet ${sheetName} not found` };

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, records: [] };

    const headers = data[0];
    const records = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const record = {};
      headers.forEach((h, idx) => { record[h] = row[idx]; });

      // Match filters
      let match = true;
      for (const key of Object.keys(query)) {
        if (String(record[key]) !== String(query[key])) {
          match = false;
          break;
        }
      }
      if (match) records.push(record);
    }
    return { success: true, records };
  },

  insert: function(sheetName, record, user) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(Object.keys(record));
    }

    // Auto-generate ID if missing
    if (!record.id) record.id = Utilities.getUuid();

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const newRow = headers.map(header => record[header] !== undefined ? record[header] : "");
    sheet.appendRow(newRow);

    return { success: true, record };
  },

  update: function(sheetName, keyField, keyValue, updates, user) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) return { success: false, error: `Sheet ${sheetName} not found` };

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const keyIdx = headers.indexOf(keyField);
    if (keyIdx === -1) return { success: false, error: `Key field ${keyField} not found` };

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][keyIdx]) === String(keyValue)) {
        // Update row in memory
        for (const [colName, val] of Object.entries(updates)) {
          const colIdx = headers.indexOf(colName);
          if (colIdx !== -1) {
            data[i][colIdx] = val;
          }
        }
        // Write entire row back efficiently (avoids slow loop of setValues)
        sheet.getRange(i + 1, 1, 1, headers.length).setValues([data[i]]);
        return { success: true, updatedKey: keyValue };
      }
    }
    return { success: false, error: "Record not found" };
  },

  delete: function(sheetName, keyField, keyValue, user) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) return { success: false, error: `Sheet ${sheetName} not found` };

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const keyIdx = headers.indexOf(keyField);
    if (keyIdx === -1) return { success: false, error: `Key field ${keyField} not found` };

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][keyIdx]) === String(keyValue)) {
        sheet.deleteRow(i + 1); // Row indices are 1-based in GAS
        return { success: true, deletedKey: keyValue };
      }
    }
    return { success: false, error: "Record not found" };
  }
};
```

---

## 5. Client-Side Transport Wrapper (Frontend JS/React)

Generate this universal API client on the frontend to communicate with GAS:

```javascript
// gasClient.js
const GAS_ENDPOINT = import.meta.env.VITE_GAS_URL || "[https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec](https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec)";

export const gasApi = {
  async request(action, data = {}) {
    const token = localStorage.getItem("gas_auth_token") || null;
    
    // Critical: text/plain avoids CORS preflight
    const response = await fetch(GAS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, data, token })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    if (!result.success) {
      if (result.error && result.error.includes("Unauthorized")) {
        localStorage.removeItem("gas_auth_token");
        window.location.reload();
      }
      throw new Error(result.error);
    }
    return result;
  },

  // Auth Helpers
  async login(email, password) {
    const res = await this.request("auth_login", { email, password });
    localStorage.setItem("gas_auth_token", res.token);
    return res.user;
  },

  async register(email, password, role) {
    const res = await this.request("auth_register", { email, password, role });
    localStorage.setItem("gas_auth_token", res.token);
    return res.user;
  },

  logout() {
    localStorage.removeItem("gas_auth_token");
  },

  // DB Helpers
  query(sheetName, query = {}) {
    return this.request("db_select", { sheetName, query });
  },

  insert(sheetName, record) {
    return this.request("db_insert", { sheetName, record });
  },

  update(sheetName, keyField, keyValue, updates) {
    return this.request("db_update", { sheetName, keyField, keyValue, updates });
  },

  delete(sheetName, keyField, keyValue) {
    return this.request("db_delete", { sheetName, keyField, keyValue });
  }
};
```

---

### How to Deploy and Use This Skill

1. **In Cursor / Windsurf / Cline:**
   - Save the markdown above as `.cursorrules` or `.windsurfrules` in the root of your project directory, or add it to `.clinerules/gas-backend.md`.
2. **In Bolt.new / Replit / v0:**
   - Paste the markdown block at the very start of your prompt: *"Follow the `gas-backend-architect` specification below to build the backend and client data layer."*
3. **In Claude Projects / Custom GPTs:**
   - Add this entire file as an uploaded reference file or directly into the "Project Instructions" / "Custom Instructions".
<!-- Tip: Use /create-skill in chat to generate content with agent assistance -->

Define the functionality provided by this skill, including detailed instructions and examples