import { createHash } from "node:crypto";
import type { FellowshipReviewInput } from "@workspace/api-zod";
import { requireRole, type AppUser } from "./access";
import { readCourseDirectory } from "./course-directory";
import {
  cell, dataRows, formatSheetDate, formatSheetTimestamp, headerIndex, headersFor,
  isUnusedFellowshipRow, KimeuError, normalizeEmail, prepareTrackingTemplateRows,
  readTab, todayInAppTimeZone, withPracticalWriteLock, writeMultipleInputCells,
} from "./sheets";

const TAB = "03d-Fellowship Review Log", NOTES = "03g-Clinician Notes";
const inputHeaders = ["Review Date", "Reviewed By", "Review Type", "PT Email", "PT Name", "Result", "Score",
  "Workshop ID (Refocus)", "Specific Need", "Notes", "Last Updated By", "Last Updated"];
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function authorize(user: AppUser) {
  if (!user.active) throw new KimeuError("Your staff access is inactive.", 403, "APP_USER_INACTIVE");
  requireRole(user, "Fellowship Reviewer");
}
async function load(user: AppUser, fresh = false) {
  authorize(user);
  const [directory, snapshot, catalog] = await Promise.all([
    readCourseDirectory(fresh), readTab(TAB, { force: true, dataStartRow: 4 }), readTab("03a-KIMEU Workshops", { force: fresh }),
  ]);
  const h = headersFor(snapshot), ch = headersFor(catalog);
  for (const name of [...inputHeaders, "Review ID", "Status"]) headerIndex(h, name);
  const get = (values: string[], name: string) => cell(values, headerIndex(h, name));
  const rows = dataRows(snapshot).filter(row => get(row.values, "PT Email"));
  const reviews = rows.map(({ values, rowNumber }) => {
    const rawScore = get(values, "Score").replace(/%$/, "").trim();
    return {
      id: `${get(values, "Review ID")}:${rowNumber}`,
      email: normalizeEmail(get(values, "PT Email")), name: get(values, "PT Name"),
      reviewDate: formatSheetDate(get(values, "Review Date")), reviewedBy: get(values, "Reviewed By"),
      reviewType: get(values, "Review Type"), result: get(values, "Result"),
      score: rawScore && Number.isFinite(Number(rawScore)) ? Number(rawScore) : null,
      notes: get(values, "Notes"), specificNeed: get(values, "Specific Need"),
      workshopId: get(values, "Workshop ID (Refocus)") || null,
      status: get(values, "Status"), updatedAt: get(values, "Last Updated"),
    };
  }).reverse();
  const people = directory.people.map(person => ({
    ...person,
    revision: hash([person, rows.filter(r => normalizeEmail(get(r.values, "PT Email")) === person.email)
      .map(r => [r.rowNumber, ...inputHeaders.map(name => get(r.values, name))])]),
  }));
  const workshops = dataRows(catalog).flatMap(({ values }) => {
    const id = cell(values, headerIndex(ch, "Workshop ID"));
    const name = cell(values, headerIndex(ch, "Workshop Name"));
    return id && name && cell(values, headerIndex(ch, "Stage")).toLowerCase() === "fellowship"
      ? [{ workshopId: id, name }] : [];
  });
  return { workspace: { today: todayInAppTimeZone(), people, reviews, workshops }, snapshot, h };
}
export async function getFellowshipReviews(user: AppUser) {
  return (await load(user)).workspace;
}

