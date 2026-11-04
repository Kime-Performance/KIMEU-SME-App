-- Run as database owner in the existing KIMEU Supabase SQL Editor.
-- Read-only: returns two rows of counts, with no names, emails or IDs.
-- This distinguishes clinical roster coverage from staff login accounts.
WITH active_person_emails AS (
  SELECT lower(btrim(email::text)) AS email, count(*) AS matches
  FROM public.person
  WHERE active AND email IS NOT NULL AND btrim(email::text) <> ''
  GROUP BY lower(btrim(email::text))
)
SELECT
  'clinicians' AS roster_source,
  count(*) AS active_rows,
  count(*) FILTER (
    WHERE c.work_email IS NOT NULL AND btrim(c.work_email) <> ''
  ) AS with_work_email,
  count(*) FILTER (WHERE p.matches = 1) AS unique_person_match,
  count(*) FILTER (WHERE p.matches > 1) AS ambiguous_email_match
FROM public.clinicians c
LEFT JOIN active_person_emails p ON p.email = lower(btrim(c.work_email))
WHERE c.is_active
UNION ALL
SELECT
  'user_access_clinical' AS roster_source,
  count(*) AS active_rows,
  count(*) FILTER (
    WHERE u.email IS NOT NULL AND btrim(u.email) <> ''
  ) AS with_work_email,
  count(*) FILTER (WHERE p.matches = 1) AS unique_person_match,
  count(*) FILTER (WHERE p.matches > 1) AS ambiguous_email_match
FROM public.user_access u
LEFT JOIN active_person_emails p ON p.email = lower(btrim(u.email))
WHERE lower(btrim(u.status)) = 'active'
  AND lower(btrim(u.department)) = 'clinical';
