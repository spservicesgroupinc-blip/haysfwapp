# Hays + Sons Change Orders

A browser-based app for project managers to submit change requests and for estimators to prepare customer change-order PDFs. The reference application remains in `C:\Users\russe\haysdocuments-2`.

## Run

```powershell
cd C:\Users\russe\hays-change-orders
npm install
npm run dev
```

Open http://127.0.0.1:3010. `npm run build` creates the production site in `dist`; `npm run preview` serves that build on the same port. Requests are stored in Google Sheets and source PDFs in Google Drive through an Apps Script backend — see `docs/google-sheets-setup.md` for the one-time setup.

## Use

Choose **Change order** or **Insurance supplement** in the request details,
and check **Yes, customer credits** when applicable. **Copy Dash note** above
the submission button copies the answers, customer/job details, contract
amounts, written scope, and attachment names for pasting into Dash. Estimators
have the same button on the review screen; save corrections before copying.
If clipboard access is blocked, the app provides selectable note text.
Older requests show unanswered questions as **Not provided** until edited.

Estimators set the estimate line references and the final change amount in
**Finalize customer document**, choosing **Add / Remove** per line and
**Increase / Credit** for the signed amount. The project manager's quick
request accepts an optional **Known change amount**. Choose **Plus** for an
increase or **Minus** for a deduction. The signed amount is saved with the
request and included in request emails, Dash notes, and estimator review.
The estimator still sets the final customer price.
Signed answers appear in Dash notes and PDFs.

1. **Project managers** describe what changed. Create a request, enter the job and property details, add one card per room/work area (add, revise, or remove work; what and why), attach photos, estimate PDFs, or subcontractor quotes, and submit to estimating. After validation, the app immediately returns home while saving the request, uploading attachments, and sending any optional email. A popup confirms completion on whichever screen is open and the shared queue refreshes. Failed submissions offer **Retry submission**, retaining the same request and upload identities. Keep the app open until completion; pending work is held in memory and does not survive a reload or closing the app.
2. **Estimators** open requests from the shared queue, review the submitted text, and preview or download each attached photo or PDF. Use **Download summary PDF** for the internal job summary. In **Customer change order**, choose **Prepare change order** to open the original Hays + Sons form. Customer/job details, the original contract, submitted scope, and contractor representative fill automatically; saved estimator corrections take precedence. Click a field on the PDF or use **Fields** to edit. Enter one increase or credit amount; prior and revised contract totals recalculate using exact cents. Unknown final prices stay blank until the estimator supplies them. **Save changes** stores an incomplete draft; **Generate & save PDF** validates the fields and stores the finished unsigned PDF in the request's Drive folder. Long scopes continue onto additional pages. **View saved PDF** and **Download saved PDF** use the exact stored document. Printed-data corrections invalidate the old PDF until it is regenerated, without deleting historical Drive files. Mark the request complete when finished; completed requests retain viewing/downloading but are read-only. Downloaded documents are finished PDFs; editing happens inside the app.
3. **Admins** import each customer's contract amount with the job list: the Dash JobSummaryReport CSV (or an export with a contract-amount column) becomes the searchable job directory on the Jobs page. Picking a job in the request form fills in the job number, customer, property address, responsible project manager, and the customer's original contract amount, so nobody retypes the contract amount on the change order. Estimators can still override any of it.
4. Use **Edit request** while a request is queued, in review, or awaiting information. Correct customer/job details, original contract amount, previous authorized changes, and descriptions/reasons; add photos/PDFs or remove attachments. **Save changes** preserves status, assignment, and the submission date. **Cancel** discards local edits after a warning. Failed saves retain edits; use **Retry save** for an uncertain response, or **Reload latest request** when another window saved newer work.
5. The summary PDF shows **Total contract price = original contract + previous authorized changes**, excluding the unpriced request. Blank previous changes count as zero. Missing or invalid contract amounts print as **Not provided** or **Unavailable**, never an invented $0.00 total. Downloads use saved data, so save edits first. Completed requests remain read-only, with summary and individual attachment downloads available.

Legacy change orders from the previous four-step editor remain in a separate section: open them to finish, or convert one into a shared request (its PDFs are copied and prior pricing carried forward for estimator review).

Printed RCV remains the original baseline. A revision adds the change in rounded quantity × unit price and the changes in estimator-reviewed tax/O&P dollars to that baseline. A removal credits full original RCV. Money uses decimal-string arithmetic with integer cents and half-away-from-zero rounding. Depreciation, ACV, and recap amounts do not become line items.

Requests sync automatically to Google Sheets, and uploaded PDFs are stored in Google Drive, so the team sees the same queue across devices. Each save carries an expected revision and retry identifier, so a stale tab cannot overwrite a newer edit. Storage failures are shown and prevent leaving unsaved work through the app. Keep downloaded copies of completed documents.

The parser supports positioned Final Draft tables, wrapped descriptions, repeated headers, and explicit RCV columns. It also reads right-aligned RESET / REMOVE / REPLACE / TAX / O&P / TOTAL reports, combining the printed per-unit prices into the editable unit price while keeping the printed TOTAL as the original RCV. Source price components stay available during review. Existing negative credit lines are preserved and can be revised or removed. Room sketches, trade headings, page footers, recap totals, depreciation, and ACV do not become priced work. PDFs vary; review extracted fields against the source before generation. Scanned PDFs and unsupported reports use manual entry. The app does not infer pricing-list rates, tax applicability, or O&P rules. A later change order must use the appropriate current estimate baseline; previously exported packets do not automatically update the baseline or previous authorized changes.

## Customers (CRM)

The **Customers** tab (`#/customers`) is a lightweight CRM built on a dedicated
customer record, separate from the replaceable jobs directory:

- Searchable customer directory with job count and open-task count.
- Customer detail (`#/customers/:id`) with linked jobs (and their lifecycle
  stage), an activity timeline, and follow-up tasks.
- **Activity timeline** — notes plus logged calls, emails, texts, and meetings.
- **Follow-up tasks** — due date, assignee, done toggle, overdue highlighting.
- **Job lifecycle stages** — Lead → In progress → Complete → Closed.
- **Merge** — fold one customer into another; activities and tasks move with it.

CRM data is stored locally first (IndexedDB `hays-crm-v1`) and synced to the
Apps Script backend. The backend adds three Sheets tabs (`Customers`,
`CustomerActivities`, `Tasks`) and these actions: `listCustomers`,
`openCustomer`, `saveCustomer`, `mergeCustomers`, `listActivities`,
`addActivity`, `listTasks`, `saveTask`. Workspace saves also accept `stage` and
`customerId`.

> Deploy the updated `apps-script/Code.gs` (run `setup()` once) before CRM data
> can sync across devices. Until then the app keeps changes on the device.

## Verification

```powershell
npm run typecheck
npm test
npm run fixtures
npm run test:browser
npm run build
```

The fixtures are anonymous Xactimate-style reports, including split pricing, resets, credit lines, and room sketches. `tmp/` holds generated short/long packets and browser screenshots for QA. Browser tests require Playwright Chromium (`npx playwright install chromium` if absent). The supplied 29-page estimate was verified to extract all 296 source line items, matching the printed tax, O&P, room totals, and $167,045.81 RCV. To repeat the optional real-estimate browser regression, set `HAYS_ESTIMATE_SAMPLE` to that PDF's absolute path before running `npm run test:browser`; customer PDFs are not checked into the repository.
