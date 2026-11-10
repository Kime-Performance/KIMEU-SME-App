-- Run the ENTIRE file as database owner in the existing KIMEU Supabase project.
-- Adds a narrowly filtered, read-only roster view for the existing SME role.
-- Replaces ONLY the SME person-read policy installed by sme-app-permissions.sql.
-- No PT identities, auth accounts, employment data, or completion records change.
-- Financial provider links are not changed or used for this clinical roster.
BEGIN;
SET LOCAL statement_timeout = '20s';

DO $preflight$
DECLARE
  source_table text;
  bypasses_rls boolean;
BEGIN
  IF current_setting('server_version_num')::integer < 150000 THEN
    RAISE EXCEPTION 'This roster setup requires PostgreSQL 15 or later.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sme_app') THEN
    RAISE EXCEPTION 'Expected SME role is missing. Confirm the KIMEU project.';
  END IF;
  SELECT rolsuper OR rolbypassrls INTO bypasses_rls
    FROM pg_roles WHERE rolname = current_user;
  FOREACH source_table IN ARRAY ARRAY['user_access', 'person', 'person_email_alias']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = source_table
        AND c.relkind IN ('r', 'p') AND c.relrowsecurity
        AND (bypasses_rls OR (
          pg_has_role(current_user, c.relowner, 'USAGE') AND NOT c.relforcerowsecurity
        ))
    ) THEN
      RAISE EXCEPTION 'Run as the database owner; required protected source public.% is unavailable.', source_table;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'v_kimeu_sme_roster'
      AND (c.relkind <> 'v' OR pg_get_userbyid(c.relowner) <> current_user)
  ) THEN
    RAISE EXCEPTION 'Existing roster object has a different owner or type; review it before replacing.';
  END IF;
END
$preflight$;

-- This intentional owner-executed view is the read boundary: the app does NOT
-- receive access to the HR access flags or the complete person/alias directory.
-- The fixed active + Clinical filter and projected columns must be preserved.
CREATE OR REPLACE VIEW public.v_kimeu_sme_roster
WITH (security_barrier = true, security_invoker = false)
AS
WITH clinical_roster AS (
  SELECT
    u.id AS roster_id,
    lower(btrim(u.email)) AS roster_email,
    u.full_name AS roster_name,
    u.location,
    u.source_sheet,
    u.last_updated AS source_updated_at,
    count(*) OVER (PARTITION BY lower(btrim(u.email))) AS email_row_count
  FROM public.user_access u
  WHERE lower(btrim(u.status)) = 'active'
    AND lower(btrim(u.department)) = 'clinical'
), resolved AS (
  SELECT
    r.*,
    links.candidate_count,
    p.person_id,
    p.active AS person_active,
    lower(btrim(p.email::text)) AS canonical_email,
    p.full_name AS person_name,
    count(*) OVER (PARTITION BY p.person_id) AS person_roster_rows
  FROM clinical_roster r
  LEFT JOIN LATERAL (
    SELECT count(*) AS candidate_count,
           (array_agg(candidate.person_id))[1] AS matched_person_id
    FROM (
      SELECT p0.person_id FROM public.person p0
        WHERE lower(btrim(p0.email::text)) = r.roster_email
      UNION
      SELECT a.person_id FROM public.person_email_alias a
        WHERE lower(btrim(a.email::text)) = r.roster_email
    ) candidate
  ) links ON true
  LEFT JOIN public.person p
    ON links.candidate_count = 1 AND p.person_id = links.matched_person_id
)
SELECT
  roster_id,
  roster_email,
  canonical_email,
  coalesce(nullif(btrim(roster_name), ''), nullif(btrim(person_name), ''), roster_email) AS full_name,
  coalesce(location, '') AS location,
  person_id,
  CASE
    WHEN coalesce(roster_email, '') = '' THEN 'missing_roster_email'
    WHEN email_row_count > 1 THEN 'duplicate_roster_email'
    WHEN candidate_count = 0 THEN 'missing_person'
    WHEN candidate_count > 1 THEN 'ambiguous_person'
    WHEN person_active IS NOT TRUE THEN 'inactive_person'
    WHEN coalesce(canonical_email, '') = '' THEN 'missing_primary_email'
    WHEN person_roster_rows > 1 THEN 'duplicate_person_link'
    ELSE 'linked'
  END AS identity_state,
  source_sheet,
  source_updated_at
FROM resolved;

REVOKE ALL ON public.v_kimeu_sme_roster FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_kimeu_sme_roster TO sme_app;
COMMENT ON VIEW public.v_kimeu_sme_roster IS
  'Server-only active Clinical roster. Resolve exact primary/registered alias emails, never names. Flag unresolved/ambiguous identities without changing them.';

-- Retain RLS. Replace only our previous provider-dependent person-read policy.
-- The owner-executed view resolves its person lookup without recursive RLS.
DROP POLICY IF EXISTS kimeu_sme_active_people ON public.person;
CREATE POLICY kimeu_sme_active_people ON public.person
  FOR SELECT TO sme_app
  USING (active AND EXISTS (
    SELECT 1 FROM public.v_kimeu_sme_roster r
    WHERE r.person_id = person.person_id AND r.identity_state = 'linked'
  ));

COMMIT;

-- Counts only. A successful setup is not proof that every PT is linked.
SELECT identity_state, count(*) AS roster_rows
FROM public.v_kimeu_sme_roster
GROUP BY identity_state
ORDER BY identity_state;
