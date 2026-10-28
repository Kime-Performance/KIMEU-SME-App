import type { AppUser } from "./access";
import { cell, dataRows, headerIndex, headersFor, KimeuError, readTab } from "./sheets";
import { canLeadStage, canonicalRole } from "./site-access-policy";

export const isRdAttendanceOnly = (id: string) => id === "EN-CAD" || id === "F-SURG-OBS";
export const isRdOnboarding = (id: string) => id === "F-11" || id === "F-12" || isRdAttendanceOnly(id);

export async function requireCourseWriter(user: AppUser, workshopId: string) {
  if (isRdOnboarding(workshopId)) throw new KimeuError("Use the RD onboarding sign-off page for this course.", 409, "USE_RD_ONBOARDING");
  const sheet = await readTab("03a-KIMEU Workshops");
  const h = headersFor(sheet);
  const row = dataRows(sheet).find(r => cell(r.values, headerIndex(h, "Workshop ID")) === workshopId);
  if (!row) throw new KimeuError("Workshop not found.", 404, "WORKSHOP_NOT_FOUND");
  if (!canLeadStage(user.roles, cell(row.values, headerIndex(h, "Stage")))) {
    throw new KimeuError("SME Assist leads Foundations; SME Lead leads Fellowship.", 403, "SME_STAGE_NOT_ALLOWED");
  }
}

export async function getCourses(user: AppUser) {
  const snapshot = await readTab("03a-KIMEU Workshops");
  const headers = headersFor(snapshot);
  const idColumn = headerIndex(headers, "Workshop ID");
  const nameColumn = headerIndex(headers, "Workshop Name");
  const stageColumn = headerIndex(headers, "Stage");
  const topicColumn = headerIndex(headers, "Region / Topic");
  const leadColumn = headerIndex(headers, "Lead SME");
  const admin = user.roles.includes("Admin");
  const sme = user.roles.map(canonicalRole).some(role => role === "SME Assist" || role === "SME Lead");
  const courses = dataRows(snapshot).flatMap((row) => {
    const workshopId = cell(row.values, idColumn);
    const name = cell(row.values, nameColumn);
    const stage = cell(row.values, stageColumn).trim();
    // The reference tab also contains director instructions/settings. Those
    // rows are not workshops and must not become "Unstaged" navigation links.
    if (!workshopId || !name || !stage) return [];
    const rdCourse = user.roles.includes("RD") && isRdOnboarding(workshopId);
    if (isRdOnboarding(workshopId) && !admin && !user.roles.includes("RD") && !sme) return [];
    // Catalog visibility does not grant attendance editing or RD sign-off.
    if (!admin && !sme && !rdCourse && !user.workshopIds.includes(workshopId)) return [];
    return [{
      workshopId, name, stage: isRdAttendanceOnly(workshopId) ? "Foundations" : stage,
      topic: cell(row.values, topicColumn) || null,
      leadSme: cell(row.values, leadColumn) || null,
    }];
  });
  if (!courses.some(c => c.workshopId === "F-11") && (admin || user.roles.includes("RD") || sme)) {
    courses.unshift({ workshopId: "F-11", name: "1.1 Orientation", stage: "Foundations", topic: "RD-led onboarding", leadSme: "Regional Director" });
  }
  if (!courses.some(c => c.workshopId === "F-SURG-OBS") && (admin || user.roles.includes("RD") || sme)) {
    courses.push({ workshopId: "F-SURG-OBS", name: "Surgical Observation", stage: "Foundations", topic: "RD attendance confirmation", leadSme: "Regional Director" });
  }
  return { courses };
}
