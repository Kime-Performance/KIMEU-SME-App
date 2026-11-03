import { createHash, randomUUID } from "node:crypto";
import type { AppUser } from "../access";
import type { PracticalSignoff, PracticalScheduleInput } from "@workspace/api-zod";
import {
  formatSheetDate,
  formatSheetTimestamp,
  KimeuError,
  sessionIdFor,
  todayInAppTimeZone,
} from "../sheets";
import { isAssignedRd, validPracticalInput, validPracticalSchedule } from "../practical-rules";
import {
  K_STAR_WORKSHOP,
  mergeKStar,
  readKStar,
  validateKStar,
  type KStarEvidence,
} from "../k-star";
import { getSql, type Sql } from "./client";
import { withKimeuLock, withRead } from "./transaction";
import { assertInputHeader } from "./allowlist";

/**
 * Postgres data layer for RD practical sign-off, scheduling, and K-Star merge.
 * Mirrors lib/kimeu/practicals.ts (sheets) rule-for-rule against the canonical
 * Supabase tables. Only reached when KIMEU_DATA_SOURCE=postgres; the sheets
 * path is untouched.
 *
 * Table mapping:
 * - kimeu_workshops: workshop catalog (workshop_id, stage)
 * - kimeu_workshop_records: advanced/fellowship session records, one row per
 *   workshop_id + person_id + session_date
 * - kimeu_foundations_blocks: foundations per-person blocks keyed by
 *   person_id + workshop_id + block_index; the latest non-deleted block is
 *   the record of truth for practical sign-off
 * - kimeu_clinician_notes: append-only audit notes (review_id =
 *   RD:{recordKey}:{uuid}, schedules use RD:{recordKey}:SCHEDULE:{uuid})
 * - person / person_email_alias: roster identity joined onto foundations
 *   blocks so email aliases resolve to one clinician
 *
 * recordKey is identical to the sheets path:
 * sha256(JSON.stringify([workshopId, normalizedEmail, sessionDate])).
 */

const WORKSHOPS = "kimeu_workshops";
const RECORDS = "kimeu_workshop_records";
const BLOCKS = "kimeu_foundations_blocks";
const NOTES = "kimeu_clinician_notes";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const privileged = (user: AppUser) => user.roles.includes("Admin") || user.roles.includes("RD");

// Permission checks also live here so internal callers cannot bypass the route.
function assignedCourse(user: AppUser, workshopId: string) {
  if (!user.active || (!user.roles.includes("Admin") && !user.workshopIds.includes(workshopId))) {
    throw new KimeuError("This workshop is not assigned to your account.", 403, "WORKSHOP_NOT_ASSIGNED");
  }
}

type WorkshopRow = { workshop_id: string; stage: string | null };
type NoteRow = {
  id: string;
  created: unknown;
  author: string | null;
  note: string | null;
  review_id: string | null;
  visibility: string | null;
  pt_email: string | null;
};
type RecordRow = {
  person_id: string | null;
  block_index: number | null;
  pt_email: string | null;
  pt_name: string | null;
  rd: string | null;
  session_date: unknown;
  attended: unknown;
  practical_date: unknown;
  practical_result: string | null;
  scored_by: string | null;
  k_performed: unknown;
  k_stars: unknown;
  last_updated_by: string | null;
  last_updated: unknown;
};

type NoteHistoryEntry = { id: string; created: string; author: string; note: string };

type InternalRecord = {
  recordKey: string;
  revision: string;
  clinicianEmail: string;
  name: string;
  rd: string;
  sessionDate: string;
  attended: boolean;
  result: string;
  practicalDate: string;
  scheduledDate: string | null;
  scoredBy: string;
  eligible: boolean;
  history: NoteHistoryEntry[];
  kStarPerformed?: boolean | null;
  kStarStars?: number | null;
  kStarHighestEarned?: number | null;
  personId: string | null;
  blockIndex: number | null;
  foundation: boolean;
  kEvidence: KStarEvidence[];
};

