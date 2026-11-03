import { randomUUID } from "node:crypto";
import { getSql } from "./client";
import { withKimeuLock } from "./transaction";
import { assertInputHeader } from "./allowlist";
import {
  formatSheetDate,
  formatSheetTimestamp,
  KimeuError,
  normalizeEmail,
  sessionIdFor,
  todayInAppTimeZone,
} from "../sheets";
import type { AppUser } from "../access";

/**
 * Postgres data-layer slice for SME App sessions + live attendance.
 * Mirrors the shapes returned by ../sessions.ts (the Google Sheets path) so
 * the HTTP routes stay identical; sheet-only concepts (rowNumber,
 * attendedColumn) are preserved structurally but carry no meaning here.
 */

type SessionStatus = "Scheduled" | "Live" | "Complete" | "Cancelled";
type SessionRecord = {
  /** Unused in Postgres mode (kept for structural parity with the sheets path). */
  rowNumber: number;
  sessionId: string;
  workshopId: string;
  workshopName: string;
  stage: string;
  sessionDate: string;
  startTime: string | null;
  location: string | null;
  leadSme: string | null;
  sessionStatus: SessionStatus;
  sessionNotes: string;
  changesForNextSession: string;
};
type RosterPerson = {
  clinicianEmail: string;
  name: string;
  attended: "Yes" | "No" | null;
  sourceTab: "03b-Advanced Workshop Log" | "03c-Foundations Tracker";
  computedStatus: string | null;
  practicalStatus: string | null;
  /** Unused in Postgres mode (structural parity only). */
  rowNumber: number;
  /** Unused in Postgres mode (structural parity only). */
  attendedColumn: number;
  sessionDateColumn?: number;
};
type SessionSummary = Omit<
  SessionRecord,
  "rowNumber" | "sessionNotes" | "changesForNextSession" | "stage"
> & {
  stage: string | null;
  rosterCount: number;
  presentCount: number;
  absentCount: number;
  unmarkedCount: number;
};

const VALID_STATUSES: SessionStatus[] = ["Scheduled", "Live", "Complete", "Cancelled"];

type SessionRow = {
  session_id: string;
  workshop_id: string;
  workshop_name: string | null;
  stage: string | null;
  session_date: string;
  start_time: string | null;
  location: string | null;
  lead_sme: string | null;
  session_status: string;
  session_notes: string | null;
  changes_for_next_session: string | null;
};

function sessionRecordFromRow(row: SessionRow): SessionRecord {
  const sessionStatus = row.session_status as SessionStatus;
  if (!VALID_STATUSES.includes(sessionStatus)) {
    throw new KimeuError(
      "The session has an invalid Session Status value in the database.",
      409,
      "INVALID_SESSION_STATUS",
    );
  }
  const sessionDate = formatSheetDate(row.session_date ?? "");
  return {
    rowNumber: 0,
    sessionId: row.session_id || sessionIdFor(row.workshop_id, sessionDate),
    workshopId: row.workshop_id,
    workshopName: row.workshop_name ?? "",
    stage: row.stage ?? "",
    sessionDate,
    startTime: row.start_time || null,
    location: row.location || null,
    leadSme: row.lead_sme || null,
    sessionStatus,
    sessionNotes: row.session_notes ?? "",
    changesForNextSession: row.changes_for_next_session ?? "",
  };
}

