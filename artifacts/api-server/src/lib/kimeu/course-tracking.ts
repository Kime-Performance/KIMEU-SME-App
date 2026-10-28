import { createHash } from "node:crypto";
import type { CourseTrackingInput } from "@workspace/api-zod";
import type { AppUser } from "./access";
import { readCourseDirectory } from "./course-directory";
import { openSession } from "./sessions";
import {
  cell, dataRows, formatSheetDate, formatSheetTimestamp, headerIndex, headersFor,
  KimeuError, normalizeEmail, readTab, sessionIdFor, todayInAppTimeZone,
  withPracticalWriteLock, writeMultipleInputCells, prepareTrackingTemplateRows,
} from "./sheets";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const writer = (user: AppUser) => user.roles.some(r => ["Admin", "Foundations SME", "Elite SME"].includes(r));
function authorize(user: AppUser, workshopId: string) {
  if (!user.active || (!user.roles.includes("Admin") && !user.workshopIds.includes(workshopId))) {
    throw new KimeuError("This workshop is not assigned to your account.", 403, "WORKSHOP_NOT_ASSIGNED");
  }
}
export function validateTrackingDate(date: string) {
  const time = Date.parse(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(time) ||
      new Date(time).toISOString().slice(0, 10) !== date) {
    throw new KimeuError("Choose a valid workshop date.", 400, "INVALID_DATE");
  }
}
function preCourseComplete(percent: string): boolean {
  const value = percent.trim().replace(/%$/, "");
  // Blank or nonnumeric Kajabi data is never treated as completion.
  return value !== "" &&
    Number.isFinite(Number(value)) && Number(value) >= 100;
}

async function load(user: AppUser, workshopId: string, sessionDate: string, forceDirectory = false) {
  authorize(user, workshopId);
  validateTrackingDate(sessionDate);
  const catalog = await readTab("03a-KIMEU Workshops");
  const ch = headersFor(catalog);
  const courses = dataRows(catalog).filter(r => cell(r.values, headerIndex(ch, "Workshop ID")) === workshopId);
  if (courses.length !== 1) throw new KimeuError("The course could not be uniquely identified.", 409, "COURSE_AMBIGUOUS");
  const stage = cell(courses[0].values, headerIndex(ch, "Stage"));
  const foundation = /foundation/i.test(stage);
  if (!foundation && !/fellowship|advanced|enrichment/i.test(stage)) {
    throw new KimeuError("This course does not have a supported tracking sheet.", 409, "UNSUPPORTED_STAGE");
  }
  const tabName = foundation ? "03c-Foundations Tracker" : "03b-Advanced Workshop Log";
  const [directory, snapshot, sessions] = await Promise.all([
    readCourseDirectory(forceDirectory),
    readTab(tabName, { force: true, dataStartRow: 4 }),
    readTab("03f-Session Log", { force: true }),
  ]);
  const headers = headersFor(snapshot), sh = headersFor(sessions);
  const col = (name: string) => headerIndex(headers, name);
  let start = -1;
  if (foundation) {
    const matches = (snapshot.rows[0] ?? []).flatMap((v, i) =>
      v.trim() === workshopId || v.trim().startsWith(`${workshopId} —`) ? [i] : []);
    if (matches.length !== 1) throw new KimeuError("The Foundations course block is missing or ambiguous.", 409, "FOUNDATIONS_BLOCK_MISSING");
    start = matches[0];
  }
  const block = (name: string) => {
    if (!foundation) return col(name);
    const i = headers.findIndex((h, n) => n >= start && n < start + 5 && h.trim() === name);
    if (i < 0) throw new KimeuError(`Missing course column: ${name}.`, 409, "SHEET_HEADER_MISSING");
    return i;
  };
  const indices = {
    email: col("PT Email"), date: block("Session Date"),
    attended: block(foundation ? "Attended (SME)" : "Attended"),
    practical: block("Practical Result"),
    percent: col(foundation ? "Kajabi Course %" : "Kajabi Progress %"),
    status: foundation ? block("Complete") : col("Workshop Status"),
  };
  const currentSession = dataRows(sessions).filter(r =>
    cell(r.values, headerIndex(sh, "Session ID")) === sessionIdFor(workshopId, sessionDate));
  if (currentSession.length > 1) throw new KimeuError("Duplicate workshop sessions must be resolved first.", 409, "SESSION_DUPLICATE");
  const sessionStatus = currentSession[0] ? cell(currentSession[0].values, headerIndex(sh, "Session Status")) : "";
  const availableRows = dataRows(snapshot);
  const people = directory.people.map(person => {
    const candidates = availableRows.filter(r =>
      normalizeEmail(cell(r.values, indices.email)) === person.email &&
      (foundation || (cell(r.values, col("Workshop ID")) === workshopId &&
        formatSheetDate(cell(r.values, indices.date)) === sessionDate)));
    if (candidates.length > 1) throw new KimeuError("Duplicate PT tracking records must be resolved first.", 409, "TRACKING_DUPLICATE");
    const row = candidates[0];
    const dateMatches = row && formatSheetDate(cell(row.values, indices.date)) === sessionDate;
    const attended = Boolean(dateMatches && cell(row.values, indices.attended) === "Yes");
    const practicalPassed = Boolean(dateMatches && cell(row.values, indices.practical) === "Pass");
    const percent = row ? cell(row.values, indices.percent) : "";
    return {
      ...person, attended, practicalPassed,
      preCourseComplete: preCourseComplete(percent),
      sheetStatus: dateMatches ? cell(row.values, indices.status) : "",
      row,
    };
  });
  const revision = digest([workshopId, sessionDate, directory.people, snapshot.rows, sessionStatus]);
  const allowed = writer(user);
  const workspace = {
    sessionDate, revision,
    canSaveAttendance: allowed && !["Complete", "Cancelled"].includes(sessionStatus) && sessionDate <= todayInAppTimeZone(),
    rosterRefreshedAt: directory.refreshedAt,
    people: people.map(({ row: _row, ...person }) => person),
  };
  return { workspace, people, snapshot, tabName, indices, foundation };
}

