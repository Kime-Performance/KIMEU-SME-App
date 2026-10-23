# KIMEU SME App

Phone-first workshop operations for KIMEU SMEs. Current scope is Phase 1: Today, live attendance, session completion and append-only clinician notes.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/kimeu-sme-app run dev` — frontend (managed workflow supplies PORT and BASE_PATH)
- Required sheet configuration: `KIMEU_SHEET_ID` must identify a test copy; `GOOGLE_SERVICE_ACCOUNT_JSON` is a secret for a service account with edit access to that copy.
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
- All server permissions require a permitted organisation email and an active 03h user record, including assigned workshop checks.
- No patient identifiers. Timestamps follow America/Los_Angeles.

## Product

Sign in, see today's sessions, open a session, mark clinician attendance, close with session notes and next-time changes, append a clinician observation. Pending attendance taps can remain on the signed-in user's device and retry after reconnecting. Notes are never queued offline.

## User preferences

The SME app is intended to influence the KIMEU Progress Tracker, while keeping the Google Sheet as the shared source of truth.

## Gotchas

- The existing connector was read-only; app writes use a separately configured service account.
- Live read/write acceptance testing is blocked until the test-copy sheet and service-account secret are supplied. Never substitute seeded/demo records.
- Deployment is not ready until real-sheet acceptance testing is complete.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