// NOTE: the session SELECT is written out in full at each call site.
// postgres.js only inlines nested sql`` fragments; interpolating a plain
// string constant would silently become a bind parameter ($1).
export async function getSessionRecord(
  sessionId: string,
  _force = false,
): Promise<SessionRecord> {
  const sql = getSql();
  const rows = await sql<SessionRow[]>`
    select
      s."Session ID" as session_id,
      s."Workshop ID" as workshop_id,
      coalesce(w."Workshop Name", '') as workshop_name,
      coalesce(w."Stage", '') as stage,
      s."Session Date"::text as session_date,
      s."Start Time" as start_time,
      s."Location" as location,
      s."Lead SME" as lead_sme,
      s."Session Status" as session_status,
      s."Session Notes" as session_notes,
      s."Changes for Next Session" as changes_for_next_session
    from kimeu_sessions s
    left join kimeu_workshops w on w."Workshop ID" = s."Workshop ID"
    where s."Session ID" = ${sessionId}
  `;
  if (rows.length === 0) {
    throw new KimeuError("Session not found.", 404, "SESSION_NOT_FOUND");
  }
  if (rows.length > 1) {
    throw new KimeuError(
      "Session ID is duplicated in the database; no write was made.",
      409,
      "SESSION_ID_DUPLICATE",
    );
  }
  return sessionRecordFromRow(rows[0]);
}

type RosterRow = {
  pt_email: string;
  full_name: string | null;
  attended: string | null;
  computed_status: string | null;
  practical_status: string | null;
};

function rosterPersonFromRow(
  row: RosterRow,
  sourceTab: RosterPerson["sourceTab"],
  fallbackName: string,
): RosterPerson {
  return {
    clinicianEmail: row.pt_email,
    name: row.full_name || fallbackName || "Unnamed clinician",
    attended: (["Yes", "No"].includes(row.attended ?? "")
      ? row.attended
      : null) as "Yes" | "No" | null,
    sourceTab,
    computedStatus: row.computed_status || null,
    practicalStatus: row.practical_status || null,
    rowNumber: 0,
    attendedColumn: -1,
  };
}

export async function getRoster(
  session: SessionRecord,
  _force = false,
): Promise<RosterPerson[]> {
  if (!session.stage) {
    throw new KimeuError(
      "The session stage is blank. Verify the workshop ID in kimeu_workshops.",
      409,
      "SESSION_STAGE_MISSING",
    );
  }
  const sql = getSql();

  if (/foundation/i.test(session.stage)) {
    const rows = await sql<RosterRow[]>`
      select
        b."PT Email" as pt_email,
        coalesce(p.full_name, ap.full_name, '') as full_name,
        b."Attended (SME)" as attended,
        b."Complete" as computed_status,
        b."Practical Result" as practical_status
      from kimeu_foundations_blocks b
      left join person p on lower(p.email::text) = lower(b."PT Email")
      left join person_email_alias pea on lower(pea.email::text) = lower(b."PT Email")
      left join person ap on ap.person_id = pea.person_id
      where b."Workshop ID" = ${session.workshopId}
        and b."Session Date"::text = ${session.sessionDate}
        and b."PT Email" <> ''
    `;
    return rows.map((row) =>
      rosterPersonFromRow(row, "03c-Foundations Tracker", ""),
    );
  }

  if (/fellowship|enrichment/i.test(session.stage)) {
    const rows = await sql<RosterRow[]>`
      select
        r."PT Email" as pt_email,
        coalesce(p.full_name, ap.full_name, r."PT Name", '') as full_name,
        r."Attended" as attended,
        r."Workshop Status" as computed_status,
        r."Practical Result" as practical_status
      from kimeu_workshop_records r
      left join person p on lower(p.email::text) = lower(r."PT Email")
      left join person_email_alias pea on lower(pea.email::text) = lower(r."PT Email")
      left join person ap on ap.person_id = pea.person_id
      where r."Workshop ID" = ${session.workshopId}
        and r."Session Date"::text = ${session.sessionDate}
        and r."PT Email" <> ''
    `;
    return rows
      .map((row) => rosterPersonFromRow(row, "03b-Advanced Workshop Log", ""))
      .filter((person) => person.clinicianEmail);
  }

  throw new KimeuError(
    `Unsupported workshop stage: ${session.stage}. No roster was loaded.`,
    409,
    "UNSUPPORTED_WORKSHOP_STAGE",
  );
}

