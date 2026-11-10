import { getSql } from "./client";

export function getBasicReadiness() {
  const configured = Boolean(process.env.KIMEU_TRUTH_DATABASE_URL);
  return {
    configured, trackingMode: "postgres" as const, sheetId: null as string | null,
    notePrivacyReady: false, writeEnabled: false,
    missing: configured ? [] as string[] : ["The Supabase truth-database connection is not configured."],
  };
}

export async function getReadiness() {
  const basic = getBasicReadiness();
  if (!basic.configured) return basic;
  try {
    const sql = getSql();
    // Exercise the same protected identity relationship as the app's roster.
    await sql`select p.person_id from person p where p.active and exists (
      select 1 from providers pr where pr.person_id = p.person_id and pr.status = 'active' and pr.kimeu_roster
    ) limit 1`;
    const privileges = await sql<{ name: string; allowed: boolean }[]>`
      select t || '.' || c || ' (' || op || ')' as name,
        has_column_privilege(current_user, 'public.' || t, c, op) as allowed
      from (values
        ('kimeu_app_users','email','SELECT'),
        ('kimeu_app_users','app_roles','UPDATE'),
        ('kimeu_app_users','workshop_ids','UPDATE'),
        ('kimeu_workshops','workshop_id','SELECT'),
        ('kimeu_foundations_pt','exam_result','UPDATE'),
        ('kimeu_foundations_blocks','attended_sme','UPDATE'),
        ('kimeu_workshop_records','attended','UPDATE'),
        ('kimeu_sessions','session_id','INSERT'),
        ('kimeu_clinician_notes','note_id','INSERT'),
        ('kimeu_clinician_notes','follow_up_due','INSERT'),
        ('kimeu_clinician_notes','visibility','SELECT')
      ) as required(t,c,op)
    `;
    const denied = privileges.filter(p => !p.allowed);
    const requiredDenied = denied.filter(p => !p.name.startsWith("kimeu_clinician_notes.follow_up_due"));
    const missing = denied.map(p => p.name.startsWith("kimeu_clinician_notes.follow_up_due")
      ? "Follow-up due dates need the database owner's additional note-input grant. Other notes can still be saved."
      : `Database permission required: ${p.name}`);
    return { ...basic, configured: requiredDenied.length === 0, writeEnabled: requiredDenied.length === 0,
      notePrivacyReady: privileges.some(p => p.name.startsWith("kimeu_clinician_notes.visibility") && p.allowed), missing };
  } catch {
    return { ...basic, configured: false, missing: ["Supabase could not complete the application-role readiness checks."] };
  }
}