type PublicRecord = Omit<InternalRecord, "personId" | "blockIndex" | "foundation" | "kEvidence">;
type PracticalWorkspace = {
  canSignOff: boolean;
  records: PublicRecord[];
  internal: InternalRecord[];
};

const text = (value: unknown): string => (value === null || value === undefined ? "" : String(value).trim());
const yesFlag = (value: unknown): boolean => value === true || text(value) === "Yes";
const dateText = (value: unknown): string =>
  value instanceof Date ? formatSheetDate(value.toISOString()) : formatSheetDate(text(value));
const kFlagText = (value: unknown): string =>
  value === true ? "TRUE" : value === false ? "FALSE" : text(value);
const lowerEmail = (value: unknown): string => text(value).toLowerCase();

async function load(user: AppUser, workshopId: string, sql: Sql): Promise<PracticalWorkspace> {
  assignedCourse(user, workshopId);
  const workshops = (await sql`
    select workshop_id, stage
    from kimeu_workshops
    where workshop_id = ${workshopId} and deleted_at is null
  `) as unknown as WorkshopRow[];
  if (workshops.length !== 1) {
    throw new KimeuError("The workshop could not be uniquely identified.", 409, "COURSE_AMBIGUOUS");
  }
  const stage = text(workshops[0].stage);
  const foundation = /foundation/i.test(stage);
  const supported = foundation || /fellowship|advanced|enrichment/i.test(stage);
  if (!supported) return { canSignOff: false, records: [], internal: [] };

  const rows = foundation
    ? ((await sql`
        select distinct on (b.person_id)
               b.person_id, b.block_index,
               b.session_date, b.attended_sme as attended,
               b.practical_date, b.practical_result,
               null::text as scored_by, null::text as k_performed, null::text as k_stars,
               coalesce(fp.rd, '') as rd,
               coalesce(p.full_name, '') as pt_name,
               coalesce(p.email, '') as pt_email,
               b.last_updated_by, b.last_updated
        from kimeu_foundations_blocks b
        join person p on p.person_id = b.person_id
        left join kimeu_foundations_pt fp on fp.person_id = b.person_id and fp.deleted_at is null
        where b.workshop_id = ${workshopId} and b.deleted_at is null
        order by b.person_id, b.block_index desc
      `) as unknown as RecordRow[])
    : ((await sql`
        select r.person_id, null::int as block_index,
               r.pt_email, r.pt_name, coalesce(r.rd, '') as rd,
               r.session_date, r.attended,
               r.practical_date, r.practical_result,
               r.practical_scored_by as scored_by,
               r.k_star_test_performed as k_performed, r.k_star_stars_earned as k_stars,
               r.last_updated_by, r.last_updated
        from kimeu_workshop_records r
        where r.workshop_id = ${workshopId} and r.deleted_at is null
      `) as unknown as RecordRow[]);

  const noteRows = (await sql`
    select note_id as id, created, author, note,
           review_id, visibility, pt_email
    from kimeu_clinician_notes
    where workshop_id = ${workshopId} and deleted_at is null
    order by created asc, note_id asc
  `) as unknown as NoteRow[];

  const isKStar = workshopId === K_STAR_WORKSHOP;
  const records: InternalRecord[] = [];
  for (const row of rows) {
    const email = lowerEmail(row.pt_email);
    const sessionDate = dateText(row.session_date);
    if (!email || !sessionDate) continue;
    const rd = text(row.rd);
    // RD-only accounts see only PTs explicitly assigned to them. No regional
    // inference from names, and blank RD assignments never grant sign-off.
    if (user.roles.includes("RD") && !user.roles.includes("Admin") &&
        !isAssignedRd(rd, user.nameInSheets, user.email)) continue;
    const recordKey = hash([workshopId, email, sessionDate]);
    const matchingNotes = noteRows.filter(n =>
      lowerEmail(n.pt_email) === email && text(n.review_id).startsWith(`RD:${recordKey}:`));
    const history = matchingNotes.filter(n =>
      text(n.visibility) === "All" ||
      user.roles.includes("Admin") ||
      text(n.author) === user.nameInSheets)
      .map(n => ({
        id: text(n.id),
        created: n.created instanceof Date ? n.created.toISOString() : text(n.created),
        author: text(n.author),
        note: text(n.note),
      })).reverse();
    const scheduleNote = matchingNotes.filter(n =>
      text(n.review_id).startsWith(`RD:${recordKey}:SCHEDULE:`)).at(-1);
    const scheduledDate = scheduleNote
      ? /^Practical scheduled: (\d{4}-\d{2}-\d{2})\.$/.exec(text(scheduleNote.note))?.[1] ?? null
      : null;
    const signoffNotes = matchingNotes.filter(n =>
      !text(n.review_id).startsWith(`RD:${recordKey}:SCHEDULE:`));
    const attended = yesFlag(row.attended);
    let kEvidence: KStarEvidence[] = [];
    let kSaved: KStarEvidence | null = null;
    let kStarHighestEarned: number | null = null;
    if (isKStar) {
      const evidenceRows = (await sql`
        select k_star_test_performed as performed, k_star_stars_earned as stars
        from kimeu_workshop_records
        where workshop_id = ${K_STAR_WORKSHOP} and lower(pt_email) = ${email} and deleted_at is null
      `) as unknown as Array<{ performed: unknown; stars: unknown }>;
      kEvidence = evidenceRows.map(r => readKStar(kFlagText(r.performed), text(r.stars)));
      kSaved = readKStar(kFlagText(row.k_performed), text(row.k_stars));
      const earned = kEvidence.flatMap(e => (e.performed && e.stars !== null && e.stars > 0 ? [e.stars] : []));
      kStarHighestEarned = earned.length ? Math.max(...earned) : null;
    }
    const revision = hash([
      row.person_id, row.block_index, email, sessionDate, rd, yesFlag(row.attended),
      dateText(row.practical_date), text(row.practical_result), text(row.scored_by),
      kFlagText(row.k_performed), text(row.k_stars),
      text(row.last_updated_by), text(row.last_updated),
      matchingNotes.map(n => text(n.id)),
      kEvidence,
    ]);
    records.push({
      recordKey,
      revision,
      clinicianEmail: email,
      name: text(row.pt_name),
      rd,
      sessionDate,
      attended,
      result: text(row.practical_result),
      practicalDate: dateText(row.practical_date),
      scheduledDate,
      scoredBy: text(row.scored_by) ||
        (signoffNotes.length ? text(signoffNotes[signoffNotes.length - 1].author) : ""),
      eligible: attended && sessionDate <= todayInAppTimeZone(),
      history,
      ...(kSaved
        ? { kStarPerformed: kSaved.performed, kStarStars: kSaved.stars, kStarHighestEarned }
        : {}),
      personId: row.person_id,
      blockIndex: row.block_index,
      foundation,
      kEvidence,
    });
  }
  if (new Set(records.map(r => r.recordKey)).size !== records.length) {
    throw new KimeuError("Duplicate clinician/workshop/date records must be resolved before sign-off.", 409, "PRACTICAL_DUPLICATE");
  }
  return {
    canSignOff: privileged(user),
    records: records.map(({ personId: _p, blockIndex: _b, foundation: _f, kEvidence: _e, ...record }) => record),
    internal: records,
  };
}

