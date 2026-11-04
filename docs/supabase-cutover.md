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
