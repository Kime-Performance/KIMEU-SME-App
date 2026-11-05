# Supabase-only SME app cutover

The approved direction is Supabase-only application data, without a write-back
mirror to Google Sheets. This does not migrate the separate Clinician
Development Tool or publish this app.

## Database-owner setup

1. Open the **existing KIMEU truth database project** in Supabase, not a new project.
2. Open SQL Editor and run the entire `scripts/supabase/sme-app-permissions.sql`
   file as database owner. It is transactional and safe to rerun.
3. The script grants the existing server-side `sme_app` role selected reads and
   column-specific writes and adds missing role-specific RLS policies. It does
   not change clinical records, disable RLS, grant delete access, grant public
   access, create login credentials, or activate the app's Postgres mode.
4. In **Database Settings → SSL Configuration**, download the public database
   CA certificate. Provide only this certificate, never a private key.
   The app accepts its PEM contents through `KIMEU_TRUTH_DATABASE_CA_CERT`.
   Certificate verification is always enabled; there is no insecure fallback.

Official certificate instructions:
https://supabase.com/docs/guides/database/connecting-to-postgres

## Required checks before activating Postgres mode

- Verify certificate identity and database-role privileges using the app login.
- Verify active PT visibility through RLS, approved staff access, catalog entries,
  and existing records. Do not bulk-copy sandbox records or recreate canonical tables.
- If providers are visible but the active PT join is empty, run
  `scripts/supabase/roster-link-diagnostics.sql` as database owner. It returns
  aggregate counts only. Resolve missing identity links through verified,
  unambiguous identifiers; do not fuzzy-match display names, expose auth tables
  to the SME role, or remove the clinical eligibility filter to populate a list.
- Missing provider auth-account links do not imply PTs need login accounts.
  `scripts/supabase/clinical-roster-diagnostics.sql` checks existing active
  clinical directories against the shared person spine by work email, returning
  aggregate counts only. Confirm the authoritative roster and its coverage
  before replacing the provider-based eligibility join or granting roster access.
- For the active Clinical directory, apply
  `scripts/supabase/sme-clinical-roster-access.sql` as database owner. This
  creates a server-only filtered view, uses exact primary or registered-alias
  email matches, and replaces only the SME person-read policy with that clinical
  eligibility rule. Its owner must be able to read the protected sources without
  recursive RLS. No base HR/auth-table access is granted to the app.
  Missing, inactive, duplicate, and ambiguous identities remain explicitly flagged;
  the script does not create or repair them. Verify all roster states and the
  source provenance before activating or porting the application roster queries.
- Complete the remaining Sheet-dependent paths: staff authorization and
  administration, course catalog and roster directory, workshop enrollment and
  tracking, Foundations Assessment, and SME-assignment saves.
- Check computed completion and status logic in Supabase: granting input writes
  does not port the old Sheets formulas or establish that database triggers
  update all calculated fields correctly.
- Coordinate the external Sheets ingestion process so it does not overwrite
  Supabase-owned operational fields with stale spreadsheet values.
- Update the separate Clinician Development Tool to read the shared Supabase
  records before relying on cross-app refreshes.
- Verify transactional saves, conflict handling, permission denials, and
  attendance/practical/assessment/reviewer readback. Do not claim a write is
  verified based on `SELECT 1` or mocked tests.
- Only then enable `KIMEU_DATA_SOURCE=postgres`, restart and verify the app.
  Publishing remains a separate user-controlled action.

The permissions script is a prerequisite, **not completion of this checklist**.

## Application cutover implementation

In Postgres mode, staff approval checks, catalog and directory reads, course
attendance/enrollment, Foundations Assessment, SME-assignment saves, session
notes, and existing RD/reviewer workflows use the shared truth database.
There is no operational Sheets fallback in this mode. Calendar occurrence
references remain a separate Google Calendar integration.

The source badge and Settings readiness now identify Supabase explicitly.
The response contract's `trackingMode` includes `postgres`; the legacy
`sheetStatus` response field is retained for client compatibility.

Course attendance saves and their session creation are one advisory-locked
transaction. Assessment and staff changes append private audits in the same
transaction. Saves confirm their returned inputs before committing. Only
permitted input columns change; course completion, Kajabi evidence, unrelated
practical results and K-Star evidence are not overwritten.

### Shared-schema owner action still required

The application role lacks INSERT on
`public.kimeu_clinician_notes.follow_up_due`. The review-only proposal is
`scripts/supabase/sme-note-due-permission.sql`. No owner SQL was applied by the
application agent. Notes requesting a due date fail explicitly and save
nothing until the owner approves and applies this narrow grant.

The Foundations Assessment still requires an existing canonical Foundations
profile and an assigned RD (or Admin). The app does not manufacture partial
profiles, create PT login accounts, or guess missing assignments. Staff
assignment updates retain existing non-SME roles; creating, activating and
deactivating staff records are not covered by the current column grants.

Unit tests use synthetic records and a rollback-capable executor; SQL EXPLAIN
checks validate real schema and role permissions without executing writes.
Neither establishes that a real clinical input has been saved end to end.
Coordinate an owner-approved test dataset before exercising live mutations.
The separate Clinician Development Tool and external importer ownership still
require their own verification.

### Release verification is blocked

Sequential application-role reads succeed across workshop tracking, roster,
staff assignments and assessment workspaces. Synthetic transaction tests and
SQL planning checks pass for the core write statements. The signed-in browser
journey has not passed: concurrent reads can stall, leaving bootstrap pending.
Fresh read-only client probes also reproduced queued-read stalls. Testing
smaller pipelines, a second connection and disabled automatic type discovery
did not establish a fix. Do not infer release readiness from individual reads.

The next investigation needs pooler-side connection/query observations
correlated with the app's concurrent staff/catalog/roster/session requests,
without relaxing RLS or changing PT records. Client idle/connection-lifetime
bounds alone did not resolve the observed stall. No real clinical save or
cross-app completion update has been exercised, and this build is not
recommended for staff rollout until the pending-read issue is resolved.