export async function getPracticals(user: AppUser, workshopId: string) {
  const { internal: _internal, ...workspace } = await withRead(sql => load(user, workshopId, sql));
  return workspace;
}

export async function savePracticalSchedule(user: AppUser, workshopId: string, input: PracticalScheduleInput) {
  assignedCourse(user, workshopId);
  if (!privileged(user)) throw new KimeuError("Only an assigned RD or Admin can schedule a practical.", 403, "ROLE_NOT_ALLOWED");
  if (!user.nameInSheets.trim()) throw new KimeuError("Your Name in Sheets is required.", 409, "AUTHOR_NAME_REQUIRED");
  return withKimeuLock(async (tx) => {
    const current = await load(user, workshopId, tx);
    const record = current.internal.find(r => r.recordKey === input.recordKey);
    if (!record) throw new KimeuError("This practical is not assigned to you or is no longer available.", 403, "PRACTICAL_NOT_ASSIGNED");
    if (record.revision !== input.revision) throw new KimeuError("This record changed. Review its latest values before scheduling.", 409, "PRACTICAL_CHANGED");
    const error = validPracticalSchedule(input.scheduledDate, record.sessionDate, todayInAppTimeZone());
    if (error) throw new KimeuError(error, 400, "INVALID_PRACTICAL_SCHEDULE");
    const noteId = randomUUID();
    const noteText = input.scheduledDate
      ? `Practical scheduled: ${input.scheduledDate}.`
      : "Practical schedule cleared.";
    await insertNote(tx, {
      noteId,
      created: new Date().toISOString(),
      clinicianEmail: record.clinicianEmail,
      noteType: "Practical scheduling",
      workshopId,
      sessionId: sessionIdFor(workshopId, record.sessionDate),
      reviewId: `RD:${record.recordKey}:SCHEDULE:${noteId}`,
      note: noteText,
      followUp: false,
      author: user.nameInSheets,
      authorRole: user.roles.includes("RD") ? "RD" : "Admin",
    });
    const result = await load(user, workshopId, tx);
    const saved = result.records.find(r => r.recordKey === input.recordKey);
    if (!saved || saved.scheduledDate !== input.scheduledDate || !saved.history.some(n => n.id === noteId)) {
      throw new KimeuError("The schedule was sent but could not be confirmed. Review saved values before retrying.", 503, "PRACTICAL_SCHEDULE_READBACK_FAILED");
    }
    return { canSignOff: result.canSignOff, records: result.records };
  });
}

