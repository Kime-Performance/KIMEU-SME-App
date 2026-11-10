-- Run as database owner in the EXISTING KIMEU Supabase project's SQL Editor.
-- Does not insert/update/delete clinical records, disable RLS, grant DELETE,
-- or grant rights to anon/authenticated/public. It changes SME backend access.
-- This is not a data migration and does not activate the app's data-source flag.
BEGIN;

DO $preflight$
DECLARE
  required_table text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sme_app')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kimeu_sme_app_bot') THEN
    RAISE EXCEPTION 'Expected existing SME roles are missing. Confirm the target project.';
  END IF;
  IF NOT pg_has_role('kimeu_sme_app_bot', 'sme_app', 'USAGE') THEN
    RAISE EXCEPTION 'The app login must already inherit sme_app; no memberships were changed.';
  END IF;
  FOREACH required_table IN ARRAY ARRAY[
    'person', 'providers', 'kimeu_workshops', 'kimeu_app_users',
    'kimeu_sessions', 'kimeu_foundations_pt', 'kimeu_foundations_blocks',
    'kimeu_workshop_records', 'kimeu_rd_onboarding',
    'kimeu_fellowship_reviews', 'kimeu_clinician_notes'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = required_table
        AND c.relkind IN ('r', 'p') AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'Required public.% table is missing or RLS is disabled.', required_table;
    END IF;
  END LOOP;
END
$preflight$;

GRANT USAGE ON SCHEMA public TO sme_app;
GRANT SELECT (person_id, full_name, email, active) ON public.person TO sme_app;
-- Do not expose auth_user_id or unrelated provider metadata to this role.
GRANT SELECT (person_id, status, location_id) ON public.providers TO sme_app;
GRANT SELECT ON
  public.kimeu_workshops, public.kimeu_app_users, public.kimeu_sessions,
  public.kimeu_foundations_pt, public.kimeu_foundations_blocks,
  public.kimeu_workshop_records, public.kimeu_rd_onboarding,
  public.kimeu_fellowship_reviews, public.kimeu_clinician_notes
TO sme_app;

GRANT INSERT (
  session_id, workshop_id, session_date, lead_sme, session_status,
  session_notes, changes_for_next_session, last_updated_by, last_updated, source
) ON public.kimeu_sessions TO sme_app;
GRANT UPDATE (
  session_status, session_notes, changes_for_next_session, last_updated_by, last_updated
) ON public.kimeu_sessions TO sme_app;

GRANT INSERT (
  block_id, person_id, workshop_id, block_index, session_date, attended_sme,
  practical_date, practical_result, source, last_updated_by, last_updated
) ON public.kimeu_foundations_blocks TO sme_app;
GRANT UPDATE (
  session_date, attended_sme, practical_date, practical_result, last_updated_by, last_updated
) ON public.kimeu_foundations_blocks TO sme_app;

GRANT INSERT (
  record_id, person_id, pt_email, pt_name, workshop_id, session_date, attended,
  attendance_confirmed_by, practical_date, practical_result, practical_scored_by,
  k_star_test_performed, k_star_stars_earned, last_updated_by, last_updated, source
) ON public.kimeu_workshop_records TO sme_app;
GRANT UPDATE (
  session_date, attended, attendance_confirmed_by, practical_date, practical_result,
  practical_scored_by, k_star_test_performed, k_star_stars_earned,
  last_updated_by, last_updated
) ON public.kimeu_workshop_records TO sme_app;

GRANT INSERT (
  record_id, person_id, pt_email, workshop_id, week, session_date, minutes,
  attended, rd_result, signed_by, signed_at, notes, last_updated_by,
  last_updated, source, synced_at
) ON public.kimeu_rd_onboarding TO sme_app;
GRANT UPDATE (
  person_id, pt_email, workshop_id, week, session_date, minutes, attended,
  rd_result, signed_by, signed_at, notes, last_updated_by, last_updated,
  source, synced_at, deleted_at
) ON public.kimeu_rd_onboarding TO sme_app;

GRANT INSERT (
  review_id, person_id, review_date, reviewed_by, review_type, pt_email, pt_name,
  result, score, workshop_id_refocus, specific_need, notes,
  last_updated_by, last_updated, source, synced_at
) ON public.kimeu_fellowship_reviews TO sme_app;
-- Reviewer entries and their audit notes are append-only from this backend.
GRANT INSERT (
  note_id, person_id, created, pt_email, note_type, workshop_id, session_id,
  review_id, note, follow_up_needed, author, author_role, visibility, source, synced_at
) ON public.kimeu_clinician_notes TO sme_app;

-- Foundations Assessment only: not Kajabi progress or computed completion.
GRANT UPDATE (exam_result) ON public.kimeu_foundations_pt TO sme_app;
-- Existing staff assignments only. Creating/removing access is not enabled by
-- these grants and needs a separate, reviewed admin implementation at cutover.
GRANT UPDATE (app_roles, workshop_ids) ON public.kimeu_app_users TO sme_app;

-- Add missing role-specific policies without changing existing policies.
DO $policies$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'providers' AND policyname = 'kimeu_sme_active_providers') THEN
    CREATE POLICY kimeu_sme_active_providers ON public.providers
      FOR SELECT TO sme_app USING (status = 'active');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'person' AND policyname = 'kimeu_sme_active_people') THEN
    CREATE POLICY kimeu_sme_active_people ON public.person
      FOR SELECT TO sme_app
      USING (active AND EXISTS (
        SELECT 1 FROM public.providers pr
        WHERE pr.person_id = person.person_id AND pr.status = 'active'
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'kimeu_foundations_pt' AND policyname = 'kimeu_sme_assessment_update') THEN
    CREATE POLICY kimeu_sme_assessment_update ON public.kimeu_foundations_pt
      FOR UPDATE TO sme_app USING (deleted_at IS NULL) WITH CHECK (deleted_at IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'kimeu_app_users' AND policyname = 'kimeu_sme_assignments_update') THEN
    CREATE POLICY kimeu_sme_assignments_update ON public.kimeu_app_users
      FOR UPDATE TO sme_app USING (deleted_at IS NULL) WITH CHECK (deleted_at IS NULL);
  END IF;
END
$policies$;

COMMIT;

-- This shows role privileges, not a successful end-to-end application save.
SELECT x.table_name,
       has_table_privilege('kimeu_sme_app_bot', 'public.' || x.table_name, 'SELECT') AS can_read
FROM (VALUES
  ('kimeu_workshops'), ('kimeu_app_users'), ('kimeu_sessions'),
  ('kimeu_foundations_pt'), ('kimeu_foundations_blocks'),
  ('kimeu_workshop_records'), ('kimeu_rd_onboarding'),
  ('kimeu_fellowship_reviews'), ('kimeu_clinician_notes')
) AS x(table_name);
