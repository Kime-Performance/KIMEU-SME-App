import { createHash } from "node:crypto";
import type { CourseTrackingInput } from "@workspace/api-zod";
import type { AppUser } from "../access";
import { ownPersonId, unrestrictedCourseRead } from "../auth/data-scope";
import type { Sql } from "./client";
import { withKimeuLock, withRead } from "./transaction";
import { readRoster } from "./directory";
import { findCourse } from "./catalog";
import { canLeadStage, canonicalRole } from "../site-access-policy";
import { isRdOnboarding } from "../courses";
import { validateTrackingDate } from "../course-tracking";
import { KimeuError, normalizeEmail, sessionIdFor, todayInAppTimeZone } from "../sheets";

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
type RecordRow = {
  key: string; person_id: string; block_index: number | null; session_date: string | null;
  attended: boolean | null; practical_result: string | null; percent: string | number | null; status: string | null;
};
function authorize(user: AppUser, workshopId: string) {
  if (user.active && unrestrictedCourseRead(user)) return;
  if (!user.active || (!user.roles.includes("Admin") && !user.workshopIds.includes(workshopId))) {
    throw new KimeuError("This workshop is not assigned to your account.", 403, "WORKSHOP_NOT_ASSIGNED");
  }
}

async function load(sql: Sql, user: AppUser, workshopId: string, date: string) {
  authorize(user, workshopId);
  validateTrackingDate(date);
  if (isRdOnboarding(workshopId)) throw new KimeuError("Use the RD onboarding page.", 409, "USE_RD_ONBOARDING");
  const course = await findCourse(sql, workshopId);
  const foundation = /foundation/i.test(course.stage);
  if (!foundation && !/fellowship|advanced|enrichment/i.test(course.stage)) {
    throw new KimeuError("This workshop has no supported tracking pathway.", 409, "UNSUPPORTED_STAGE");
  }
  const personId = ownPersonId(user);
  const roster = await readRoster(sql, personId);
  const sessions = await sql<{ session_id: string; session_status: string | null }[]>`
    select session_id, session_status from kimeu_sessions
    where session_id = ${sessionIdFor(workshopId, date)} and deleted_at is null
  `;
  if (sessions.length > 1) throw new KimeuError("Duplicate sessions require review.", 409, "SESSION_DUPLICATE");
  const records: RecordRow[] = foundation
    ? await sql<RecordRow[]>`
      select distinct on (b.person_id) b.block_id::text as key, b.person_id, b.block_index,
        to_char(b.session_date, 'YYYY-MM-DD') as session_date, b.attended_sme as attended,
        b.practical_result, fp.kajabi_course_pct as percent, null::text as status
      from kimeu_foundations_blocks b
      left join kimeu_foundations_pt fp on fp.person_id = b.person_id and fp.deleted_at is null
      where b.workshop_id = ${workshopId} and b.deleted_at is null
        and (${personId}::uuid is null or b.person_id = ${personId}::uuid)
      order by b.person_id, b.block_index desc
    `
    : await sql<RecordRow[]>`
      select record_id as key, person_id, null::int as block_index,
        to_char(session_date, 'YYYY-MM-DD') as session_date, attended, practical_result,
        kajabi_progress_pct as percent, workshop_status as status
      from kimeu_workshop_records
      where workshop_id = ${workshopId} and session_date = ${date}::date and deleted_at is null
        and (${personId}::uuid is null or person_id = ${personId}::uuid)
    `;
  const byPerson = new Map<string, RecordRow>();
  for (const record of records) {
    if (byPerson.has(record.person_id)) throw new KimeuError("Duplicate PT tracking records require review.", 409, "TRACKING_DUPLICATE");
    byPerson.set(record.person_id, record);
  }
  const people = roster.map(person => {
    const record = byPerson.get(person.personId);
    const matches = record?.session_date === date;
    const attended = matches && record?.attended === true;
    const practicalPassed = matches && record?.practical_result === "Pass";
    return {
      ...person, record, attended, practicalPassed,
      preCourseComplete: record?.percent != null && String(record.percent).trim() !== "" &&
        Number.isFinite(Number(record.percent)) && Number(record.percent) >= 100,
      sheetStatus: matches ? (foundation
        ? attended && practicalPassed ? "Complete" : attended || practicalPassed ? "In Progress" : "Not Started"
        : record?.status ?? "") : "",
    };
  });
  const sessionStatus = sessions[0]?.session_status ?? "";
  const revision = hash([workshopId, date, roster.map(p => [p.personId, p.email]),
    people.map(p => [p.personId, p.record?.key, p.record?.session_date, p.record?.attended]), sessionStatus]);
  const workspace = {
    sessionDate: date, revision,
    canSaveAttendance: !personId && (canLeadStage(user.roles, course.stage) ||
      (!!user.authorization && user.roles.includes("CEU Admin"))) &&
      !["Complete", "Cancelled"].includes(sessionStatus) && date <= todayInAppTimeZone(),
    rosterRefreshedAt: new Date().toISOString(),
    people: people.map(({ personId: _id, assignedRd: _rd, record: _record, ...p }) => p),
  };
  return { workspace, people, foundation, sessionStatus };
}

export async function getCourseTracking(user: AppUser, workshopId: string, date: string) {
  return withRead(async sql => (await load(sql, user, workshopId, date)).workspace);
}