function summaryFrom(
  session: SessionRecord,
  roster: RosterPerson[],
): SessionSummary {
  const presentCount = roster.filter((person) => person.attended === "Yes").length;
  const absentCount = roster.filter((person) => person.attended === "No").length;
  return {
    sessionId: session.sessionId,
    workshopId: session.workshopId,
    workshopName: session.workshopName || session.workshopId,
    stage: session.stage || null,
    sessionDate: session.sessionDate,
    startTime: session.startTime,
    location: session.location,
    leadSme: session.leadSme,
    sessionStatus: session.sessionStatus,
    rosterCount: roster.length,
    presentCount,
    absentCount,
    unmarkedCount: roster.length - presentCount - absentCount,
  };
}

export async function getSessionDetail(sessionId: string, force = false) {
  const session = await getSessionRecord(sessionId, force);
  const roster = await getRoster(session, force);
  return {
    session: summaryFrom(session, roster),
    roster: roster.map(
      ({ rowNumber: _rowNumber, attendedColumn: _attendedColumn, sessionDateColumn: _dateColumn, ...person }) => person,
    ),
    sessionNotes: session.sessionNotes,
    changesForNextSession: session.changesForNextSession,
    internalRoster: roster,
    internalSession: session,
  };
}

export async function getToday(user: AppUser) {
  const today = todayInAppTimeZone();
  const sql = getSql();
  const rows = await sql<SessionRow[]>`
    select
      s."Session ID" as session_id,
      s."Workshop ID" as workshop_id,
      coalesce(w."Workshop Name", '') as workshop_name,
      coalesce(w."Stage", '') as stage,
      s."Session Date"::text as session_date,
      s."Start Time" as start_time,
      s."Location" as location,
      s."Lead SME" as lead_sme,
      s."Session Status" as session_status,
      s."Session Notes" as session_notes,
      s."Changes for Next Session" as changes_for_next_session
    from kimeu_sessions s
    left join kimeu_workshops w on w."Workshop ID" = s."Workshop ID"
    where s."Session Date"::text = ${today}
      and s."Session Status" <> 'Cancelled'
  `;
  const sessions = await Promise.all(
    rows
      .map(sessionRecordFromRow)
      .filter(
        (session) =>
          user.roles.includes("Admin") ||
          user.workshopIds.includes(session.workshopId),
      )
      .map(async (session) => summaryFrom(session, await getRoster(session))),
  );
  return {
    date: today,
    sessions,
    dueCount: sessions.reduce(
      (count, session) =>
        count + (session.sessionStatus === "Live" ? session.unmarkedCount : 0),
      0,
    ),
  };
}

function assertWrites(table: string, headers: string[]): void {
  for (const header of headers) assertInputHeader(table, header);
}