export async function saveFellowshipReview(user: AppUser, input: FellowshipReviewInput) {
  authorize(user);
  if (!user.nameInSheets.trim()) throw new KimeuError("Your Name in Sheets is required.", 409, "AUTHOR_REQUIRED");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId)) {
    throw new KimeuError("A valid save request ID is required.", 400, "INVALID_REVIEW");
  }
  const email = normalizeEmail(input.email), notes = input.notes.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reviewDate) ||
      !Number.isFinite(Date.parse(input.reviewDate)) ||
      new Date(input.reviewDate).toISOString().slice(0, 10) !== input.reviewDate ||
      input.reviewDate > todayInAppTimeZone()) {
    throw new KimeuError("Choose a valid review date that is not in the future.", 400, "INVALID_REVIEW_DATE");
  }
  if (!["Pass", "Refocus"].includes(input.result) || !Number.isFinite(input.score) ||
      input.score < 0 || input.score > 100 || notes.length > 4000 ||
      (input.result === "Refocus" && notes.length < 5)) {
    throw new KimeuError("Record Pass or Fail / Refocus, a score from 0 to 100, and meaningful notes for a failed review.", 400, "INVALID_REVIEW");
  }
  if (input.result === "Pass" && input.workshopId) {
    throw new KimeuError("A refocus workshop applies only to failed reviews.", 400, "INVALID_REVIEW");
  }
  const payload = { email, reviewDate: input.reviewDate, result: input.result, score: input.score, notes, workshopId: input.workshopId };
  const fingerprint = hash(payload), auditId = `FELLOWSHIP:${input.requestId}`;
  return withPracticalWriteLock(async () => {
    const state = await load(user, true);
    const audit = await readTab(NOTES, { force: true });
    const ah = headersFor(audit);
    const oldAudit = dataRows(audit).find(r => cell(r.values, headerIndex(ah, "Note ID")) === auditId);
    if (oldAudit) {
      let old: { fingerprint?: string; authorEmail?: string } = {};
      try { old = JSON.parse(cell(oldAudit.values, headerIndex(ah, "Note"))); } catch { /* Fail closed below. */ }
      if (old.fingerprint !== fingerprint || old.authorEmail !== user.email) {
        throw new KimeuError("This save ID was already used for a different review.", 409, "REVIEW_REQUEST_CONFLICT");
      }
      return state.workspace; // Safe retry after a lost response; never append twice.
    }
    const person = state.workspace.people.find(p => p.email === email);
    if (!person) throw new KimeuError("Select an available active PT from the master roster.", 409, "PT_UNAVAILABLE");
    if (person.revision !== input.revision) {
      throw new KimeuError("This PT's review history changed. Reload the latest record before saving; your draft has not been saved.", 409, "REVIEW_CHANGED");
    }
    if (input.workshopId && !state.workspace.workshops.some(w => w.workshopId === input.workshopId)) {
      throw new KimeuError("Select a Fellowship workshop from the current catalog.", 400, "INVALID_REFOCUS_WORKSHOP");
    }
    const unused = dataRows(state.snapshot).find(r => isUnusedFellowshipRow(r.values));
    const rowNumber = unused?.rowNumber ?? Math.max(4, state.snapshot.rows.length + 1);
    await prepareTrackingTemplateRows(TAB, rowNumber, 1);
    const at = formatSheetTimestamp();
    const values: Record<string, string | number> = {
      "Review Date": input.reviewDate, "Reviewed By": user.nameInSheets, "Review Type": "Fellowship Exam",
      "PT Email": email, "PT Name": person.name, "Result": input.result, "Score": input.score,
      "Workshop ID (Refocus)": input.workshopId ?? "", "Specific Need": input.result === "Refocus" ? notes : "",
      "Notes": notes, "Last Updated By": user.email, "Last Updated": at,
    };
    const auditRow = Math.max(3, audit.rows.length + 1);
    const auditValues: Record<string, string> = {
      "Note ID": auditId, "Created": at, "PT Email": email, "Note Type": "General",
      "Review ID": `Fellowship exam:${input.requestId}`,
      "Note": JSON.stringify({ ...payload, fingerprint, authorEmail: user.email, rowNumber }),
      "Author": user.nameInSheets, "Author Role": user.roles.includes("Admin") ? "Admin" : "Fellowship Reviewer",
      "Visibility": "Aaron + author",
    };
    await writeMultipleInputCells([
      ...Object.entries(values).map(([header, value]) => ({ tabName: TAB, rowNumber, header, value })),
      ...Object.entries(auditValues).map(([header, value]) => ({ tabName: NOTES, rowNumber: auditRow, header, value })),
    ]);
    const confirmed = await readTab(TAB, { force: true, dataStartRow: 4 });
    const h = headersFor(confirmed), row = confirmed.rows[rowNumber - 1] ?? [];
    for (const [header, expected] of Object.entries(values)) {
      const actual = cell(row, headerIndex(h, header));
      const matches = header === "Review Date" ? formatSheetDate(actual) === expected
        : header === "Score" ? Number(actual) === expected
        : header === "Last Updated" ? Boolean(actual.trim()) : actual === String(expected);
      if (!matches) throw new KimeuError("The review was submitted but readback could not confirm every field. Retry the same draft safely.", 503, "REVIEW_UNCONFIRMED");
    }
    const confirmedAudit = await readTab(NOTES, { force: true });
    if (!dataRows(confirmedAudit).some(r => cell(r.values, headerIndex(headersFor(confirmedAudit), "Note ID")) === auditId)) {
      throw new KimeuError("The review audit could not be confirmed. Retry the same draft safely.", 503, "REVIEW_UNCONFIRMED");
    }
    return (await load(user, true)).workspace;
  });
}
