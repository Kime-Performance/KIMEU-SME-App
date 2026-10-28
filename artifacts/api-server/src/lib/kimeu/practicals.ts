import { createHash, randomUUID } from "node:crypto";
import type { AppUser } from "./access";
import type { PracticalSignoff } from "@workspace/api-zod";
import {
  appendSparseInputRow, cell, dataRows, formatSheetDate, formatSheetTimestamp,
  headerIndex, headersFor, KimeuError, normalizeEmail, readTab,
  todayInAppTimeZone, withPracticalWriteLock, type CellValue,
} from "./sheets";
import { isAssignedRd, validPracticalInput } from "./practical-rules";

const NOTES = "03g-Clinician Notes";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const privileged = (user: AppUser) => user.roles.includes("Admin") || user.roles.includes("RD");

// Permission checks also live here so internal callers cannot bypass the route.
function assignedCourse(user: AppUser, workshopId: string) {
  if (!user.active || (!user.roles.includes("Admin") && !user.workshopIds.includes(workshopId))) {
    throw new KimeuError("This workshop is not assigned to your account.", 403, "WORKSHOP_NOT_ASSIGNED");
  }
}

async function load(user: AppUser, workshopId: string) {
  assignedCourse(user, workshopId);
  const catalog = await readTab("03a-KIMEU Workshops");
  const ch = headersFor(catalog);
  const matches = dataRows(catalog).filter(r => cell(r.values, headerIndex(ch, "Workshop ID")) === workshopId);
  if (matches.length !== 1) throw new KimeuError("The workshop could not be uniquely identified.", 409, "COURSE_AMBIGUOUS");
  const stage = cell(matches[0].values, headerIndex(ch, "Stage"));
  const foundation = /foundation/i.test(stage);
  const supported = foundation || /fellowship|advanced|enrichment/i.test(stage);
  if (!supported) return { canSignOff: false, records: [], internal: [] };
  const tabName = foundation ? "03c-Foundations Tracker" : "03b-Advanced Workshop Log";
  const [snapshot, notes] = await Promise.all([
    readTab(tabName, { force: true, dataStartRow: foundation ? 4 : 3 }),
    readTab(NOTES, { force: true }),
  ]);
  const headers = headersFor(snapshot);
  const nh = headersFor(notes);
  // Privacy and audit headers must exist before the feature can write anything.
  for (const name of ["Review ID", "Visibility", "Author", "Note ID", "Note", "Created", "Workshop ID", "PT Email"]) headerIndex(nh, name);
  let start = -1;
  if (foundation) {
    const blocks = (snapshot.rows[0] ?? []).flatMap((v, i) =>
      v.trim() === workshopId || v.trim().startsWith(`${workshopId} —`) ? [i] : []);
    if (blocks.length !== 1) throw new KimeuError("The Foundations workshop block is missing or ambiguous.", 409, "FOUNDATIONS_BLOCK_MISSING");
    start = blocks[0];
  }
  const column = (name: string) => {
    if (!foundation || !["Session Date", "Attended (SME)", "Practical Date", "Practical Result"].includes(name)) return headerIndex(headers, name);
    const found = headers.findIndex((h, i) => i >= start && i < start + 5 && h.trim() === name);
    if (found < 0) throw new KimeuError(`Missing practical column: ${name}.`, 409, "SHEET_HEADER_MISSING");
    return found;
  };
  const idx = {
    email: column("PT Email"), name: column("PT Name"), rd: column("RD"),
    session: column("Session Date"), attended: column(foundation ? "Attended (SME)" : "Attended"),
    date: column("Practical Date"), result: column("Practical Result"),
    scoredBy: foundation ? -1 : column("Practical Scored By (RD)"),
    updatedBy: column("Last Updated By"), updated: column("Last Updated"),
  };
  const records = dataRows(snapshot).flatMap(row => {
    if (!foundation && cell(row.values, column("Workshop ID")) !== workshopId) return [];
    const email = normalizeEmail(cell(row.values, idx.email));
    const sessionDate = formatSheetDate(cell(row.values, idx.session));
    const rd = cell(row.values, idx.rd);
    if (!email || !sessionDate) return [];
    // RD-only accounts see only PTs explicitly assigned to them. No regional
    // inference from names, and blank RD assignments never grant sign-off.
    if (user.roles.includes("RD") && !user.roles.includes("Admin") &&
        !isAssignedRd(rd, user.nameInSheets, user.email)) return [];
    const recordKey = hash([workshopId, email, sessionDate]);
    const matchingNotes = dataRows(notes).filter(n =>
      cell(n.values, headerIndex(nh, "Workshop ID")) === workshopId &&
      normalizeEmail(cell(n.values, headerIndex(nh, "PT Email"))) === email &&
      cell(n.values, headerIndex(nh, "Review ID")).startsWith(`RD:${recordKey}:`));
    const history = matchingNotes.filter(n =>
      cell(n.values, headerIndex(nh, "Visibility")) === "All" ||
      user.roles.includes("Admin") ||
      cell(n.values, headerIndex(nh, "Author")) === user.nameInSheets)
      .map(n => ({
        id: cell(n.values, headerIndex(nh, "Note ID")),
        created: cell(n.values, headerIndex(nh, "Created")),
        author: cell(n.values, headerIndex(nh, "Author")),
        note: cell(n.values, headerIndex(nh, "Note")),
      })).reverse();
    const attended = cell(row.values, idx.attended) === "Yes";
    return [{
      recordKey, revision: hash([row.values, matchingNotes.map(n => cell(n.values, headerIndex(nh, "Note ID")))]),
      clinicianEmail: email, name: cell(row.values, idx.name), rd, sessionDate, attended,
      result: cell(row.values, idx.result), practicalDate: formatSheetDate(cell(row.values, idx.date)),
      scoredBy: cell(row.values, idx.scoredBy) || (matchingNotes.length ? cell(matchingNotes[matchingNotes.length - 1].values, headerIndex(nh, "Author")) : ""),
      eligible: attended && sessionDate <= todayInAppTimeZone(), history,
      rowNumber: row.rowNumber,
    }];
  });
  if (new Set(records.map(r => r.recordKey)).size !== records.length) {
    throw new KimeuError("Duplicate clinician/workshop/date records must be resolved before sign-off.", 409, "PRACTICAL_DUPLICATE");
  }
  return {
    canSignOff: privileged(user),
    records: records.map(({ rowNumber: _row, ...record }) => record),
    internal: records.map(record => ({ ...record, tabName, idx, foundation })),
  };
}

