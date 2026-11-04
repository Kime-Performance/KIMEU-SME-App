import { createHash, randomUUID } from "node:crypto";
import type { OnboardingInput } from "@workspace/api-zod";
import { requireRole, type AppUser } from "../access";
import { isAssignedRd } from "../practical-rules";
import { onboardingWeeks, validateOnboardingUnit } from "../onboarding-rules";
import { isRdAttendanceOnly } from "../courses";
import { KimeuError, normalizeEmail, todayInAppTimeZone } from "../sheets";
import type { Sql } from "./client";
import { withKimeuLock, withRead } from "./transaction";
import { assertInputHeader } from "./allowlist";

const ONBOARDING_TABLE = "kimeu_rd_onboarding";
const NOTES_TABLE = "kimeu_clinician_notes";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Canonical snake_case column contract for the tables; asserted before any write.
const UNIT_HEADERS = [
  "record_id", "pt_email", "workshop_id", "week", "session_date", "minutes",
  "attended", "rd_result", "signed_by", "signed_at", "notes", "last_updated_by", "last_updated",
] as const;
const NOTE_HEADERS = [
  "note_id", "created", "pt_email", "note_type", "workshop_id", "review_id", "note",
  "author", "author_role", "visibility",
] as const;

type RosterRow = { person_id: string; email: string; name: string; assigned_rd: string | null };
type OnboardingRow = {
  record_id: string; person_id: string | null; pt_email: string | null; workshop_id: string | null;
  week: number | null; session_date: string | null; minutes: number | null;
  attended: boolean | null; rd_result: string | null; signed_by: string | null;
  signed_at: string | null; notes: string | null;
  completed_weeks: number | null; course_status: string | null;
};

async function loadWorkspace(q: Sql, user: AppUser, courseId: string) {
  if (!user.active) throw new KimeuError("Your staff access is inactive.", 403, "APP_USER_INACTIVE");
  requireRole(user, "RD");
  const requiredWeeks = onboardingWeeks(courseId);
  // Roster directory: active clinical PTs from the person spine (aliases resolve
  // to person.email upstream) with the assigned RD from kimeu_foundations_pt.
  const roster = await q<RosterRow[]>`
    select p.person_id, p.email, p.full_name as name, fp.rd as assigned_rd
    from person p
    left join kimeu_foundations_pt fp
      on fp.person_id = p.person_id and fp.deleted_at is null
    where p.active
      and p.email is not null
      and exists (
        -- kimeu_roster = sheet-maintained 01-PT Roster membership (keeps exec
        -- founders and non-clinical staff out of the clinical roster).
        select 1 from providers pr
        where pr.person_id = p.person_id and pr.status = 'active'
          and pr.kimeu_roster
      )
    order by p.full_name
  `;
  const rows = await q<OnboardingRow[]>`
    select record_id, person_id, pt_email, workshop_id, week,
           to_char(session_date, 'YYYY-MM-DD') as session_date,
           minutes, attended, rd_result, signed_by, signed_at::text as signed_at,
           notes, completed_weeks, course_status
    from kimeu_rd_onboarding
    where workshop_id = ${courseId} and deleted_at is null
    order by week
  `;
  const people = roster.flatMap(row => {
    const assigned = row.assigned_rd ?? "";
    if (!user.roles.includes("Admin") && !isAssignedRd(assigned, user.nameInSheets, user.email)) return [];
    const person = { personId: row.person_id, email: normalizeEmail(row.email), name: row.name, location: "" };
    const own = rows.filter(r => normalizeEmail(r.pt_email ?? "") === person.email);
    if (new Set(own.map(r => r.week)).size !== own.length) {
      throw new KimeuError("Duplicate onboarding week records need review.", 409, "ONBOARDING_DUPLICATE");
    }
    const units = Array.from({ length: requiredWeeks }, (_, i) => {
      const record = own.find(r => Number(r.week) === i + 1);
      const mayReadNotes = !record || user.roles.includes("Admin") ||
        normalizeEmail(record.signed_by ?? "") === user.email;
      return {
        week: i + 1,
        date: record?.session_date ?? "",
        attended: record?.attended === true,
        result: record?.rd_result ?? "",
        notes: record && mayReadNotes ? record.notes ?? "" : "",
        signedBy: record?.signed_by ?? "",
        signedAt: record?.signed_at ?? "",
      };
    });
    // Completion mirrors the sheet formula columns; until the SQL status views
    // own computation, fall back to the sheets guard behavior.
    const latest = [...own].sort((a, b) => Number(a.week) - Number(b.week)).at(-1);
    const count = latest?.completed_weeks;
    return [{
      ...person,
      revision: hash([courseId, person, assigned, own]),
      completedWeeks: Number.isInteger(count) && Number(count) >= 0 && Number(count) <= requiredWeeks ? Number(count) : 0,
      sheetStatus: latest?.course_status ?? "Not started",
      units,
    }];
  });
  return { courseId, requiredWeeks, canSignOff: true, people };
}

