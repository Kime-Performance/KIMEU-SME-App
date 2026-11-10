import { randomUUID } from "node:crypto";
import type { AppUser } from "../access";
import { requireWorkshopAccess } from "../access";
import { withKimeuLock } from "./transaction";
import { KimeuError, normalizeEmail } from "../sheets";

export async function appendClinicianNote(user: AppUser, authorRole: string, input: {
  clinicianEmail: string; workshopId: string; sessionId: string; noteType: string;
  note: string; visibility: string; followUpNeeded: boolean; followUpDue?: Date | null;
}) {
  if (!user.active) throw new KimeuError("Your staff access is inactive.", 403, "APP_USER_INACTIVE");
  requireWorkshopAccess(user, input.workshopId);
  if (!user.nameInSheets.trim()) throw new KimeuError("Your staff display name is required.", 409, "AUTHOR_REQUIRED");
  return withKimeuLock(async sql => {
    const noteId = randomUUID(), created = new Date().toISOString(), email = normalizeEmail(input.clinicianEmail);
    const due = input.followUpDue?.toISOString().slice(0, 10) ?? null;
    if (due) {
      const privileges = await sql<{ allowed: boolean }[]>`
        select has_column_privilege(current_user, 'public.kimeu_clinician_notes', 'follow_up_due', 'INSERT') as allowed
      `;
      if (!privileges[0]?.allowed) throw new KimeuError("The database owner must enable the app's follow-up due-date input permission. No note was saved.", 503, "NOTE_DUE_PERMISSION_REQUIRED");
      await sql`
        insert into kimeu_clinician_notes
          (note_id, created, pt_email, note_type, workshop_id, session_id, note,
           follow_up_needed, follow_up_due, author, author_role, visibility, source)
        values (${noteId}, ${created}::timestamptz, ${email}, ${input.noteType},
          ${input.workshopId}, ${input.sessionId}, ${input.note}, ${input.followUpNeeded},
          ${due}::date, ${user.nameInSheets}, ${authorRole}, ${input.visibility}, 'sme_app')
      `;
    } else {
      await sql`
        insert into kimeu_clinician_notes
          (note_id, created, pt_email, note_type, workshop_id, session_id, note,
           follow_up_needed, author, author_role, visibility, source)
        values (${noteId}, ${created}::timestamptz, ${email}, ${input.noteType},
          ${input.workshopId}, ${input.sessionId}, ${input.note}, ${input.followUpNeeded},
          ${user.nameInSheets}, ${authorRole}, ${input.visibility}, 'sme_app')
      `;
    }
    const saved = await sql<{ note_id: string; note: string; visibility: string }[]>`
      select note_id, note, visibility from kimeu_clinician_notes where note_id = ${noteId}::uuid and deleted_at is null
    `;
    if (saved.length !== 1 || saved[0].note !== input.note || saved[0].visibility !== input.visibility) {
      throw new KimeuError("Note readback failed; the transaction was rolled back.", 503, "NOTE_READBACK_FAILED");
    }
    return { noteId, created, clinicianEmail: email, visibility: input.visibility };
  });
}