export async function openSession(
  user: AppUser,
  workshopId: string,
  sessionDate: string,
) {
  const sql = getSql();
  const catalog = await sql<{ found: number }[]>`
    select 1 as found from kimeu_workshops where "Workshop ID" = ${workshopId}
  `;
  if (catalog.length === 0) {
    throw new KimeuError("Workshop ID is not in the workshop catalog.", 400, "UNKNOWN_WORKSHOP");
  }
  const sessionId = sessionIdFor(workshopId, sessionDate);
  const timestamp = formatSheetTimestamp();
  await withKimeuLock(async (tx) => {
    const matches = await tx<
      { session_id: string; workshop_id: string; session_date: string; session_status: string }[]
    >`
      select "Session ID" as session_id, "Workshop ID" as workshop_id,
             "Session Date"::text as session_date, "Session Status" as session_status
      from kimeu_sessions
      where "Session ID" = ${sessionId}
    `;
    if (matches.length > 1) {
      throw new KimeuError(
        "Session ID is duplicated in the database; no write was made.",
        409,
        "SESSION_ID_DUPLICATE",
      );
    }
    if (matches.length === 1) {
      const existing = matches[0];
      if (
        existing.workshop_id !== workshopId ||
        formatSheetDate(existing.session_date) !== sessionDate
      ) {
        throw new KimeuError(
          "The existing Session ID does not match this workshop and date.",
          409,
          "SESSION_KEY_MISMATCH",
        );
      }
      if (existing.session_status === "Complete" || existing.session_status === "Cancelled") {
        throw new KimeuError(
          "A completed or cancelled session cannot be reopened.",
          409,
          "SESSION_CLOSED",
        );
      }
      assertWrites("kimeu_sessions", ["Session Status", "Last Updated By", "Last Updated"]);
      const updated = await tx`
        update kimeu_sessions
        set "Session Status" = 'Live',
            "Last Updated By" = ${user.nameInSheets},
            "Last Updated" = ${timestamp}
        where "Session ID" = ${sessionId}
      `;
      if (updated.count !== 1) {
        throw new KimeuError(
          "The session row changed during the write. No write was made.",
          409,
          "SESSION_ROW_CHANGED",
        );
      }
    } else {
      assertWrites("kimeu_sessions", [
        "Session ID", "Workshop ID", "Session Date", "Lead SME",
        "Session Status", "Last Updated By", "Last Updated",
      ]);
      await tx`
        insert into kimeu_sessions
          ("Session ID", "Workshop ID", "Session Date", "Lead SME",
           "Session Status", "Last Updated By", "Last Updated")
        values
          (${sessionId}, ${workshopId}, ${sessionDate}, ${user.nameInSheets},
           'Live', ${user.nameInSheets}, ${timestamp})
      `;
    }
  });
  return getSessionDetail(sessionId, true);
}

export async function saveAttendance(
  user: AppUser,
  sessionId: string,
  marks: Array<{ clinicianEmail: string; attended: "Yes" | "No" }>,
) {
  const detail = await getSessionDetail(sessionId, true);
  if (detail.session.sessionStatus !== "Live") {
    throw new KimeuError(
      "Open the session before recording attendance.",
      409,
      "SESSION_NOT_LIVE",
    );
  }
  const session = detail.internalSession;
  const roster = detail.internalRoster;
  const rosterByEmail = new Map(
    roster.map((person) => [normalizeEmail(person.clinicianEmail), person]),
  );
  const uniqueEmails = new Set(marks.map((mark) => normalizeEmail(mark.clinicianEmail)));
  if (uniqueEmails.size !== marks.length) {
    throw new KimeuError(
      "The attendance request contains a duplicate clinician.",
      400,
      "DUPLICATE_ATTENDANCE_MARK",
    );
  }
  const updatedRows = new Map<string, { person: RosterPerson; mark: "Yes" | "No" }>();
  for (const mark of marks) {
    const person = rosterByEmail.get(normalizeEmail(mark.clinicianEmail));
    if (!person) {
      throw new KimeuError(
        "A clinician in the attendance request is not on this session's roster.",
        403,
        "CLINICIAN_NOT_ON_ROSTER",
      );
    }
    updatedRows.set(normalizeEmail(mark.clinicianEmail), { person, mark: mark.attended });
  }

  const timestamp = formatSheetTimestamp();
  await withKimeuLock(async (tx) => {
    for (const { person, mark } of updatedRows.values()) {
      const email = normalizeEmail(person.clinicianEmail);
      if (person.sourceTab === "03b-Advanced Workshop Log") {
        assertWrites("kimeu_workshop_records", [
          "Attended", "Attendance Confirmed By", "Last Updated By", "Last Updated",
        ]);
        const updated = await tx`
          update kimeu_workshop_records
          set "Attended" = ${mark},
              "Attendance Confirmed By" = ${user.nameInSheets},
              "Last Updated By" = ${user.nameInSheets},
              "Last Updated" = ${timestamp}
          where lower("PT Email") = ${email}
            and "Workshop ID" = ${session.workshopId}
            and "Session Date"::text = ${session.sessionDate}
        `;
        if (updated.count !== 1) {
          throw new KimeuError(
            "The advanced workshop row changed or is ambiguous. No attendance was written.",
            409,
            "ROSTER_ROW_CHANGED",
          );
        }
      } else {
        assertWrites("kimeu_foundations_blocks", [
          "Session Date", "Attended (SME)", "Last Updated By", "Last Updated",
        ]);
        const updated = await tx`
          update kimeu_foundations_blocks
          set "Session Date" = ${session.sessionDate},
              "Attended (SME)" = ${mark},
              "Last Updated By" = ${user.nameInSheets},
              "Last Updated" = ${timestamp}
          where lower("PT Email") = ${email}
            and "Workshop ID" = ${session.workshopId}
            and "Session Date"::text = ${session.sessionDate}
        `;
        if (updated.count !== 1) {
          throw new KimeuError(
            "The Foundations workshop row changed or is ambiguous. No attendance was written.",
            409,
            "ROSTER_ROW_CHANGED",
          );
        }
      }
    }
    // Single audit row per save, replacing the sheet's per-cell Last Updated trail.
    const noteId = randomUUID();
    assertWrites("kimeu_clinician_notes", [
      "Note ID", "Created", "PT Email", "Note Type", "Workshop ID", "Session ID",
      "Note", "Follow-up Needed", "Author", "Author Role", "Visibility",
    ]);
    await tx`
      insert into kimeu_clinician_notes
        ("Note ID", "Created", "PT Email", "Note Type", "Workshop ID", "Session ID",
         "Note", "Follow-up Needed", "Author", "Author Role", "Visibility")
      values
        (${noteId}, ${new Date().toISOString()}, ${""}, ${"Attendance"},
         ${session.workshopId}, ${session.sessionId},
         ${`Attendance recorded for session ${session.sessionId}: ${[...updatedRows.entries()]
           .map(([email, item]) => `${email}=${item.mark}`)
           .join(", ")}`},
         ${false}, ${user.nameInSheets},
         ${user.roles.includes("Admin") ? "Admin" : "SME"}, ${"Aaron + author"})
    `;
  });

  const refreshed = await getSessionDetail(sessionId, true);
  const results = [...updatedRows.entries()].map(([email, item]) => {
    const updated = refreshed.internalRoster.find(
      (person) => normalizeEmail(person.clinicianEmail) === email,
    );
    return {
      clinicianEmail: item.person.clinicianEmail,
      attended: item.mark,
      computedStatus: updated?.computedStatus ?? null,
    };
  });
  return { session: refreshed.session, results };
}