export async function saveCourseTracking(user: AppUser, workshopId: string, input: CourseTrackingInput) {
  authorize(user, workshopId);
  if (input.kind !== "attendance") throw new KimeuError("Completion is calculated, not manually approved.", 400, "COMPLETION_DATABASE_OWNED");
  if (!user.roles.map(canonicalRole).some(r => ["Admin", "SME Assist", "SME Lead",
      ...(user.authorization ? ["CEU Admin"] : [])].includes(r))) {
    throw new KimeuError("Only an assigned SME or administrator can record attendance.", 403, "ROLE_NOT_ALLOWED");
  }
  if (!user.nameInSheets.trim()) throw new KimeuError("Your staff display name is required.", 409, "AUTHOR_REQUIRED");
  return withKimeuLock(async sql => {
    const state = await load(sql, user, workshopId, input.sessionDate);
    if (state.workspace.revision !== input.revision) throw new KimeuError("Attendance changed. Reload before saving.", 409, "TRACKING_CHANGED");
    if (!state.workspace.canSaveAttendance) throw new KimeuError("Attendance is read-only for this session.", 409, "ATTENDANCE_READ_ONLY");
    const emails = input.marks.map(m => normalizeEmail(m.email));
    if (new Set(emails).size !== emails.length) throw new KimeuError("A PT can only appear once per save.", 400, "DUPLICATE_MARK");
    const selections = input.marks.map(mark => {
      const person = state.people.find(p => p.email === normalizeEmail(mark.email));
      if (!person) throw new KimeuError("A selected PT is no longer on the eligible roster.", 409, "PT_NOT_AVAILABLE");
      if (state.foundation && person.record?.session_date && person.record.session_date !== input.sessionDate) {
        throw new KimeuError("Existing Foundations attendance on another date will not be overwritten.", 409, "FOUNDATIONS_DATE_CONFLICT");
      }
      return { person, checked: mark.checked };
    });
    // Determine the canonical course block position from existing shared records.
    let blockIndex = 0;
    if (state.foundation && selections.some(s => !s.person.record && s.checked)) {
      const positions = await sql<{ block_index: number }[]>`
        select distinct block_index from kimeu_foundations_blocks
        where workshop_id = ${workshopId} and deleted_at is null
      `;
      if (positions.length !== 1) throw new KimeuError("The canonical Foundations block position requires schema-owner review.", 409, "FOUNDATIONS_BLOCK_MISSING");
      blockIndex = positions[0].block_index;
    }
    const sessionId = sessionIdFor(workshopId, input.sessionDate);
    await sql`
      insert into kimeu_sessions
        (session_id, workshop_id, session_date, lead_sme, session_status, last_updated_by, last_updated, source)
      values (${sessionId}, ${workshopId}, ${input.sessionDate}::date, ${user.nameInSheets},
        'Live', ${user.nameInSheets}, now(), 'sme_app')
      on conflict (session_id) do nothing
    `;
    const live = await sql<{ session_id: string }[]>`
      update kimeu_sessions set session_status = 'Live', last_updated_by = ${user.nameInSheets}, last_updated = now()
      where session_id = ${sessionId} and workshop_id = ${workshopId}
        and session_date = ${input.sessionDate}::date and deleted_at is null
        and coalesce(session_status, 'Scheduled') in ('Scheduled', 'Live')
      returning session_id
    `;
    if (live.length !== 1) throw new KimeuError("This session is closed or inconsistent.", 409, "SESSION_CLOSED");
    for (const { person, checked } of selections) {
      if (!person.record && !checked) continue;
      if (state.foundation) {
        if (person.record) {
          const updated = await sql<{ block_id: string }[]>`
            update kimeu_foundations_blocks
            set session_date = ${input.sessionDate}::date, attended_sme = ${checked},
              last_updated_by = ${user.nameInSheets}, last_updated = now()
            where block_id = ${person.record.key}::uuid and person_id = ${person.personId}::uuid
              and workshop_id = ${workshopId} and deleted_at is null returning block_id
          `;
          if (updated.length !== 1) throw new KimeuError("Attendance record changed or is not writable.", 409, "TRACKING_CHANGED");
        } else {
          await sql`
            insert into kimeu_foundations_blocks
              (person_id, workshop_id, block_index, session_date, attended_sme, last_updated_by, last_updated, source)
            values (${person.personId}::uuid, ${workshopId}, ${blockIndex},
              ${input.sessionDate}::date, ${checked}, ${user.nameInSheets}, now(), 'sme_app')
          `;
        }
      } else if (person.record) {
        const updated = await sql<{ record_id: string }[]>`
          update kimeu_workshop_records
          set attended = ${checked}, attendance_confirmed_by = ${user.nameInSheets},
            last_updated_by = ${user.nameInSheets}, last_updated = now()
          where record_id = ${person.record.key} and person_id = ${person.personId}::uuid
            and workshop_id = ${workshopId} and session_date = ${input.sessionDate}::date
            and deleted_at is null returning record_id
        `;
        if (updated.length !== 1) throw new KimeuError("Attendance record changed or is not writable.", 409, "TRACKING_CHANGED");
      } else {
        await sql`
          insert into kimeu_workshop_records
            (record_id, person_id, pt_email, pt_name, workshop_id, session_date, attended,
             attendance_confirmed_by, last_updated_by, last_updated, source)
          values (${hash([workshopId, person.personId, input.sessionDate])}, ${person.personId}::uuid,
            ${person.email}, ${person.name}, ${workshopId}, ${input.sessionDate}::date,
            ${checked}, ${user.nameInSheets}, ${user.nameInSheets}, now(), 'sme_app')
        `;
      }
    }
    const result = (await load(sql, user, workshopId, input.sessionDate)).workspace;
    if (selections.some(s => result.people.find(p => p.email === s.person.email)?.attended !== s.checked)) {
      throw new KimeuError("Attendance readback failed; the transaction was rolled back.", 503, "TRACKING_READBACK_FAILED");
    }
    return { ...result, savedCount: selections.length };
  });
}
