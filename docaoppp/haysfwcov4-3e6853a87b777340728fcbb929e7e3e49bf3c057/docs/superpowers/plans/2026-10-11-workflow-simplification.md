# Workflow Simplification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (Native). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Remove the pricing/handoff redundancies from the change-order workflow: one owner per field, no dead `draft` status, and a single-purpose editor for each estimator action.

**Architecture:** This is a frontend-first refactor with a small, coupled backend change. The pricing fields move out of the PM intake and become estimator-only, entered in the "Finalize customer document" screen. The `draft` status is removed from the lifecycle; the PM saves directly as `submitted`. The two faces of `RequestEditor` are made disjoint (edit-intake vs finalize-document).

**Tech Stack:** React + TypeScript (Vite), Google Apps Script backend (`Code.gs`, tested via `vm` in `request-storage.test.ts`), Node `node:test` unit tests, Playwright browser tests.

**Spec:** the brainstorm in this session (items 1, 2, 3).

## Global Constraints

- Money is a canonical decimal string with integer-cents arithmetic; signed amounts keep a `+`/`-` prefix; never invent a `$0.00`.
- `saveRequest` on an existing row may NOT change `status` or `estimatorName`; state changes go through `claimRequest`/`transitionRequest`.
- The Apps Script backend is deployed by hand (paste + redeploy); `Code.gs` edits take effect only after the user redeploys.
- Keep the existing schema version (`schemaVersion: 2`); do not rename sheets or columns.
- Verification gate: `npm run typecheck && npm test && npm run test:browser && npm run build`.

## Review Focus

- A PM must never be asked for a price or estimate line numbers again.
- Removing `knownChangeAmount` must not break the estimator's `finalChangeOrder.amount` prefill (it now simply starts blank).
- A request saved as `submitted` directly must still be claimable and editable without a separate transition.
- The customer PDF must still render estimate line references and the final amount exactly as before.
- The summary PDF / Dash note must no longer print a "Known change amount" line.

---

### Task 1: Remove `knownChangeAmount` (single pricing owner)

**Files:**
- Modify: `src/types.ts` (drop `knownChangeAmount` from `ChangeRequest`)
- Modify: `src/services/changeOrder.ts` (`customerDocumentDraft` fallback, `pricingInputError`)
- Modify: `src/services/dashNote.ts` (drop "Known change amount" line)
- Modify: `src/services/requestPdf.ts` (drop summary "Known change amount" line)
- Modify: `src/components/IntakeReceipt.tsx` (drop the receipt row)
- Modify: `src/components/RequestQuestions.tsx` (remove `knownChangeAmount`/`showKnownAmount` and the `SignedAmountInput`)
- Modify: `src/components/RequestEditor.tsx` (drop the hint + prop)
- Modify: `src/components/SimpleRequest.tsx` (drop state/wiring)
- Modify: `apps-script/Code.gs` (`shapeCheck_` drop the `knownChangeAmount` rule)
- Test: `tests/change-order.test.ts`, `tests/dash-note.test.ts`, `tests/request-pdf.test.ts`, `tests/request-storage.test.ts`, `tests/simpleRequest.spec.ts`, `tests/workflow.spec.ts`

- [ ] **Step 1:** Update the unit tests to expect `knownChangeAmount` gone (no "Known change amount" in Dash note/PDF; `customerDocumentDraft` amount fallback is `""`).
- [ ] **Step 2:** Run `npm test` and watch those tests fail on the removed field.
- [ ] **Step 3:** Remove the field and every reference listed above.
- [ ] **Step 4:** Run `npm run typecheck && npm test` until green.

### Task 2: Remove pricing from the PM "Quick request" form

**Files:**
- Modify: `src/components/RequestQuestions.tsx` (become classification-only: requestType + customerCredits; drop `lineNumbers`/`LineChangesInput`)
- Modify: `src/components/SimpleRequest.tsx` (drop `lineNumbers`/`knownChangeAmount` state, `pricingInputError` guard, and `buildRequest` fields)
- Modify: `src/components/RequestEditor.tsx` (render `LineChangesInput` directly in document mode instead of via `RequestQuestions`)
- Test: `tests/simpleRequest.spec.ts`, `tests/workflow.spec.ts`

- [ ] **Step 1:** Update the browser specs to assert the PM form has no line-number/amount controls and the saved request carries no `lineNumbers`/`knownChangeAmount`.
- [ ] **Step 2:** Run the affected specs to see them fail.
- [ ] **Step 3:** Implement the field moves.
- [ ] **Step 4:** Run `npm run typecheck && npm test` until green.

### Task 3: Remove the `draft` status (frontend + backend)

**Files:**
- Modify: `src/types.ts` (4 states)
- Modify: `src/services/requests.ts` (`createRequest` → `status: "submitted"`)
- Modify: `src/components/SimpleRequest.tsx` (`buildRequest` → `"submitted"`; drop the final `transitionRequest("submitted")`)
- Modify: `src/components/IntakeReceipt.tsx` + `src/App.tsx` (drop `draft` label/count)
- Modify: `apps-script/Code.gs` (`saveRequest_` accept new `submitted` requests and set `submittedAt`; `transitionRequest_` drop `draft` from the `submitted` source; `uploadAttachment_`/edit list drop `draft`)
- Test: `tests/request-storage.test.ts`, `tests/simpleRequest.spec.ts`, `tests/workflow.spec.ts`

- [ ] **Step 1:** Update backend tests (`submittedRequest` helper becomes a direct save; "new requests must begin as drafts" becomes "…as submitted without attachments/estimator").
- [ ] **Step 2:** Run `npm test` and watch backend tests fail.
- [ ] **Step 3:** Implement the frontend and backend changes.
- [ ] **Step 4:** Run `npm run typecheck && npm test` until green.
- [ ] **Step 5:** Flag in the report: redeploy `Code.gs` by hand.

### Task 4: Split the editor into two single-purpose screens

**Files:**
- Modify: `src/components/RequestEditor.tsx` (edit mode = intake fields only; document mode = document fields + final scope/amount + `LineChangesInput`, no `RequestQuestions`)
- Modify: `src/components/RequestReview.tsx` (relabel "Prepare customer document" → "Finalize customer document"; update copy)
- Test: `tests/workflow.spec.ts`

- [ ] **Step 1:** Update the spec to assert the edit screen lacks pricing/document fields and the finalize screen lacks classification fields, and the button reads "Finalize customer document".
- [ ] **Step 2:** Run the spec to see it fail.
- [ ] **Step 3:** Implement the disjoint field split and rename.
- [ ] **Step 4:** Run `npm run typecheck && npm test && npm run test:browser && npm run build`.

## Notes

- The "merge Save + Mark complete" sub-idea from item 3 is intentionally **not** forced: "save the document" and "mark complete" are semantically distinct (and the open question about customer approval remains). Copy is clarified instead.
