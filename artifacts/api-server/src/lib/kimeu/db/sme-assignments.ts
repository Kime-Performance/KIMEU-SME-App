import { createHash } from "node:crypto";
import { getSql, type Sql } from "./client";
import { withRead } from "./transaction";
import { canonicalRole } from "../site-access-policy";
import { KimeuError, normalizeEmail } from "../sheets";
import type { AppUser } from "../access";

const list = (value: string) =>
  [...new Set(value.split(",").map((v) => v.trim()).filter(Boolean))];
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");

type StaffRow = {
  email: string;
  name_in_sheets: string;
  active: boolean;
  app_roles: string;
  workshop_ids: string;
};

async function load(sql: Sql, user: AppUser) {
  const staffRows = await sql<StaffRow[]>`
    select email, name_in_sheets, active, app_roles, workshop_ids
    from kimeu_app_users
    where deleted_at is null
      and email is not null
  `;
  const courseRows = await sql<{ workshop_id: string; workshop_name: string; stage: string }[]>`
    select workshop_id, workshop_name, stage
    from kimeu_workshops
    where deleted_at is null
  `;
  const staff = staffRows.map((row) => ({
    email: normalizeEmail(row.email),
    name: row.name_in_sheets ?? "",
    active: row.active ?? false,
    roles: [...new Set(list(row.app_roles ?? "").map(canonicalRole))],
    workshopIds: list(row.workshop_ids ?? ""),
  }));
  if (new Set(staff.map((s) => s.email)).size !== staff.length) {
    throw new KimeuError(
      "Duplicate staff emails must be resolved before assigning roles.",
      409,
      "APP_USER_DUPLICATE",
    );
  }
  return {
    revision: hash(staffRows.map((r) => [r.email, r.active, r.app_roles, r.workshop_ids])),
    staff,
    courses: courseRows.map((c) => ({
      workshopId: c.workshop_id,
      name: c.workshop_name,
      stage: c.stage,
      topic: null,
      leadSme: null,
    })),
  };
}

export async function getSmeAssignments(user: AppUser) {
  return withRead((sql) => load(sql, user));
}

// Writes intentionally deferred: see PR description for SME assignment
// cutover status. The sheets path continues to own 03h writes.
