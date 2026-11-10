import { createHash, randomUUID } from "node:crypto";
import type { FoundationsAssessmentInput } from "@workspace/api-zod";
import { type AppUser, requireRole } from "./access";
import { readCourseDirectory } from "./course-directory";
import { isPostgresMode } from "./db/env";
import * as postgresAssessment from "./db/foundations-assessment";
import { isAssignedRd } from "./practical-rules";
import { cell, dataRows, formatSheetTimestamp, headerIndex, headersFor, KimeuError, normalizeEmail, readTab, withPracticalWriteLock, writeMultipleInputCells } from "./sheets";

const TAB = "03c-Foundations Tracker";
const NOTES = "03g-Clinician Notes";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function load(user: AppUser, fresh = false) {
  if (!user.active) throw new KimeuError("Your staff access is inactive.", 403, "APP_USER_INACTIVE");
  requireRole(user, "RD");
  const [directory, snapshot] = await Promise.all([
    readCourseDirectory(fresh), readTab(TAB, { force: true, dataStartRow: 4 }),
  ]);
  const headers = headersFor(snapshot);
  if (headers[7]?.trim() !== "Exam Result" || headerIndex(headers, "Exam Result") !== 7) {
    throw new KimeuError("Column H must retain the existing Exam Result header. No results were changed.", 409, "ASSESSMENT_HEADER_CHANGED");
  }
  const emailIndex = headerIndex(headers, "PT Email"), rdIndex = headerIndex(headers, "RD");
  const rows = dataRows(snapshot);
  const matches = new Map<string, { rowNumber: number; result: string }>();
  const people = directory.people.flatMap(person => {
    const found = rows.filter(row => normalizeEmail(cell(row.values, emailIndex)) === person.email);
    if (found.length > 1) throw new KimeuError("Duplicate PT Email rows in Foundations need director review.", 409, "ASSESSMENT_DUPLICATE");
    // Do not create a partial tracker row or guess a clinician's identity.
    if (!found.length) return [];
    const row = found[0], assigned = cell(row.values, rdIndex), result = cell(row.values, 7);
    if (!user.roles.includes("Admin") && !isAssignedRd(assigned, user.nameInSheets, user.email)) return [];
    matches.set(person.email, { rowNumber: row.rowNumber, result });
    return [{ ...person, result, revision: hash([person, row.rowNumber, assigned, result]) }];
  });
  return { workspace: { people }, matches };
}

export async function getFoundationsAssessment(user: AppUser) {
  if (isPostgresMode()) return postgresAssessment.getFoundationsAssessment(user);
  return (await load(user)).workspace;
}

export async function saveFoundationsAssessment(user: AppUser, input: FoundationsAssessmentInput) {
  if (isPostgresMode()) return postgresAssessment.saveFoundationsAssessment(user, input);
  requireRole(user, "RD");
  if (!["Pass", "Fail"].includes(input.result)) throw new KimeuError("Choose Pass or Fail.", 400, "ASSESSMENT_INVALID_RESULT");
  if (!user.nameInSheets.trim()) throw new KimeuError("Your Name in Sheets is required.", 409, "AUTHOR_REQUIRED");
  return withPracticalWriteLock(async () => {
    const state = await load(user, true);
    const email = normalizeEmail(input.email);
    const person = state.workspace.people.find(p => p.email === email), match = state.matches.get(email);
    if (!person || !match) throw new KimeuError("This PT needs an existing Foundations row and must be assigned to you.", 403, "PT_NOT_ASSIGNED");
    if (person.revision !== input.revision) throw new KimeuError("This assessment changed. Reload and review its current result before saving.", 409, "ASSESSMENT_CHANGED");
    const notes = await readTab(NOTES, { force: true }), nh = headersFor(notes);
    const noteRow = Math.max(notes.dataStartRow - 1, ...dataRows(notes).filter(r => cell(r.values, headerIndex(nh, "Note ID"))).map(r => r.rowNumber)) + 1;
    const timestamp = formatSheetTimestamp();
    await writeMultipleInputCells([
      { tabName: TAB, rowNumber: match.rowNumber, columnIndex: 7, header: "Exam Result", value: input.result },
      ...Object.entries({
        "Note ID": randomUUID(), Created: timestamp, "PT Email": email,
        "Workshop ID": "Foundations Assessment", "Review ID": `Foundations assessment:${randomUUID()}`,
        "Note Type": "General", Note: JSON.stringify({ previousResult: match.result, result: input.result }),
        Author: user.nameInSheets, "Author Role": user.roles.includes("Admin") ? "Admin" : "RD", Visibility: "Aaron + author",
      }).map(([header, value]) => ({ tabName: NOTES, rowNumber: noteRow, header, value })),
    ]);
    const result = await getFoundationsAssessment(user);
    if (result.people.find(p => p.email === email)?.result !== input.result) {
      throw new KimeuError("The sheet result could not be confirmed. Reload before retrying.", 503, "ASSESSMENT_READBACK_FAILED");
    }
    return result;
  });
}