export async function savePractical(user: AppUser, workshopId: string, input: PracticalSignoff) {
  assignedCourse(user, workshopId);
  if (!privileged(user)) throw new KimeuError("Only an assigned RD or Admin can sign off a practical.", 403, "ROLE_NOT_ALLOWED");
  if (!user.nameInSheets.trim()) throw new KimeuError("Your Name in Sheets is required for sign-off.", 409, "AUTHOR_NAME_REQUIRED");
  const hasKStar = validateKStar(workshopId, input.kStarPerformed, input.kStarStars);
  return withKimeuLock(async (tx) => {
    const current = await load(user, workshopId, tx);
    const record = current.internal.find(r => r.recordKey === input.recordKey);
    if (!record) throw new KimeuError("This practical is not assigned to you or is no longer available.", 403, "PRACTICAL_NOT_ASSIGNED");
    if (record.revision !== input.revision) throw new KimeuError("This record changed. Reload and review it before saving again.", 409, "PRACTICAL_CHANGED");
    if (!record.eligible) throw new KimeuError("Confirmed workshop attendance is required before post-workshop sign-off.", 409, "ATTENDANCE_REQUIRED");
    const error = validPracticalInput(input.result, input.practicalDate, input.notes, record.sessionDate, todayInAppTimeZone());
    if (error) throw new KimeuError(error, 400, "INVALID_PRACTICAL");
    const timestamp = workshopId === K_STAR_WORKSHOP ? new Date().toISOString() : formatSheetTimestamp();
    const kStar = hasKStar ? mergeKStar(record.kEvidence, input.kStarPerformed!, input.kStarStars ?? null) : null;
    const noteId = randomUUID();
    if (record.foundation) {
      for (const column of ["practical_date", "practical_result", "last_updated_by", "last_updated"]) {
        assertInputHeader(BLOCKS, column);
      }
      // Sign-off lands on the latest non-deleted block for the person/workshop.
      await tx`
        update kimeu_foundations_blocks
        set practical_date = ${input.practicalDate},
            practical_result = ${input.result},
            last_updated_by = ${user.nameInSheets},
            last_updated = ${timestamp}
        where person_id = ${record.personId}
          and workshop_id = ${workshopId}
          and block_index = ${record.blockIndex}
          and deleted_at is null
      `;
    } else {
      const columns = [
        "practical_date", "practical_result", "practical_scored_by",
        "last_updated_by", "last_updated",
        ...(kStar ? ["k_star_test_performed", "k_star_stars_earned"] : []),
      ];
      for (const column of columns) assertInputHeader(RECORDS, column);
      if (kStar) {
        await tx`
          update kimeu_workshop_records
          set practical_date = ${input.practicalDate},
              practical_result = ${input.result},
              practical_scored_by = ${user.nameInSheets},
              last_updated_by = ${user.nameInSheets},
              last_updated = ${timestamp},
              k_star_test_performed = ${kStar.performed},
              k_star_stars_earned = ${kStar.stars === null ? null : kStar.stars}
          where workshop_id = ${workshopId}
            and session_date = ${record.sessionDate}
            and (person_id = ${record.personId} or lower(pt_email) = ${record.clinicianEmail})
            and deleted_at is null
        `;
      } else {
        await tx`
          update kimeu_workshop_records
          set practical_date = ${input.practicalDate},
              practical_result = ${input.result},
              practical_scored_by = ${user.nameInSheets},
              last_updated_by = ${user.nameInSheets},
              last_updated = ${timestamp}
          where workshop_id = ${workshopId}
            and session_date = ${record.sessionDate}
            and (person_id = ${record.personId} or lower(pt_email) = ${record.clinicianEmail})
            and deleted_at is null
        `;
      }
    }
    await insertNote(tx, {
      noteId,
      created: timestamp,
      clinicianEmail: record.clinicianEmail,
      noteType: "Practical feedback",
      workshopId,
      sessionId: sessionIdFor(workshopId, record.sessionDate),
      reviewId: `RD:${record.recordKey}:${noteId}`,
      note: `${input.result === "Pass" ? "Passed" : "Not passed"} — ${input.practicalDate}${input.notes.trim() ? `\n${input.notes.trim()}` : ""}${kStar ? `\nK-Star submitted: performed=${input.kStarPerformed}, stars=${input.kStarStars ?? "blank"}; retained: performed=${kStar.performed}, stars=${kStar.stars ?? "blank"}.` : ""}`,
      followUp: input.result === "Fail",
      author: user.nameInSheets,
      authorRole: user.roles.includes("RD") ? "RD" : "Admin",
    });
    const result = await load(user, workshopId, tx);
    const saved = result.records.find(r => r.recordKey === record.recordKey);
    if (!saved || saved.result !== input.result || saved.practicalDate !== input.practicalDate ||
        (kStar && (saved.kStarPerformed !== kStar.performed || saved.kStarStars !== kStar.stars)) ||
        !saved.history.some(n => n.id === noteId)) {
      throw new KimeuError("The save was sent but could not be confirmed. Refresh before retrying.", 503, "PRACTICAL_READBACK_FAILED");
    }
    return { canSignOff: result.canSignOff, records: result.records };
  });
}

