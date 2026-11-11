# Google Sheets + Apps Script setup

The app stores every change-order draft as a row in a Google Sheet and keeps
the uploaded source PDFs in a Google Drive folder. The frontend talks to a
deployed Apps Script web app.

## 1. Create the spreadsheet

1. Go to <https://sheets.google.com> and create a new blank spreadsheet named
   **Hays Change Orders**.
2. Optionally rename the first sheet. The script creates the **Requests** and
   **Jobs** sheets automatically on first use, so the default sheet can stay.

## 2. Paste the script

1. In the spreadsheet, open **Extensions → Apps Script**.
2. Delete the placeholder `Code.gs` content and paste the entire contents of
   `apps-script/Code.gs`.
3. The script must be a **container-bound** script (created from inside the
   spreadsheet). Do not paste it into a standalone project, because
   `SpreadsheetApp.getActiveSpreadsheet()` only works when bound to the sheet.

The `appsscript.json` manifest (`apps-script/appsscript.json`) is provided for
reference. In the Apps Script editor you can confirm the runtime by going to
**Project Settings** and checking that it runs under V8. The web-app settings
(execute as the deploying user, access: Anyone) are set during deployment in
step 4.

## 3. Run the one-time setup

1. In the Apps Script editor, select the `setup` function from the toolbar
   dropdown and click **Run** — or reload the spreadsheet and use the
   **Change Orders → Run one-time setup** menu.
2. Accept the OAuth consent for **Google Sheets** and **Google Drive** when
   prompted.
3. `setup()` creates the **Requests** sheet (request queue), the **Jobs**
   sheet (job directory), and the **hays-change-orders** Drive folder. It
   shows a dialog with the deploy instructions.

Re-running `setup()` is safe: it reuses the existing sheets and folder. If the
spreadsheet already has a **Jobs** sheet from an earlier version, `setup()`
adds the new `contractAmount` header automatically — no manual column insert is
needed (see the Job directory note below).

> No API key is needed. Deploy the web app with access "Anyone" and keep the
> Web app URL private. For real authentication, add Google Sign-In later.

## 4. Deploy as a web app

1. In the Apps Script editor, click **Deploy → New deployment**.
2. Choose type **Web app**.
3. Description: `Hays change orders`.
4. **Execute as:** `Me (your account)`.
5. **Who has access:** `Anyone`.
6. Click **Deploy**, authorize if prompted, and copy the **Web app URL**. It
   looks like `https://script.google.com/macros/s/<id>/exec`.

Whenever you edit `Code.gs` later, create a **new deployment** (or edit the
existing one and point it to the new version) for production users to see the
change.

## 5. Point the app at it

Create `c:\Users\russe\hays-change-orders\.env.local` with:

```ini
VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/<id>/exec
```

Then restart `npm run dev` (Vite reads `.env.local` at startup).

## 6. Verify

1. Open <http://127.0.0.1:3010>, create a request, and upload a small PDF.
2. In the spreadsheet, a **Requests** sheet should appear with one queue row
   (the full request JSON lives in a per-request Drive folder).
3. In Google Drive, a folder named **hays-change-orders** should contain the
   uploaded PDF and a `request-<id>` folder with revision snapshots.
4. Open the app in a second browser/device: the request should appear in the
   queue, and attachments should load from Drive.

## Notes

### Rollout: editable requests and summary PDFs

The request JSON also stores optional `requestType` (`change_order` or
`insurance_supplement`) and boolean `customerCredits` answers. No sheet-column
changes are required. **Copy Dash note** runs locally and does not submit a
request or write anything into Dash.

Deploy the updated `apps-script/Code.gs` **before** deploying the frontend.
Update the existing web-app deployment to the new script version so the URL
stays the same. The backend permits edits and new attachments while a request
is queued, in review, or awaiting information; completed requests stay locked.
Revision checks, retry identifiers, and attachment ownership checks still apply.

Customer phone and email are optional fields in the version-2 request JSON;
no new sheet columns or migration are needed. New submissions snapshot contact
details from the selected directory job. Older requests remain readable and
can have missing contact details filled in using **Edit request**. Removing an
attachment unlinks it without deleting its Drive file.

