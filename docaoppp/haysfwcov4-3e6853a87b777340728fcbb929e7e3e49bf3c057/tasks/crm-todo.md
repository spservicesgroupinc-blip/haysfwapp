# CRM Features — Task List

Status: complete (2026-10-22). All implementation items built and verified.

## Contract
- [x] JobStage type + Workspace.stage/customerId
- [x] src/crm/types.ts
- [x] tasks/crm-plan.md

## Subagent A — Backend
- [x] Code.gs: Customers/Activities/Tasks sheets + endpoints + workspace stage/customerId
- [x] scripts/workspace-dev-api.ts + vite.config.ts local API routing
- [x] tests/crm-backend.test.ts green

## Subagent B — Data layer
- [x] src/crm/api.ts, store.ts, sync.ts, index.ts
- [x] setWorkspaceStage / linkWorkspaceToCustomer helpers
- [x] tests/crm-service.test.ts green

## Subagent C — UI
- [x] CustomerList, CustomerDetail, CustomerForm, ActivityTimeline, TaskList
- [x] navigation.ts + App.tsx + AppHeader.tsx wiring (#/customers routes)
- [x] tests/crm.spec.ts

## Integration (orchestrator)
- [x] npm run typecheck clean
- [x] npm test green (124 passed, incl. 12 new CRM tests)
- [x] npm run build clean
- [x] Playwright CRM spec green

## Job directory → customer directory sync (2026-10-22)
- [x] src/crm/jobSync.ts: syncCustomersFromJobs (upsert by normalized name, fill blanks only, link saved jobs by job number then name)
- [x] sync.ts: stageCustomers batches one emit/sync pass for a whole import
- [x] AdminJobs import runs the sync; App.refresh syncs on every dashboard load; JobsDocuments links when a directory job is opened
- [x] listCustomers jobCount includes uploaded directory jobs (deduped with linked jobs by job number)
- [x] Offline seed jobs (`DashboardData.jobsAreDemo`) never become customers; sync runs are serialized so StrictMode's double mount cannot duplicate them
- [x] tests/crm-job-sync.test.ts green (npm test: 131 passed)

## Outstanding (deployment only)
- [ ] Manual redeploy of `apps-script/Code.gs` to the live Apps Script web app (no CI deploy)
