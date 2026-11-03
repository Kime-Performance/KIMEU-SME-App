import { createHash, randomUUID } from "node:crypto";
import type { OnboardingInput } from "@workspace/api-zod";
import { type AppUser, requireRole } from "./access";
import { isPostgresMode } from "./db/env";
import { getOnboarding as pgGetOnboarding, saveOnboarding as pgSaveOnboarding } from "./db/onboarding";
import { readCourseDirectory } from "./course-directory";
import { isAssignedRd } from "./practical-rules";
import { onboardingWeeks, validateOnboardingUnit } from "./onboarding-rules";
import { isRdAttendanceOnly } from "./courses";
import { cell, dataRows, formatSheetDate, formatSheetTimestamp, headerIndex, headersFor, KimeuError, normalizeEmail, readTab, todayInAppTimeZone, withPracticalWriteLock, writeMultipleInputCells } from "./sheets";

const TAB = "03i-RD Onboarding", NOTES = "03g-Clinician Notes";
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
async function load(user: AppUser, courseId: string, fresh = false) {
  if (!user.active) throw new KimeuError("Your staff access is inactive.", 403, "APP_USER_INACTIVE");
  requireRole(user, "RD");
  const requiredWeeks = onboardingWeeks(courseId);
  const [directory, foundation, snapshot] = await Promise.all([
    readCourseDirectory(fresh), readTab("03c-Foundations Tracker", { force: true, dataStartRow: 4 }), readTab(TAB, { force: true }),
  ]);
  const fh = headersFor(foundation), h = headersFor(snapshot);
  const fEmail = headerIndex(fh, "PT Email"), fRd = headerIndex(fh, "RD");
  const v = (row: string[], key: string) => cell(row, headerIndex(h, key));
  const records = dataRows(snapshot).filter(r => v(r.values, "Record ID"));
  const people = directory.people.flatMap(person => {
    const matches = dataRows(foundation).filter(r => normalizeEmail(cell(r.values, fEmail)) === person.email);
    if (matches.length > 1) throw new KimeuError("Duplicate Foundations PT rows need director review.", 409, "TRACKING_DUPLICATE");
    const assigned = matches[0] ? cell(matches[0].values, fRd) : "";
    if (!user.roles.includes("Admin") && !isAssignedRd(assigned, user.nameInSheets, user.email)) return [];
    const rows = records.filter(r => normalizeEmail(v(r.values, "PT Email")) === person.email && v(r.values, "Workshop ID") === courseId);
    if (new Set(rows.map(r => v(r.values, "Week"))).size !== rows.length) throw new KimeuError("Duplicate onboarding week records need review.", 409, "ONBOARDING_DUPLICATE");
    const units = Array.from({ length: requiredWeeks }, (_, i) => {
      const row = rows.find(r => Number(v(r.values, "Week")) === i + 1);
      const get = (key: string) => row ? v(row.values, key) : "";
      const mayReadNotes = user.roles.includes("Admin") || normalizeEmail(get("Signed By")) === user.email;
      return { week: i + 1, date: formatSheetDate(get("Session Date")), attended: get("Attended") === "Yes", result: get("RD Result"), notes: mayReadNotes ? get("Notes") : "", signedBy: get("Signed By"), signedAt: get("Signed At") };
    });
    // Completion is read from formulas, never set by app approval.
    const latest = rows.at(-1);
    const count = latest ? Number(v(latest.values, "Completed Weeks")) : 0;
    return [{
      ...person, revision: hash([courseId, person, assigned, rows.map(r => r.values.slice(0, 13))]),
      completedWeeks: Number.isInteger(count) && count >= 0 && count <= requiredWeeks ? count : 0,
      sheetStatus: latest ? v(latest.values, "Course Status") : "Not started", units,
    }];
  });
  return { workspace: { courseId, requiredWeeks, canSignOff: true, people }, snapshot, records, h };
}
export async function getOnboarding(user: AppUser, courseId: string) {
  if (isPostgresMode()) return pgGetOnboarding(user, courseId);
  return (await load(user, courseId)).workspace;
}

export async function saveOnboarding(user: AppUser, courseId: string, input: OnboardingInput) {
  if (isPostgresMode()) return pgSaveOnboarding(user, courseId, input);
  requireRole(user, "RD");
  if (!user.nameInSheets.trim()) throw new KimeuError("Your Name in Sheets is required.", 409, "AUTHOR_REQUIRED");
  return withPracticalWriteLock(async () => {
    const state = await load(user, courseId, true);
    const email = normalizeEmail(input.email);
    const person = state.workspace.people.find(p => p.email === email);
    if (!person) throw new KimeuError("This PT is unavailable or is not assigned to you.", 403, "PT_NOT_ASSIGNED");
    if (person.revision !== input.revision) throw new KimeuError("This PT's record changed. Reload before saving.", 409, "ONBOARDING_CHANGED");
    validateOnboardingUnit(input, courseId, todayInAppTimeZone(), person.units);
    const recordId = `${courseId}:${email}:W${input.week}`;
    const existing = state.records.find(r => cell(r.values, headerIndex(state.h, "Record ID")) === recordId);
    const rowNumber = existing?.rowNumber ?? Math.max(state.snapshot.dataStartRow - 1, ...state.records.map(r => r.rowNumber)) + 1;
    const timestamp = formatSheetTimestamp();
    const fields = { "Record ID": recordId, "PT Email": email, "Workshop ID": courseId, Week: input.week,
      "Session Date": input.date, Minutes: input.attended && courseId === "F-12" ? 60 : 0,
      Attended: input.attended ? "Yes" : "No", "RD Result": input.result,
      "Signed By": user.email, "Signed At": input.result || isRdAttendanceOnly(courseId) ? timestamp : "",
      Notes: input.notes.trim(), "Last Updated By": user.email, "Last Updated": timestamp };
    const notes = await readTab(NOTES, { force: true }), nh = headersFor(notes);
    const noteRow = Math.max(notes.dataStartRow - 1, ...dataRows(notes).filter(r => cell(r.values, headerIndex(nh, "Note ID"))).map(r => r.rowNumber)) + 1;
    await writeMultipleInputCells([
      ...Object.entries(fields).map(([header, value]) => ({ tabName: TAB, rowNumber, header, value })),
      ...Object.entries({ "Note ID": randomUUID(), Created: timestamp, "PT Email": email,
        "Workshop ID": courseId, "Review ID": `RD onboarding:${recordId}:${randomUUID()}`, "Note Type": "General",
        Note: JSON.stringify({ week: input.week, date: input.date, attended: input.attended, minutes: fields.Minutes, result: input.result, notes: input.notes.trim() }),
        Author: user.nameInSheets, "Author Role": user.roles.includes("Admin") ? "Admin" : "RD", Visibility: "Aaron + author",
      }).map(([header, value]) => ({ tabName: NOTES, rowNumber: noteRow, header, value })),
    ]);
    const result = await getOnboarding(user, courseId);
    const back = result.people.find(p => p.email === email)?.units.find(u => u.week === input.week);
    if (!back || back.date !== input.date || back.attended !== input.attended || back.result !== input.result || back.notes !== input.notes.trim()) {
      throw new KimeuError("The save could not be confirmed. Reload before retrying.", 503, "ONBOARDING_READBACK_FAILED");
    }
    return result;
  });
}
