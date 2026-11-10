import {
  cell,
  dataRows,
  formatSheetDate,
  formatSheetTimestamp,
  headerIndex,
  headersFor,
  KimeuError,
  readTab,
  sessionIdFor,
  todayInAppTimeZone,
  writeInputCells,
  writeMultipleInputCells,
  appendSparseInputRow,
} from "./sheets";
import type { AppUser } from "./access";
import { isPostgresMode } from "./db/env";
import * as dbSessions from "./db/sessions";

type SessionStatus = "Scheduled" | "Live" | "Complete" | "Cancelled";
type SessionRecord = {
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
export type RosterPerson = {
  clinicianEmail: string;
  name: string;
  attended: "Yes" | "No" | null;
  sourceTab: "03b-Advanced Workshop Log" | "03c-Foundations Tracker";
  computedStatus: string | null;
  practicalStatus: string | null;
  rowNumber: number;
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

const SESSION_TAB = "03f-Session Log";

function sessionRecordFromRow(
  rowNumber: number,
  values: string[],
  headers: string[],
): SessionRecord {
  const value = (name: string) => cell(values, headerIndex(headers, name));
  const sessionStatus = value("Session Status") as SessionStatus;
  if (!["Scheduled", "Live", "Complete", "Cancelled"].includes(sessionStatus)) {
    throw new KimeuError(
      "The session has an invalid Session Status value in the sheet.",
      409,
      "INVALID_SESSION_STATUS",
    );
  }
  const workshopId = value("Workshop ID");
  const sessionDate = formatSheetDate(value("Session Date"));
  return {
    rowNumber,
    sessionId: value("Session ID") || sessionIdFor(workshopId, sessionDate),
    workshopId,
    workshopName: value("Workshop Name (auto)"),
    stage: value("Stage (auto)"),
    sessionDate,
    startTime: value("Start Time") || null,
    location: value("Location") || null,
    leadSme: value("Lead SME") || null,
    sessionStatus,
    sessionNotes: value("Session Notes"),
    changesForNextSession: value("Changes for Next Session"),
  };
}

export async function getSessionRecord(
  sessionId: string,
  force = false,
): Promise<SessionRecord> {
  if (isPostgresMode()) return dbSessions.getSessionRecord(sessionId, force);
  const snapshot = await readTab(SESSION_TAB, { force });
  const headers = headersFor(snapshot);
  const sessionIdIndex = headerIndex(headers, "Session ID");
  const matches = dataRows(snapshot).filter(
    (row) => cell(row.values, sessionIdIndex) === sessionId,
  );
  if (matches.length === 0) {
    throw new KimeuError("Session not found.", 404, "SESSION_NOT_FOUND");
  }
  if (matches.length > 1) {
    throw new KimeuError(
      "Session ID is duplicated in the sheet; no write was made.",
      409,
      "SESSION_ID_DUPLICATE",
    );
  }
  return sessionRecordFromRow(matches[0].rowNumber, matches[0].values, headers);
}

function exactBlockStart(row1: string[], workshopId: string): number {
  const prefix = `${workshopId} —`;
  const matches = row1
    .map((value, index) => ({ value: value.trim(), index }))
    .filter(({ value }) => value === workshopId || value.startsWith(prefix));
  if (matches.length !== 1) {
    throw new KimeuError(
      `Could not uniquely find the ${workshopId} workshop block in 03c. No write was made.`,
      409,
      "FOUNDATIONS_BLOCK_MISSING",
    );
  }
  return matches[0].index;
}

function blockColumn(
  headers: string[],
  start: number,
  header: string,
): number {
  const index = headers.findIndex(
    (value, current) => current >= start && current < start + 5 && value.trim() === header,
  );
  if (index < 0) {
    throw new KimeuError(
      `Required 03c workshop-block header is missing: ${header}. No write was made.`,
      409,
      "SHEET_HEADER_MISSING",
    );
  }
  return index;
}

export async function getRoster(
  session: SessionRecord,
  force = false,
): Promise<RosterPerson[]> {
  if (isPostgresMode()) return dbSessions.getRoster(session, force);
  if (!session.stage) {
    throw new KimeuError(
      "The session stage formula is blank. Verify the workshop ID in 03a-KIMEU Workshops.",
      409,
      "SESSION_STAGE_MISSING",
    );
  }

  if (/foundation/i.test(session.stage)) {
    const snapshot = await readTab("03c-Foundations Tracker", {
      force,
      dataStartRow: 4,
    });
    const headers = headersFor(snapshot);
    const row1 = snapshot.rows[0] ?? [];
    const start = exactBlockStart(row1, session.workshopId);
    const emailIndex = headerIndex(headers, "PT Email");
    const nameIndex = headerIndex(headers, "PT Name");
    const dateIndex = blockColumn(headers, start, "Session Date");
    const attendedIndex = blockColumn(headers, start, "Attended (SME)");
    const completeIndex = blockColumn(headers, start, "Complete");
    const practicalIndex = blockColumn(headers, start, "Practical Result");

    return dataRows(snapshot)
      .filter(
        (row) =>
          cell(row.values, emailIndex) &&
          formatSheetDate(cell(row.values, dateIndex)) === session.sessionDate,
      )
      .map((row) => ({
        clinicianEmail: cell(row.values, emailIndex),
        name: cell(row.values, nameIndex) || "Unnamed clinician",
        attended: (["Yes", "No"].includes(cell(row.values, attendedIndex))
          ? cell(row.values, attendedIndex)
          : null) as "Yes" | "No" | null,
        sourceTab: "03c-Foundations Tracker" as const,
        computedStatus: cell(row.values, completeIndex) || null,
        practicalStatus: cell(row.values, practicalIndex) || null,
        rowNumber: row.rowNumber,
        attendedColumn: attendedIndex,
        sessionDateColumn: dateIndex,
      }));
  }

  if (/fellowship|enrichment/i.test(session.stage)) {
    const snapshot = await readTab("03b-Advanced Workshop Log", {
      force,
      dataStartRow: 4,
    });
    const headers = headersFor(snapshot);
    const emailIndex = headerIndex(headers, "PT Email");
    const nameIndex = headerIndex(headers, "PT Name");
    const workshopIndex = headerIndex(headers, "Workshop ID");
    const dateIndex = headerIndex(headers, "Session Date");
    const attendedIndex = headerIndex(headers, "Attended");
    const statusIndex = headerIndex(headers, "Workshop Status");
    const practicalIndex = headerIndex(headers, "Practical Result");
    return dataRows(snapshot)
      .filter(
        (row) =>
          cell(row.values, workshopIndex) === session.workshopId &&
          formatSheetDate(cell(row.values, dateIndex)) === session.sessionDate,
      )
      .map((row) => ({
        clinicianEmail: cell(row.values, emailIndex),
        name: cell(row.values, nameIndex) || "Unnamed clinician",
        attended: (["Yes", "No"].includes(cell(row.values, attendedIndex))
          ? cell(row.values, attendedIndex)
          : null) as "Yes" | "No" | null,
        sourceTab: "03b-Advanced Workshop Log" as const,
        computedStatus: cell(row.values, statusIndex) || null,
        practicalStatus: cell(row.values, practicalIndex) || null,
        rowNumber: row.rowNumber,
        attendedColumn: attendedIndex,
      }))
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

export async function getSessionDetail(sessionId: string, force = false, user?: AppUser) {
  if (isPostgresMode()) return dbSessions.getSessionDetail(sessionId, force, user);
  const session = await getSessionRecord(sessionId, force);
  const roster = await getRoster(session, force);
  return {
    session: summaryFrom(session, roster),
    roster: roster.map(({ rowNumber: _rowNumber, attendedColumn: _attendedColumn, sessionDateColumn: _dateColumn, ...person }) => person),
    sessionNotes: session.sessionNotes,
    changesForNextSession: session.changesForNextSession,
    internalRoster: roster,
    internalSession: session,
  };
}

export async function getToday(user: AppUser) {
  if (isPostgresMode()) return dbSessions.getToday(user);
  const today = todayInAppTimeZone();
  const snapshot = await readTab(SESSION_TAB);
  const headers = headersFor(snapshot);
  const rows = dataRows(snapshot)
    .filter((row) => {
      const dateIndex = headerIndex(headers, "Session Date");
      const workshopIndex = headerIndex(headers, "Workshop ID");
      const statusIndex = headerIndex(headers, "Session Status");
      const date = formatSheetDate(cell(row.values, dateIndex));
      const workshopId = cell(row.values, workshopIndex);
      const status = cell(row.values, statusIndex);
      return (
        date === today &&
        status !== "Cancelled" &&
        (user.roles.includes("Admin") || user.workshopIds.includes(workshopId))
      );
    })
    .map((row) => sessionRecordFromRow(row.rowNumber, row.values, headers));
  const sessions = await Promise.all(
    rows.map(async (session) => summaryFrom(session, await getRoster(session))),
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

export async function openSession(
  user: AppUser,
  workshopId: string,
  sessionDate: string,
) {
  if (isPostgresMode()) return dbSessions.openSession(user, workshopId, sessionDate);
  const catalog = await readTab("03a-KIMEU Workshops");
  const catalogHeaders = headersFor(catalog);
  const workshopColumn = headerIndex(catalogHeaders, "Workshop ID");
  if (!dataRows(catalog).some((row) => cell(row.values, workshopColumn) === workshopId)) {
    throw new KimeuError("Workshop ID is not in the workshop catalog.", 400, "UNKNOWN_WORKSHOP");
  }
  const sessionId = sessionIdFor(workshopId, sessionDate);
  const snapshot = await readTab(SESSION_TAB, { force: true });
  const headers = headersFor(snapshot);
  const sessionIdIndex = headerIndex(headers, "Session ID");
  const matches = dataRows(snapshot).filter(
    (row) => cell(row.values, sessionIdIndex) === sessionId,
  );
  if (matches.length > 1) {
    throw new KimeuError(
      "Session ID is duplicated in the sheet; no write was made.",
      409,
      "SESSION_ID_DUPLICATE",
    );
  }
  const timestamp = formatSheetTimestamp();
  if (matches.length === 1) {
    const session = sessionRecordFromRow(
      matches[0].rowNumber,
      matches[0].values,
      headers,
    );
    if (session.workshopId !== workshopId || session.sessionDate !== sessionDate) {
      throw new KimeuError(
        "The existing Session ID does not match this workshop and date.",
        409,
        "SESSION_KEY_MISMATCH",
      );
    }
    if (session.sessionStatus === "Complete" || session.sessionStatus === "Cancelled") {
      throw new KimeuError(
        "A completed or cancelled session cannot be reopened.",
        409,
        "SESSION_CLOSED",
      );
    }
    await writeInputCells(SESSION_TAB, [
      { rowNumber: session.rowNumber, header: "Session Status", value: "Live" },
      { rowNumber: session.rowNumber, header: "Last Updated By", value: user.nameInSheets },
        { rowNumber: session.rowNumber, header: "Last Updated", value: timestamp },
    ]);
  } else {
    await appendSparseInputRow(
      SESSION_TAB,
      [
        { header: "Session ID", value: sessionId },
        { header: "Workshop ID", value: workshopId },
        { header: "Session Date", value: sessionDate },
        { header: "Lead SME", value: user.nameInSheets },
        { header: "Session Status", value: "Live" },
        { header: "Last Updated By", value: user.nameInSheets },
        { header: "Last Updated", value: timestamp },
      ],
      { dataStartRow: 3, autoHeaders: ["Workshop Name (auto)", "Stage (auto)"] },
    );
  }
  return getSessionDetail(sessionId, true);
}

export async function saveAttendance(
  user: AppUser,
  sessionId: string,
  marks: Array<{ clinicianEmail: string; attended: "Yes" | "No" }>,
) {
  if (isPostgresMode()) return dbSessions.saveAttendance(user, sessionId, marks);
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
    roster.map((person) => [person.clinicianEmail.toLowerCase(), person]),
  );
  const uniqueEmails = new Set(marks.map((mark) => mark.clinicianEmail.toLowerCase()));
  if (uniqueEmails.size !== marks.length) {
    throw new KimeuError(
      "The attendance request contains a duplicate clinician.",
      400,
      "DUPLICATE_ATTENDANCE_MARK",
    );
  }
  const updatedRows = new Map<string, { person: RosterPerson; mark: "Yes" | "No" }>();
  for (const mark of marks) {
    const person = rosterByEmail.get(mark.clinicianEmail.toLowerCase());
    if (!person) {
      throw new KimeuError(
        "A clinician in the attendance request is not on this session's roster.",
        403,
        "CLINICIAN_NOT_ON_ROSTER",
      );
    }
    updatedRows.set(mark.clinicianEmail.toLowerCase(), { person, mark: mark.attended });
  }

  const timestamp = formatSheetTimestamp();
  const updates: Array<{
    tabName: string;
    rowNumber: number;
    header: string;
    value: string;
    columnIndex?: number;
  }> = [];

  const advanced = [...updatedRows.values()].filter(
    ({ person }) => person.sourceTab === "03b-Advanced Workshop Log",
  );
  if (advanced.length) {
    const snapshot = await readTab("03b-Advanced Workshop Log", {
      force: true,
      dataStartRow: 4,
    });
    const headers = headersFor(snapshot);
    const emailIndex = headerIndex(headers, "PT Email");
    const workshopIndex = headerIndex(headers, "Workshop ID");
    const dateIndex = headerIndex(headers, "Session Date");
    for (const { person, mark } of advanced) {
      const match = dataRows(snapshot).filter(
        (row) =>
          cell(row.values, emailIndex).toLowerCase() === person.clinicianEmail.toLowerCase() &&
          cell(row.values, workshopIndex) === session.workshopId &&
          formatSheetDate(cell(row.values, dateIndex)) === session.sessionDate,
      );
      if (match.length !== 1) {
        throw new KimeuError(
          "The advanced workshop row changed or is ambiguous. No attendance was written.",
          409,
          "ROSTER_ROW_CHANGED",
        );
      }
      updates.push(
        { tabName: "03b-Advanced Workshop Log", rowNumber: match[0].rowNumber, header: "Attended", value: mark },
        { tabName: "03b-Advanced Workshop Log", rowNumber: match[0].rowNumber, header: "Attendance Confirmed By", value: user.nameInSheets },
        { tabName: "03b-Advanced Workshop Log", rowNumber: match[0].rowNumber, header: "Last Updated By", value: user.nameInSheets },
        { tabName: "03b-Advanced Workshop Log", rowNumber: match[0].rowNumber, header: "Last Updated", value: timestamp },
      );
    }
  }

  const foundations = [...updatedRows.values()].filter(
    ({ person }) => person.sourceTab === "03c-Foundations Tracker",
  );
  if (foundations.length) {
    const snapshot = await readTab("03c-Foundations Tracker", {
      force: true,
      dataStartRow: 4,
    });
    const headers = headersFor(snapshot);
    const emailIndex = headerIndex(headers, "PT Email");
    const start = exactBlockStart(snapshot.rows[0] ?? [], session.workshopId);
    const dateIndex = blockColumn(headers, start, "Session Date");
    const attendedIndex = blockColumn(headers, start, "Attended (SME)");
    for (const { person, mark } of foundations) {
      const match = dataRows(snapshot).filter(
        (row) =>
          cell(row.values, emailIndex).toLowerCase() === person.clinicianEmail.toLowerCase() &&
          formatSheetDate(cell(row.values, dateIndex)) === session.sessionDate,
      );
      if (match.length !== 1) {
        throw new KimeuError(
          "The Foundations workshop row changed or is ambiguous. No attendance was written.",
          409,
          "ROSTER_ROW_CHANGED",
        );
      }
      updates.push(
        { tabName: "03c-Foundations Tracker", rowNumber: match[0].rowNumber, columnIndex: dateIndex, header: "Session Date", value: session.sessionDate },
        { tabName: "03c-Foundations Tracker", rowNumber: match[0].rowNumber, columnIndex: attendedIndex, header: "Attended (SME)", value: mark },
        { tabName: "03c-Foundations Tracker", rowNumber: match[0].rowNumber, header: "Last Updated By", value: user.nameInSheets },
        { tabName: "03c-Foundations Tracker", rowNumber: match[0].rowNumber, header: "Last Updated", value: timestamp },
      );
    }
  }
  await writeMultipleInputCells(updates);

  const refreshed = await getSessionDetail(sessionId, true);
  const results = [...updatedRows.entries()].map(([email, item]) => {
    const updated = refreshed.internalRoster.find(
      (person) => person.clinicianEmail.toLowerCase() === email,
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
  if (isPostgresMode()) return dbSessions.completeSession(user, sessionId, input);
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
  const session = detail.internalSession;
  const timestamp = formatSheetTimestamp();
  await writeInputCells(SESSION_TAB, [
    { rowNumber: session.rowNumber, header: "Session Status", value: "Complete" },
    { rowNumber: session.rowNumber, header: "Session Notes", value: input.sessionNotes },
    { rowNumber: session.rowNumber, header: "Changes for Next Session", value: input.changesForNextSession },
    { rowNumber: session.rowNumber, header: "Last Updated By", value: user.nameInSheets },
    { rowNumber: session.rowNumber, header: "Last Updated", value: timestamp },
  ]);
  const refreshed = await getSessionDetail(sessionId, true);
  return refreshed.session;
}

