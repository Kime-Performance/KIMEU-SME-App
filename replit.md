# KIMEU SME App

Access is private: server authorization requires a verified primary `@kimeperformance.com` email, an active `03h-App Users` record, and an SME, RD, or Admin role. Company email alone does not grant access. Reviewer-only and CEU-only accounts do not enter the workspace. App-user authorization reads bypass the sheet cache so revocations apply on the next API request. Passwords and invitations belong to Clerk, never Google Sheets. Clerk email/password and Restricted/invitation-only sign-up must be configured separately in each Clerk environment; hiding public registration links is not provider-level enforcement.

Operational sheet readiness is separate from staff authorization. An already verified workspace keeps forms mounted during transient refresh failures, with a retry warning; explicit inactive/denied responses still close it. Every mutation independently rechecks the approved staff record.

SME titles are SME Assist (Foundations) and SME Lead (Fellowship). Legacy Foundations SME / Elite SME roles are canonicalized at read time so access survives the transition. Admin Settings can edit SME titles and workshop assignments for existing staff while preserving non-SME roles and activation; server enforcement includes pathway restrictions.

RD-led `/courses/F-11` is 1.1 Orientation, and `/courses/F-12` is 1.2 Evaluation Retention. RDs see active clinical PTs explicitly assigned to their name/email in the Foundations tracker; Admin sees the active roster. Orientation records attendance plus RD result once. Evaluation Retention requires four separately dated, chronological calendar-week sessions with one full hour and RD Pass each. Feedback is required for not-passed results. Optional weekly teaching materials are not a mandated curriculum.

Cadaver Lab (`EN-CAD`, existing identity retained) and Surgical Observation (`F-SURG-OBS`) also appear under Foundations for RDs/Admin. Both use attendance-only mode with a date, checkbox, explicit Save and author/time audit; no practical result, weekly requirement or materials sections. They share the test-copy RD tracker and add corresponding attendance-status columns to Foundations. Cadaver Lab is classified as Foundations in the app/test catalog without rewriting its historic IDs or advanced-log attendance. No live master metadata was changed for this addition.

New RD inputs live in test-copy `03i-RD Onboarding`, with sheet formulas for unit completion, completed weeks and course status. The Foundations tracker has additional Orientation / Evaluation Retention status columns referencing these results. Existing overall Foundations/Summary formulas and historical inputs have NOT been migrated to this new requirement automatically. Every RD edit appends private audit history in `03g`; input and history saves share an atomic values batch with readback and optimistic revisions. Admin assignment changes use the same safeguards. The lock is process-local, not distributed.

`src/scripts/update-workshop-structure.ts` in the API package is an explicit maintenance command: `--apply-test` sets up the test-only RD schema and approved labels; `--apply-master-titles` changes only the approved live catalog labels/tier descriptions. The live master still cannot be configured as the app's write target. Existing Foundations block headings reference exact catalog row numbers—do not reorder catalog rows casually. `verify-rd-formulas.ts` checks formulas in a temporary test-sheet tab and removes that tab; it never changes real PT inputs.

Phone-first workshop operations for KIMEU SMEs. Current scope is Phase 1: Today, live attendance, session completion and append-only clinician notes.

Workshop pages also support RD post-workshop practical assessment on the test copy: assigned RDs (or Admins) record Pass/Fail and practical date after confirmed attendance. Not-passed assessments require feedback. The existing sheet formulas determine overall completion; practical sign-off does not override them.

Each workshop subpage includes an explicit-save attendance PT checklist and separate RD practical assessment. There is no overall-completion checklist, verification save, or approval in the SME app. The KIMEU sheet calculates completion from recorded inputs, including RD Pass and Director-uploaded Kajabi pre-course progress, for its Summary and Foundations/Fellowship tabs and the Clinician Development tool. Preserve all completion formulas and existing note history. Presentation and supporting-material sections remain unpopulated until the user supplies links.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/kimeu-sme-app run dev` — frontend (managed workflow supplies PORT and BASE_PATH)
- Required sheet configuration: `KIMEU_SHEET_ID` must identify a test copy. Reads and writes use the existing Google Sheets integration through Replit Connectors; no service-account JSON is required.
- Clerk credentials are managed through the workspace Auth pane.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Source of truth: existing KIMEU Google Sheet. Do not introduce a separate app database.
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/kimeu-sme-app/src` — React interface and device-local attendance retry queue
- `artifacts/api-server/src/lib/kimeu` — Google Sheets access, permissions and session logic
- `artifacts/api-server/src/routes/kimeu.ts` — authenticated API
- `lib/api-spec/openapi.yaml` — API contract; regenerate after edits

## Architecture decisions

- Build and review the app shell before connecting Google Sheets.
- Build and verify against a copy first. Never write to the master spreadsheet.
- Resolve columns by their headers. Only input fields may be written; preserve computed and array-formula cells.
- Never write to 03-KIMEU Summary. Do not create walk-in records in 03e without resolving the spec's read-only tab rule.
- Clinician notes fail closed unless 03g has a Visibility header. Do not weaken “Aaron + author” privacy.
- RD assessment feedback retains that same private visibility and append-only history. The KIMEU director uses Admin access to view it.
- All server permissions require a permitted organisation email and an active 03h user record, including assigned workshop checks.
- No patient identifiers. Timestamps follow America/Los_Angeles.
- Google Calendar is the official workshop schedule. Connect one-way for occurrence reference only; never use calendar guests or RSVPs as real attendance. SMEs take actual attendance live in the app.
- Upcoming Calendar reference lists Foundations and Advanced workshops only, not all KIMEU educational meetings. Calendar refresh never creates, changes, or reschedules an attendance session automatically.
- The new Foundations workshops are planned for 2027 and are not yet on the calendar. The user wants only the Calendar connection for now; do not commit dates or proceed with workshop mapping/session-linking work until requested.

## Product

Sign in, see today's sessions, open a session, mark clinician attendance, close with session notes and next-time changes, append a clinician observation. Pending attendance taps can remain on the signed-in user's device and retry after reconnecting. Notes are never queued offline.

## User preferences

The SME app is intended to influence the KIMEU Progress Tracker, while keeping the Google Sheet as the shared source of truth.

When it fits the build flow, keep the visual brand and theme consistent with the Clinician Development App in the user's other project.

Use the user-supplied KIME Pay Path HTML as the visual reference for that alignment: blue accents, cool gray backgrounds, white panels, Teko headings, and Open Sans body text.

## Gotchas

- Check every OAuth scope before judging a connector's permissions: `drive.readonly` can coexist with the separate `spreadsheets` edit scope.
- Before rollout, verify a full session/attendance write-and-reread on the test copy. Never substitute seeded/demo records.
- Deployment is not ready until real-sheet acceptance testing is complete.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
