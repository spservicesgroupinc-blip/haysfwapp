# Customer job workspace

Each saved job opens a staff dashboard keyed by its immutable `recordId`. Tasks,
issues, comments, change orders and reviewed contract settings are separate from
the document JSON, so saving a form cannot overwrite another staff member's task.

## Staff workflow

- Open a job for its overview, open issues, assignments, overdue work and activity.
- Use Tasks & Issues for assignees, dates, priorities, comments and change links.
- Review the original contract and approved opening adjustment before approving
  orders. Current total includes approved orders only; pending exposure is separate.
- Import legacy orders as drafts for review. Exclude imported amounts from the
  opening adjustment to avoid counting them twice. Legacy recorded PDFs remain available.
- Approvals freeze the financial snapshot. Void with a reason and create a
  replacement for corrections. Financial decisions require connectivity, a clear
  local queue and an unchanged contract position.
- Choose the ledger order used by Documents and the combined packet. Ledger
  selection does not change insurance RCV or the legacy job form.

Editors and administrators can make changes; viewers can read. Assignees are active
registered staff. Customer access, attachments and outbound notifications are outside
this version. The My Tasks filter applies to the open job.

## Persistence and interfaces

Authenticated CORS-simple POST actions:

| Action | Input | Result |
| --- | --- | --- |
| `getJobWorkspace` | `recordId`, `page`, `pageSize` (up to 100) | Latest entities, activity, totals for paging, fetch time |
| `listAssignableStaff` | Session | Active names/emails only; user administration stays admin-only |
| `mutateJobWorkspace` | Stable `operationId`, `recordId`, entity `kind`/`id`, `expectedRevision`, `data`; `financialRevision` for financial decisions | Acknowledged entity revision |

Sheets `WorkItems`, `WorkComments`, `ChangeOrders` and `ContractSettings` are created
on first use. Each accepted revision appends the entity, operation receipt and
activity together under the existing script lock. Replaying the same operation
returns its acknowledgement; changed payloads and stale revisions are rejected.
Activity also includes saved job edits, identifying affected sections.

IndexedDB version 2 adds account-scoped dashboard snapshots. Pending work uses
the existing account-owned outbox and is overlaid on confirmed data. Financial
decisions affect totals only after acknowledgement. Conflicts retain both versions
for explicit reconciliation; financial decisions must be reviewed again.

The bundled Jobs & Documents app has separate workspace storage. A stale database
handle or transient `UnknownError` gets one connection retry without clearing data.
Persistent failures explain device-storage recovery instead of suggesting that
the network alone failed.

## Release and verification

Deploy the complete `src/apps-script/Code.gs` as a new version of the deployment
configured in `src/config/appsScript.ts`, preserving its existing Script Properties
and manifest. Health should report `2026-11-12-workspace-1` and `jobWorkspace`.
Regenerate paste files with `npm run apps:paste` and `npm run apps:chunks`.
Release the frontend after the backend; an older backend produces a deployment
message while existing document forms remain usable. A Git push does not publish
an Apps Script version.

Checks: `npm run workspace:test`, `npm run database:test`, `npm run customers:test`,
`npm run changes:test`, `npm run apps:test:drafts`, `npm run pdf:checklist:test`,
`npm run save:ui:test`, `npm run lint`, and `npm run build`. The README documents
the two pre-existing legacy backend harness failures separately.
