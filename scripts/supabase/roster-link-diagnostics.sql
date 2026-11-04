-- Run as database owner in the existing KIMEU Supabase SQL Editor.
-- Read-only aggregate diagnostics: no names, emails, IDs, or records are output.
-- No identity links or application records are changed.
WITH person_emails AS (
  SELECT lower(btrim(email::text)) AS email,
         count(*) AS matches,
         count(*) FILTER (WHERE active) AS active_matches
  FROM public.person
  WHERE email IS NOT NULL AND btrim(email::text) <> ''
  GROUP BY lower(btrim(email::text))
)
SELECT
  count(*) AS active_providers,
  count(*) FILTER (WHERE pr.person_id IS NOT NULL) AS already_linked,
  count(*) FILTER (WHERE au.id IS NOT NULL) AS with_auth_account,
  count(*) FILTER (WHERE au.email_confirmed_at IS NOT NULL) AS with_verified_email,
  count(*) FILTER (
    WHERE pr.person_id IS NULL
      AND au.email_confirmed_at IS NOT NULL
      AND pe.matches = 1 AND pe.active_matches = 1
  ) AS eligible_for_verified_email_link,
  count(*) FILTER (WHERE pe.matches > 1) AS ambiguous_person_emails
FROM public.providers pr
LEFT JOIN auth.users au ON au.id = pr.auth_user_id
LEFT JOIN person_emails pe ON pe.email = lower(btrim(au.email))
WHERE pr.status = 'active';
