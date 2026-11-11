# OpenRouter document autofill migration

The active document app now sends intake text through Apps Script to
`https://openrouter.ai/api/v1/chat/completions`, using allowlisted `:free` models. Provider
prompt, completion, request and image price caps are all zero. JSON support is
required. Client payloads cannot override the model, routing, prompt or key.
No paid fallback is configured; one alternate free model may recover a failed extraction.

PDF/text uploads and pastes use the same extraction schema and job-field mapping
as before. AI-extracted fields are marked OpenRouter for review. Existing field
validation, authentication, document-only context and failure handling are retained.
The older workspace snapshot under `docaoppp/` is not the active app and is unchanged.

## Activation

1. In the existing Apps Script project's **Project Settings > Script Properties**,
   set `OPENROUTER_API_KEY` to your OpenRouter key. The old DeepSeek property is no
   longer read. Never put the key in frontend source or a `VITE_` variable.
2. Update `Code.gs` from `src/apps-script/Code.gs` (or the generated
   `PASTE-INTO-APPS-SCRIPT.txt`). Keep `appsscript.json` and existing properties.
3. Publish a new version of the existing web-app deployment, preserving its URL
   and access settings. Rebuild/deploy the frontend to update extraction labels.
4. Upload a test document while signed in and review the populated form.

The ignored `.env.openrouter.local` file is for the local `npm run ai:check`
command only. It is not sent to GitHub or deployed to Apps Script.

## Validation on November 10, 2026

- Production build passed.
- Active app and root scripts passed TypeScript checking with the bundled older
  `docaoppp/` project excluded in a temporary check config; committed tsconfig unchanged.
- All 13 customer-reference/backend tests passed, including free-only routing,
  malicious client overrides, input bounds and safe API errors.
- Intake parser and current draft-backend checks passed.
- All six browser intake tests passed, including PDF/text uploads and delayed
  success/failure while editing or clearing a job. Browser API responses were stubbed.
- A separate live request through the actual backend request/response code and
  client mapping extracted eight fields from fictional document text, preserved
  manually entered instructions and reported `$0` cost. No real customer data was sent.
- Paste payload and chunks were regenerated and verified byte-identical to Code.gs.

Existing repository-wide failures remain: `npm run lint` includes an older nested
project whose `@pdf-lib/fontkit` dependency is absent from the root install;
`apps:test` and `apps:register` call superseded backend helpers; one of the 24
database tests asserts an outdated deployment-error message (the other 23 pass).
The files responsible for these failures are unchanged by this migration.

Live Apps Script was not updated: local Google CLI authentication is not configured.
Source publication to GitHub does not activate the deployed backend.

## Intake failure and save recovery follow-up

The deployed Vercel bundle was verified to use the intended Apps Script URL.
The reported `unknown_action` intake failure indicates that URL is serving a
backend version without the `analyzeIntake` handler. The full Code.gs now exposes
its backend version, supported actions and a key-configured boolean in `ping`,
so activation can be verified without exposing credentials. Publish **New
version** through **Manage deployments > Edit** after replacing Code.gs; saving
editor contents alone does not update the version behind `/exec`.

Optional model reasoning is disabled and the client AI timeout is two minutes.
A live synthetic six-page estimate-text check passed: twelve extracted fields,
combined dwelling/contents total, insured contact attribution, missing claim
and deductible values retained as missing, and zero reported cost.

Local autosave now forgets unexpectedly closed IndexedDB connections and retries
`UnknownError`/`InvalidStateError` once with a fresh connection. It never deletes
the database or pending writes. Both new failure/recovery regressions and all
sixteen sync-engine tests pass. A persistent browser storage fault still raises
an error and retains the in-memory pending draft.

The replacement Apps Script URL supplied during the follow-up was checked by GET
and POST: it reports `2026-11-10-openrouter-2` and the `analyzeIntake` capability.
At that check it reported `aiConfigured: false`; the owner needed to add
`OPENROUTER_API_KEY` in that project's Script Properties. No key is shipped in
the frontend or committed to GitHub. The frontend now targets that replacement URL.

The subsequent replacement deployment provided after key setup was verified with
`backendVersion: "2026-11-10-openrouter-2"`, `analyzeIntake` support, and
`aiConfigured: true`. Its URL is now the bundled endpoint in `src/config/appsScript.ts`.

## Repair version 2026-11-10-openrouter-3

The authentication-removal rewrite was backed up outside the repository before
repair. The backend retains login, sessions, role checks and owner-attributed
audit records. The frontend targets the last deployment URL explicitly supplied
by the user; the other agent's unconfirmed URL change was not published.

The model list is Gemma 4 31B free, then Dots3-Note Preview free. Both endpoints
were checked against OpenRouter's model/endpoint catalog for JSON support and
zero prices. At most two attempts are made; price caps apply to each request.
Malformed JSON, missing output and provider unavailability may use the alternate
model. Account rate limits, authentication failures, quota failures and refusals
stop immediately. Markdown fences and text parts containing complete JSON are
normalized without repairing truncated JSON or inventing missing data.

The live synthetic estimate check reproduced provider throttling on Google AI
Studio and completed successfully through the Dots fallback: twelve fields,
correct combined RCV and insured contact attribution, with reported cost zero.
The root TypeScript config now excludes the separately bundled `docaoppp/`
project, so the active app's ordinary `npm run lint` checks the right project.

Deploy the full Code.gs as a new version of the existing Apps Script deployment
to activate this backend repair. Publishing frontend source to GitHub/Vercel
does not change the deployed Apps Script version.