export async function completeSession(
  user: AppUser,
  sessionId: string,
  input: {
    sessionNotes: string;
    changesForNextSession: string;
    confirmUnmarked: boolean;
  },
) {
  const detail = await getSessionDetail(sessionId, true);
  if (detail.session.sessionStatus !== "Live") {
    throw new KimeuError(
      "Open the session before completing it.",
      409,
      "SESSION_NOT_LIVE",
    );
  }
  if (detail.session.unmarkedCount > 0 && !input.confirmUnmarked) {
    throw new KimeuError(
      JSON.stringify(
        detail.internalRoster
          .filter((person) => person.attended === null)
          .map((person) => person.name),
      ),
      409,
      "UNMARKED_ATTENDANCE",
    );
  }
  const timestamp = formatSheetTimestamp();
  await withKimeuLock(async (tx) => {
    assertWrites("kimeu_sessions", [
      "Session Status", "Session Notes", "Changes for Next Session",
      "Last Updated By", "Last Updated",
    ]);
    const updated = await tx`
      update kimeu_sessions
      set "Session Status" = 'Complete',
          "Session Notes" = ${input.sessionNotes},
          "Changes for Next Session" = ${input.changesForNextSession},
          "Last Updated By" = ${user.nameInSheets},
          "Last Updated" = ${timestamp}
      where "Session ID" = ${sessionId}
    `;
    if (updated.count !== 1) {
      throw new KimeuError(
        "The session row changed during the write. No write was made.",
        409,
        "SESSION_ROW_CHANGED",
      );
    }
  });
  const refreshed = await getSessionDetail(sessionId, true);
  return refreshed.session;
}