Summary PDFs are generated in the browser from the saved request and are not
uploaded to Drive. Total contract price includes previous authorized changes.
After deployment, verify an edit, a photo/PDF addition, individual attachment
downloads, and **Download summary PDF**. Confirm a completed request cannot
be edited. Keep the backend update in place if rolling back the frontend.

- **Requests (V2)**: the **Requests** sheet holds searchable queue metadata
  (status, estimator, job, counts). The full request JSON is stored as
  immutable revision files in a request-owned Drive folder, so a save or claim
  cannot be overwritten by a competing window. Attachments are staged in the
  request folder and only linked once a save references them.
- **Upload size**: the client caps uploads at 15 MB. Apps Script web-app POST
  bodies are limited, and files travel as base64 (~1.33× their size).
- **Job directory**: the **Jobs** page (`#/jobs`) loads the directory from
  the Dash **JobSummaryReport** export — choose the CSV or paste it, preview
  the parsed rows and warnings, then **Import** (`POST {action:"importJobs"}`).
  An import **replaces the whole directory**, so upload the latest complete
  report. The sheet can still be hand-edited in Google Sheets for one-off
  fixes (`GET ?action=listJobs`). Project managers pick a job in the quick
  request form to autofill the job number, customer, property address, and
  responsible project manager, plus the customer's **original contract
  amount** when the directory carries one.
  That amount comes from the export's **`Estimate Amount`** column (the parser
  also accepts `Total Estimate Amount`, `Contract Amount`, `Original Contract
  Amount`, `Original Contract`, `Contract Price`, `Contract Total`, `Total
  Contract Amount`, and `Est. Amount` — a last-resort abbreviation — as
  fallbacks) and pre-fills the estimator's "Original
  contract amount" field, which stays editable. The sheet's columns are `id,
  jobNumber, customer, address, projectManager, estimator, status,
  customerPhone, customerEmail, active, updatedAt, contractAmount` —
  `contractAmount` is appended **last** so a spreadsheet created before the
  column existed keeps every existing column aligned.
- **Jobs sheet self-heals (no manual column insert)**: on the **first**
  `listJobs` / `importJobs` / `setup` call after a deployment, `jobsSheet_()`
  fills in only the empty header cells, so an already-deployed 11-column Jobs
  sheet gains its `contractAmount` header at column 12 by itself. It never
  inserts, clears, renames, or reorders existing columns or job rows, and does
  nothing once the header row is complete — a `JOBS_HEADERS_VERSION` script
  property records the verified header version, so this check runs once per
  deployment rather than on every list/bootstrap call. Deploy the updated
  `Code.gs` (step 4: **Deploy → New deployment**) for the deployed web app to
  know about the new column; the spreadsheet itself needs no edits.
- **Limits**: list/open return JSON; the sheet stores summaries rather than
  full documents.
- **Revisions**: saves and status changes carry an expected revision and a
  retry identifier, so a stale tab cannot overwrite a newer edit.
- **Customer documents**: optional `lineNumbers`, `finalChangeOrder` (scope and
  signed amount), and `customerDocument` (attachment ID, input fingerprint,
  template version) are stored in the existing version-2 request snapshot.
  **Prepare change order** opens the original form with editable PDF fields.
  **Save changes** stores draft values; **Generate & save PDF** validates the
  final data, uploads the unsigned customer PDF, and links it to the request.
  No sheet columns or data migration are needed. Deploy the updated Apps Script
  validation **before** the frontend build, updating the existing deployment so
  the API URL stays the same. The backend verifies PDF ownership and the SHA-256
  fingerprint of printed inputs. Editing those inputs unlinks the stale PDF;
  regenerating replaces the active document while leaving older files in Drive.
  Do not trash those files: earlier revision snapshots may reference them.
  Existing email actions include the current PDF among the saved attachments;
  generation itself does not email anything or create a signed document.
  Completed requests can download their stored PDF but cannot edit it. Older
  completed requests without a customer PDF remain readable without inventing
  a document. On rollout, verify generation, reopening, a price correction,
  regeneration, and download after completion. Keep the compatible backend in
  place if rolling back the frontend.
- **Local tests** expect the default local API path (`/__api__`) and are mocked
  in Playwright. Do not point `.env.local` at the real URL while running the
  browser tests.
