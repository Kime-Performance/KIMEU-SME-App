# KIMEU SME App

Phone-first workshop operations for KIMEU SMEs. Current scope is Phase 1: Today, live attendance, session completion and append-only clinician notes.

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
- All server permissions require a permitted organisation email and an active 03h user record, including assigned workshop checks.
- No patient identifiers. Timestamps follow America/Los_Angeles.

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
