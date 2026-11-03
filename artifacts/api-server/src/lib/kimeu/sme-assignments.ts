import { createHash, randomUUID } from "node:crypto";
import type { SmeAssignmentInput } from "@workspace/api-zod";
import { type AppUser, requireRole } from "./access";
import { getCourses, isRdOnboarding } from "./courses";
import { canonicalRole, canLeadStage } from "./site-access-policy";
import { cell, dataRows, formatSheetTimestamp, headerIndex, headersFor, KimeuError, normalizeEmail, readTab, withPracticalWriteLock, writeMultipleInputCells } from "./sheets";
import { isPostgresMode } from "./db/env";
import { getSmeAssignments as pgGetSmeAssignments } from "./db/sme-assignments";

const TAB = "03h-App Users";
const NOTES = "03g-Clinician Notes";
const list = (value: string) => [...new Set(value.split(",").map(v => v.trim()).filter(Boolean))];
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export async function getSmeAssignments(user: AppUser) {
  requireRole(user, "Admin");
  if (isPostgresMode()) return pgGetSmeAssignments(user);
  const [snapshot, catalog] = await Promise.all([readTab(TAB, { force: true }), getCourses(user)]);
  const h = headersFor(snapshot);
  const staff = dataRows(snapshot).filter(r => cell(r.values, headerIndex(h, "Email"))).map(r => ({
    email: normalizeEmail(cell(r.values, headerIndex(h, "Email"))),
    name: cell(r.values, headerIndex(h, "Name in Sheets")),
    active: cell(r.values, headerIndex(h, "Active")).toLowerCase() === "yes",
    roles: [...new Set(list(cell(r.values, headerIndex(h, "App Role(s)"))).map(canonicalRole))],
    workshopIds: list(cell(r.values, headerIndex(h, "Workshop IDs"))),
  }));
  if (new Set(staff.map(s => s.email)).size !== staff.length) throw new KimeuError("Duplicate staff emails must be resolved before assigning roles.", 409, "APP_USER_DUPLICATE");
  return { revision: hash(snapshot.rows), staff, courses: catalog.courses };
}

export async function saveSmeAssignment(user: AppUser, input: SmeAssignmentInput) {
  requireRole(user, "Admin");
  return withPracticalWriteLock(async () => {
    const current = await getSmeAssignments(user);
    if (input.revision !== current.revision) throw new KimeuError("Staff access changed. Reload before saving.", 409, "STAFF_CHANGED");
    const email = normalizeEmail(input.email);
    const person = current.staff.find(s => s.email === email);
    if (!person) throw new KimeuError("Add and approve this staff account before assigning SME responsibilities.", 404, "STAFF_NOT_FOUND");
    const smeRoles = [...new Set(input.smeRoles)];
    if (smeRoles.some(r => !["SME Assist", "SME Lead"].includes(r))) throw new KimeuError("Choose a valid SME title.", 400, "INVALID_SME_ROLE");
    const otherRoles = person.roles.filter(r => !["SME Assist", "SME Lead"].includes(r));
    const ids = [...new Set(input.workshopIds)];
    for (const id of ids) {
      const course = current.courses.find(c => c.workshopId === id);
      const retainedNonSme = person.workshopIds.includes(id) && otherRoles.some(r => ["RD", "Admin", "Fellowship Reviewer", "CEU Admin"].includes(r));
      if (!course || (!retainedNonSme && (isRdOnboarding(id) || !canLeadStage(smeRoles, course.stage)))) {
        throw new KimeuError("Assign SME Assist to Foundations and SME Lead to Fellowship workshops. RD onboarding is separate.", 400, "SME_ASSIGNMENT_MISMATCH");
      }
    }
    const snapshot = await readTab(TAB, { force: true });
    if (hash(snapshot.rows) !== current.revision) throw new KimeuError("Staff access changed before saving.", 409, "STAFF_CHANGED");
    const h = headersFor(snapshot);
    const row = dataRows(snapshot).find(r => normalizeEmail(cell(r.values, headerIndex(h, "Email"))) === email)!;
    const notes = await readTab(NOTES, { force: true });
    const nh = headersFor(notes);
    const nextNote = Math.max(notes.dataStartRow - 1, ...dataRows(notes).filter(r => cell(r.values, headerIndex(nh, "Note ID"))).map(r => r.rowNumber)) + 1;
    const newRoles = [...otherRoles, ...smeRoles];
    const updates = [
      { tabName: TAB, rowNumber: row.rowNumber, header: "App Role(s)", value: newRoles.join(", ") },
      { tabName: TAB, rowNumber: row.rowNumber, header: "Workshop IDs", value: ids.join(", ") },
      ...Object.entries({
        "Note ID": randomUUID(), Created: formatSheetTimestamp(), "PT Email": email,
        "Note Type": "General", "Review ID": `Staff SME assignment:${randomUUID()}`,
        Note: JSON.stringify({ action: "SME assignment", before: { roles: person.roles, workshopIds: person.workshopIds }, after: { roles: newRoles, workshopIds: ids } }),
        Author: user.nameInSheets, "Author Role": "Admin", Visibility: "Aaron + author",
      }).map(([header, value]) => ({ tabName: NOTES, rowNumber: nextNote, header, value })),
    ];
    await writeMultipleInputCells(updates);
    const result = await getSmeAssignments(user);
    const saved = result.staff.find(s => s.email === email);
    if (!saved || hash([...saved.roles].sort()) !== hash([...newRoles].sort()) || hash([...saved.workshopIds].sort()) !== hash([...ids].sort())) {
      throw new KimeuError("Assignment save could not be confirmed. Reload before retrying.", 503, "ASSIGNMENT_READBACK_FAILED");
    }
    return result;
  });
}