export async function getPracticals(user: AppUser, workshopId: string) {
  const { internal: _internal, ...workspace } = await load(user, workshopId);
  return workspace;
}

export async function savePractical(user: AppUser, workshopId: string, input: PracticalSignoff) {
  assignedCourse(user, workshopId);
  if (!privileged(user)) throw new KimeuError("Only an assigned RD or Admin can sign off a practical.", 403, "ROLE_NOT_ALLOWED");
  if (!user.nameInSheets.trim()) throw new KimeuError("Your Name in Sheets is required for sign-off.", 409, "AUTHOR_NAME_REQUIRED");
  return withPracticalWriteLock(async () => {
    const current = await load(user, workshopId);
    const record = current.internal.find(r => r.recordKey === input.recordKey);
    if (!record) throw new KimeuError("This practical is not assigned to you or is no longer available.", 403, "PRACTICAL_NOT_ASSIGNED");
    if (record.revision !== input.revision) throw new KimeuError("This record changed. Reload and review it before saving again.", 409, "PRACTICAL_CHANGED");
    if (!record.eligible) throw new KimeuError("Confirmed workshop attendance is required before post-workshop sign-off.", 409, "ATTENDANCE_REQUIRED");
    const error = validPracticalInput(input.result, input.practicalDate, input.notes, record.sessionDate, todayInAppTimeZone());
    if (error) throw new KimeuError(error, 400, "INVALID_PRACTICAL");
    const timestamp = formatSheetTimestamp();
    const noteId = randomUUID();
    const extra: Array<{ tabName: string; rowNumber: number; columnIndex: number; header: string; value: CellValue }> = [];
    const add = (header: string, columnIndex: number, value: string) =>
      extra.push({ tabName: record.tabName, rowNumber: record.rowNumber, header, columnIndex, value });
    add("Practical Date", record.idx.date, input.practicalDate);
    add("Practical Result", record.idx.result, input.result);
    if (!record.foundation) add("Practical Scored By (RD)", record.idx.scoredBy, user.nameInSheets);
    add("Last Updated By", record.idx.updatedBy, user.nameInSheets);
    add("Last Updated", record.idx.updated, timestamp);
    await appendSparseInputRow(NOTES, [
      { header: "Note ID", value: noteId }, { header: "Created", value: timestamp },
      { header: "PT Email", value: record.clinicianEmail },
      { header: "Note Type", value: "Practical feedback" },
      { header: "Workshop ID", value: workshopId },
      { header: "Session ID", value: `${workshopId}-${record.sessionDate.replaceAll("-", "")}` },
      { header: "Review ID", value: `RD:${record.recordKey}:${noteId}` },
      { header: "Note", value: `${input.result === "Pass" ? "Passed" : "Not passed"} — ${input.practicalDate}${input.notes.trim() ? `\n${input.notes.trim()}` : ""}` },
      { header: "Author", value: user.nameInSheets },
      { header: "Author Role", value: user.roles.includes("RD") ? "RD" : "Admin" },
      { header: "Visibility", value: "Aaron + author" },
      { header: "Follow-up Needed", value: input.result === "Fail" },
    ], { autoHeaders: ["PT Name (auto)"], additionalWrites: extra });
    const result = await getPracticals(user, workshopId);
    const saved = result.records.find(r => r.recordKey === record.recordKey);
    if (!saved || saved.result !== input.result || saved.practicalDate !== input.practicalDate ||
        !saved.history.some(n => n.id === noteId)) {
      throw new KimeuError("The save was sent but could not be confirmed. Refresh before retrying.", 503, "PRACTICAL_READBACK_FAILED");
    }
    return result;
  });
}
