-- PROPOSAL FOR THE SHARED-DATABASE OWNER; the Replit agent has NOT applied it.
-- Review against the live schema and migration history before running.
-- The existing application already supports follow-up due dates, but the
-- restricted role's older column-scoped INSERT grant omitted this input.
-- No records, role memberships, public grants, or RLS policies change.
BEGIN;
GRANT INSERT (follow_up_due) ON public.kimeu_clinician_notes TO sme_app;
COMMIT;