export async function getOnboarding(user: AppUser, courseId: string) {
  return withRead(q => loadWorkspace(q, user, courseId));
}

export async function saveOnboarding(user: AppUser, courseId: string, input: OnboardingInput) {
  requireRole(user, "RD");
  if (!user.nameInSheets.trim()) throw new KimeuError("Your Name in Sheets is required.", 409, "AUTHOR_REQUIRED");
  return withKimeuLock(async (tx) => {
    const state = await loadWorkspace(tx, user, courseId);
    const email = normalizeEmail(input.email);
    const person = state.people.find(p => p.email === email);
    if (!person) throw new KimeuError("This PT is unavailable or is not assigned to you.", 403, "PT_NOT_ASSIGNED");
    if (person.revision !== input.revision) {
      throw new KimeuError("This PT's record changed. Reload before saving.", 409, "ONBOARDING_CHANGED");
    }
    validateOnboardingUnit(input, courseId, todayInAppTimeZone(), person.units);
    for (const header of UNIT_HEADERS) assertInputHeader(ONBOARDING_TABLE, header);
    for (const header of NOTE_HEADERS) assertInputHeader(NOTES_TABLE, header);
    const recordId = `${courseId}:${email}:W${input.week}`;
    const timestamp = new Date();
    const minutes = input.attended && courseId === "F-12" ? 60 : 0;
    const signedAt = input.result || isRdAttendanceOnly(courseId) ? timestamp : null;
    // Upsert by immutable record_id; re-saves of the same week update in place.
    await tx`
      insert into kimeu_rd_onboarding (
        record_id, person_id, pt_email, workshop_id, week, session_date, minutes,
        attended, rd_result, signed_by, signed_at, notes,
        last_updated_by, last_updated, source, synced_at
      ) values (
        ${recordId}, ${person.personId}, ${email}, ${courseId}, ${input.week}, ${input.date},
        ${minutes}, ${input.attended}, ${input.result || null}, ${user.email}, ${signedAt},
        ${input.notes.trim()}, ${user.email}, ${timestamp}, 'sme_app', ${timestamp}
      )
      on conflict (record_id) do update set
        person_id = excluded.person_id,
        pt_email = excluded.pt_email,
        workshop_id = excluded.workshop_id,
        week = excluded.week,
        session_date = excluded.session_date,
        minutes = excluded.minutes,
        attended = excluded.attended,
        rd_result = excluded.rd_result,
        signed_by = excluded.signed_by,
        signed_at = excluded.signed_at,
        notes = excluded.notes,
        last_updated_by = excluded.last_updated_by,
        last_updated = excluded.last_updated,
        source = excluded.source,
        synced_at = excluded.synced_at,
        deleted_at = null
    `;
    await tx`
      insert into kimeu_clinician_notes (
        note_id, person_id, created, pt_email, note_type, workshop_id, review_id, note,
        author, author_role, visibility, source, synced_at
      ) values (
        ${randomUUID()}, ${person.personId}, ${timestamp}, ${email}, 'General', ${courseId},
        ${`RD onboarding:${recordId}:${randomUUID()}`},
        ${JSON.stringify({ week: input.week, date: input.date, attended: input.attended, minutes, result: input.result, notes: input.notes.trim() })},
        ${user.nameInSheets}, ${user.roles.includes("Admin") ? "Admin" : "RD"},
        'Aaron + author', 'sme_app', ${timestamp}
      )
    `;
    // Readback the saved unit before reporting success.
    const back = (await tx<OnboardingRow[]>`
      select record_id, person_id, pt_email, workshop_id, week,
             to_char(session_date, 'YYYY-MM-DD') as session_date,
             minutes, attended, rd_result, signed_by, signed_at::text as signed_at,
             notes, completed_weeks, course_status
      from kimeu_rd_onboarding
      where record_id = ${recordId} and deleted_at is null
    `)[0];
    if (!back || back.session_date !== input.date || (back.attended === true) !== input.attended ||
        (back.rd_result ?? "") !== input.result || (back.notes ?? "") !== input.notes.trim()) {
      throw new KimeuError("The save could not be confirmed. Reload before retrying.", 503, "ONBOARDING_READBACK_FAILED");
    }
    return loadWorkspace(tx, user, courseId);
  });
}