type NoteInsert = {
  noteId: string;
  created: string;
  clinicianEmail: string;
  noteType: string;
  workshopId: string;
  sessionId: string;
  reviewId: string;
  note: string;
  followUp: boolean;
  author: string;
  authorRole: string;
};

async function insertNote(tx: Sql, input: NoteInsert): Promise<void> {
  const columns = [
    "note_id", "created", "pt_email", "note_type", "workshop_id", "session_id",
    "review_id", "note", "follow_up_needed", "author", "author_role", "visibility",
  ];
  for (const column of columns) assertInputHeader(NOTES, column);
  await tx`
    insert into kimeu_clinician_notes
      (note_id, created, pt_email, note_type, workshop_id, session_id,
       review_id, note, follow_up_needed, author, author_role, visibility, source)
    values
      (${input.noteId}, ${input.created}, ${input.clinicianEmail}, ${input.noteType},
       ${input.workshopId}, ${input.sessionId}, ${input.reviewId}, ${input.note},
       ${input.followUp}, ${input.author}, ${input.authorRole}, 'Aaron + author', 'sme_app')
  `;
}

// Referenced so tree-shakers keep the table-name constants meaningful for readers.
export const PRACTICAL_TABLES = { WORKSHOPS, RECORDS, BLOCKS, NOTES } as const;

// getSql is re-exported for module tests that verify lazy initialization stays intact.
export { getSql };