export async function getCourseTracking(user: AppUser, workshopId: string, sessionDate: string) {
  return (await load(user, workshopId, sessionDate)).workspace;
}

export async function saveCourseTracking(user: AppUser, workshopId: string, input: CourseTrackingInput) {
  authorize(user, workshopId);
  // Defend internal callers as well as the generated HTTP request validator.
  if (input.kind !== "attendance") throw new KimeuError("Overall completion is calculated by the KIMEU sheet, not submitted from the SME app.", 400, "COMPLETION_SHEET_OWNED");
  if (!writer(user)) throw new KimeuError("Only an assigned SME or Admin can save course tracking.", 403, "ROLE_NOT_ALLOWED");
  if (!user.nameInSheets.trim()) throw new KimeuError("Your Name in Sheets is required before saving.", 409, "AUTHOR_REQUIRED");
  return withPracticalWriteLock(async () => {
    const state = await load(user, workshopId, input.sessionDate, true);
    if (state.workspace.revision !== input.revision) throw new KimeuError("Tracking changed. Reload and review the latest marks before saving.", 409, "TRACKING_CHANGED");
    if (new Set(input.marks.map(m => normalizeEmail(m.email))).size !== input.marks.length) {
      throw new KimeuError("Each PT can only appear once in a save.", 400, "DUPLICATE_MARK");
    }
    const selections = input.marks.map(mark => {
      const person = state.people.find(p => p.email === normalizeEmail(mark.email));
      if (!person) throw new KimeuError("A selected PT is no longer on the available clinical roster.", 409, "PT_NOT_AVAILABLE");
      if (input.kind === "attendance" && state.foundation && person.row) {
        const savedDate = formatSheetDate(cell(person.row.values, state.indices.date));
        if (savedDate && savedDate !== input.sessionDate) throw new KimeuError("A Foundations attendance record already exists on another date. It will not be overwritten.", 409, "FOUNDATIONS_DATE_CONFLICT");
      }
      return { person, checked: mark.checked };
    });
    const timestamp = formatSheetTimestamp();
    const updates: Array<{ tabName: string; rowNumber: number; header: string; value: string; columnIndex?: number }> = [];
    if (input.kind === "attendance") {
      if (!state.workspace.canSaveAttendance) throw new KimeuError("Attendance is read-only for future, completed, or cancelled sessions.", 409, "ATTENDANCE_READ_ONLY");
      const reserved = new Set<number>();
      let addedTemplateRows = 0;
      for (const { person, checked } of selections) {
        if (!person.row && !checked) continue;
        let rowNumber: number | undefined = person.row?.rowNumber;
        if (!rowNumber) {
          // Use a preformatted blank template row, never overwrite formulas
          // or append past the prepared formula range.
          rowNumber = dataRows(state.snapshot).find(r =>
            !reserved.has(r.rowNumber) && !cell(r.values, state.indices.email) &&
            !cell(r.values, state.indices.date) && !cell(r.values, state.indices.practical) &&
            (state.foundation || !cell(r.values, headerIndex(headersFor(state.snapshot), "Workshop ID"))))?.rowNumber;
          if (!rowNumber) rowNumber = state.snapshot.rows.length + (++addedTemplateRows);
          reserved.add(rowNumber);
          updates.push({ tabName: state.tabName, rowNumber, header: "PT Email", value: person.email });
          if (!state.foundation) {
            updates.push({ tabName: state.tabName, rowNumber, header: "Workshop ID", value: workshopId });
            updates.push({ tabName: state.tabName, rowNumber, header: "PT Name", value: person.name });
          }
        }
        const add = (header: string, value: string, columnIndex?: number) =>
          updates.push({ tabName: state.tabName, rowNumber: rowNumber!, header, value, columnIndex });
        add("Session Date", input.sessionDate, state.indices.date);
        add(state.foundation ? "Attended (SME)" : "Attended", checked ? "Yes" : "No", state.indices.attended);
        if (!state.foundation) add("Attendance Confirmed By", user.nameInSheets);
        add("Last Updated By", user.nameInSheets);
        add("Last Updated", timestamp);
      }
      if (addedTemplateRows) {
        await prepareTrackingTemplateRows(state.tabName, state.snapshot.rows.length + 1, addedTemplateRows);
      }
      // Session creation is explicit only upon Save, never from Calendar or GET.
      await openSession(user, workshopId, input.sessionDate);
    }
    await writeMultipleInputCells(updates);
    const result = await getCourseTracking(user, workshopId, input.sessionDate);
    if (selections.some(({ person, checked }) => {
      const saved = result.people.find(p => p.email === person.email);
      return !saved || saved.attended !== checked;
    })) throw new KimeuError("The save could not be confirmed. Refresh before retrying.", 503, "TRACKING_READBACK_FAILED");
    return result;
  });
}
