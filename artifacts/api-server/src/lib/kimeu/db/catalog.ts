import type { Sql } from "./client";
import type { AppUser } from "../access";
import { withRead } from "./transaction";
import { canonicalRole } from "../site-access-policy";
import { KimeuError } from "../sheets";

export async function readCatalog(sql: Sql) {
  const rows = await sql<{
    workshop_id: string; workshop_name: string | null; stage: string | null;
    region_topic: string | null; lead_sme: string | null;
  }[]>`
    select workshop_id, workshop_name, stage, region_topic, lead_sme
    from kimeu_workshops where deleted_at is null order by workshop_id
  `;
  const courses = rows.filter(r => r.workshop_id && r.workshop_name && r.stage).map(r => ({
    workshopId: r.workshop_id, name: r.workshop_name!, stage: r.stage!,
    topic: r.region_topic || null, leadSme: r.lead_sme || null,
  }));
  // These approved RD requirements already have their own onboarding records.
  // Preserve the legacy navigation entries without inventing database rows.
  if (!courses.some(c => c.workshopId === "F-11")) courses.unshift({
    workshopId: "F-11", name: "1.1 Orientation", stage: "Foundations",
    topic: "RD-led onboarding", leadSme: "Regional Director",
  });
  if (!courses.some(c => c.workshopId === "F-SURG-OBS")) courses.push({
    workshopId: "F-SURG-OBS", name: "Surgical Observation", stage: "Foundations",
    topic: "RD attendance confirmation", leadSme: "Regional Director",
  });
  return courses;
}

export async function findCourse(sql: Sql, id: string) {
  const matches = (await readCatalog(sql)).filter(c => c.workshopId === id);
  if (matches.length !== 1) throw new KimeuError("Workshop could not be uniquely identified.", 409, "COURSE_AMBIGUOUS");
  return matches[0];
}

export async function getCourses(user: AppUser) {
  return withRead(async sql => {
    const admin = user.roles.includes("Admin");
    const sme = user.roles.map(canonicalRole).some(r => r === "SME Assist" || r === "SME Lead");
    const rdOnly = (id: string) => ["F-11", "F-12", "EN-CAD", "F-SURG-OBS"].includes(id);
    const courses = (await readCatalog(sql)).filter(c =>
      admin || sme || (user.roles.includes("RD") && rdOnly(c.workshopId)) ||
      (!rdOnly(c.workshopId) && user.workshopIds.includes(c.workshopId)),
    ).map(c => ({ ...c, stage: ["EN-CAD", "F-SURG-OBS"].includes(c.workshopId) ? "Foundations" : c.stage }));
    return { courses };
  });
}
