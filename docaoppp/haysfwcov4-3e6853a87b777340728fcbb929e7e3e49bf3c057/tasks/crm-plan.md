# CRM Features — Implementation Plan

Status: implemented (2026-10-22). Companion task list: `tasks/crm-todo.md`.
Pending: manual redeploy of `apps-script/Code.gs` to the live Apps Script web app.
The original `tasks/plan.md` / `tasks/todo.md` are intentionally left untouched.

## Scope (confirmed with user)

1. Customer directory + detail page (dedicated Customer entity, dedup/merge).
2. Activity timeline + notes history.
3. Follow-up tasks & reminders.
4. Communication log.
5. Job lifecycle stages (lead → in_progress → complete → closed).
6. Persist via the existing Google Apps Script backend (Sheets + Drive).

Not in scope this round: contact/referral-source directory, reporting/analytics, global
search, sales pipeline, calendar.

## Data model (see `src/crm/types.ts`)

- `Customer` — master record with optimistic `revision`.
- `CustomerSummary` — directory row (jobCount, openTaskCount derived server-side).
- `Activity` — unified timeline entry. Kinds: `note`, `call`, `email`, `sms`, `meeting`,
  `other`, plus system kinds `status_change`, `stage_change`, `request_submitted`,
  `email_sent`, `task_completed`. Direction: `inbound | outbound | system`.
- `Task` — follow-up with `dueDate` (YYYY-MM-DD), `assignee`, `status: open|done`.
- `JobStage` — added to `Workspace` (`stage`), plus `Workspace.customerId` for linking.

## Backend contract (Apps Script, all POST JSON with `Content-Type: text/plain`)

Responses follow the existing envelope (`{ ok: true, ... }` / `fail_` / `problem_`).

| Action | Body | Response |
|---|---|---|
| `listCustomers` | `{}` | `{ ok, customers: CustomerSummary[] }` |
| `openCustomer` | `{ customerId }` | `{ ok, customer }` |
| `saveCustomer` | `{ customer, expectedRevision, mutationId }` | `{ ok, customer }` |
| `mergeCustomers` | `{ targetId, sourceId }` | `{ ok, customer }` (target, with mergedFromIds) |
| `listActivities` | `{ customerId }` | `{ ok, activities: Activity[] }` sorted `at` desc |
| `addActivity` | `{ activity, mutationId }` | `{ ok, activity }` append-only, idempotent |
| `listTasks` | `{ customerId }` | `{ ok, tasks: Task[] }` |
| `saveTask` | `{ task, expectedRevision, mutationId }` | `{ ok, task }` |
| `saveWorkspace` (extended) | existing | accept & persist `stage`, `customerId` |

Concurrency: `saveCustomer`/`saveTask` use `expectedRevision` + `mutationId` (like workspaces).
`addActivity` is append-only and idempotent by `mutationId`. New Sheets tabs use
`integrationSheet_`: `Customers`, `CustomerActivities`, `Tasks`.

## File ownership (disjoint)

- Orchestrator: `src/crm/types.ts`, `src/types.ts` (`JobStage`), `src/workspaces/types.ts`.
- Subagent A (backend): `apps-script/Code.gs`, `scripts/workspace-dev-api.ts`,
  `vite.config.ts` (route new actions), `tests/crm-backend.test.ts`.
- Subagent B (data layer): `src/crm/**` except `types.ts`, plus `tests/crm-service.test.ts`.
- Subagent C (UI): `src/components/crm/**`, `src/services/navigation.ts`, `src/App.tsx`,
  `src/components/AppHeader.tsx`, `tests/crm.spec.ts`.

## Frontend data-layer API (subagent B implements in `src/crm/index.ts`)

- `startCrmSync()`, `subscribeCrm(cb)` — local-first IndexedDB + background sync.
- `listCustomers`, `openCustomer`, `createCustomer`, `updateCustomer`, `mergeCustomers`.
- `listActivities`, `addNote(customerId, body, by?)`, `logCommunication(customerId, input)`.
- `listTasks`, `createTask`, `toggleTask`.
- `setWorkspaceStage(workspaceId, stage)`, `linkWorkspaceToCustomer(workspaceId, customerId)`.

## UI contract (subagent C)

Routes: `#/customers`, `#/customers/:id`. Nav item "Customers" (desktop + mobile).
Components under `src/components/crm/`: `CustomerList`, `CustomerDetail`, `CustomerForm`,
`ActivityTimeline`, `TaskList`. Match the app's red/black/slate design tokens and
Tailwind v4 usage; WCAG 2.1 AA.

## Verification

`npm run typecheck`, `npm test`, `npm run test:browser` (after integration).
