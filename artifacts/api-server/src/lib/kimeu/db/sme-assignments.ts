import { createHash } from "node:crypto";
import { getSql, type Sql } from "./client";
import { withRead } from "./transaction";
import { canonicalRole } from "../site-access-policy";
import { KimeuError, normalizeEmail } from "../sheets";
import type { AppUser } from "../access";
import { requireRole } from "../access";
import type { SmeAssignmentInput } from "@workspace/api-zod";
import { randomUUID } from "node:crypto";
import { withKimeuLock } from "./transaction";
import { canLeadStage } from "../site-access-policy";
import { isRdOnboarding } from "../courses";
import { appendAudit } from "./audit";
import { readCatalog } from "./catalog";

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
    order by lower(email::text), app_user_id
  `;
  const courses = await readCatalog(sql);
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
    courses,
  };
}

export async function getSmeAssignments(user: AppUser) {
  if (!user.active) throw new KimeuError("Your staff access is inactive.", 403, "APP_USER_INACTIVE");
  requireRole(user, "Admin");
  return withRead((sql) => load(sql, user));
}

export async function saveSmeAssignment(user: AppUser, input: SmeAssignmentInput) {
  if (!user.active) throw new KimeuError("Your staff access is inactive.", 403, "APP_USER_INACTIVE");
  requireRole(user, "Admin");
  if (!user.nameInSheets.trim()) throw new KimeuError("Your staff display name is required.", 409, "AUTHOR_REQUIRED");
  return withKimeuLock(async sql => {
    const current = await load(sql, user);
    if (current.revision !== input.revision) throw new KimeuError("Staff access changed. Reload first.", 409, "STAFF_CHANGED");
    const email = normalizeEmail(input.email);
    const person = current.staff.find(p => p.email === email);
    if (!person) throw new KimeuError("This staff account must be approved before assigning SME responsibilities.", 404, "STAFF_NOT_FOUND");
    const smeRoles = [...new Set(input.smeRoles)];
    if (smeRoles.some(r => !["SME Assist", "SME Lead"].includes(r))) throw new KimeuError("Choose a valid SME title.", 400, "INVALID_SME_ROLE");
    const otherRoles = person.roles.filter(r => !["SME Assist", "SME Lead"].includes(r));
    const ids = [...new Set(input.workshopIds)];
    for (const id of ids) {
      const course = current.courses.find(c => c.workshopId === id);
      const retained = person.workshopIds.includes(id) && otherRoles.some(r => ["RD", "Admin", "Fellowship Reviewer", "CEU Admin"].includes(r));
      if (!course || (!retained && (isRdOnboarding(id) || !canLeadStage(smeRoles, course.stage)))) {
        throw new KimeuError("Workshop assignments must match the SME title; RD responsibilities are separate.", 400, "SME_ASSIGNMENT_MISMATCH");
      }
    }
    const originals = await sql<StaffRow[]>`
      select email, name_in_sheets, active, app_roles, workshop_ids
      from kimeu_app_users where lower(email::text) = ${email} and deleted_at is null
    `;
    if (originals.length !== 1) throw new KimeuError("Staff identity changed.", 409, "STAFF_CHANGED");
    const original = originals[0];
    if (original.active !== person.active ||
        hash([...new Set(list(original.app_roles ?? "").map(canonicalRole))].sort()) !== hash([...person.roles].sort()) ||
        hash(list(original.workshop_ids ?? "").sort()) !== hash([...person.workshopIds].sort())) {
      throw new KimeuError("Staff access changed before saving.", 409, "STAFF_CHANGED");
    }
    const roles = [...new Set([...otherRoles, ...smeRoles])];
    const changed = await sql<{ email: string }[]>`
      update kimeu_app_users set app_roles = ${roles.join(", ")}, workshop_ids = ${ids.join(", ")}
      where lower(email::text) = ${email} and deleted_at is null
        and app_roles is not distinct from ${original.app_roles}
        and workshop_ids is not distinct from ${original.workshop_ids}
        and active is not distinct from ${original.active}
      returning email
    `;
    if (changed.length !== 1) throw new KimeuError("Staff access changed or is not writable.", 409, "STAFF_CHANGED");
    await appendAudit(sql, user, { email, workshopId: "Staff access",
      reviewId: `SME assignment:${randomUUID()}`, note: {
        previousRoles: person.roles, roles, previousWorkshopIds: person.workshopIds, workshopIds: ids,
      } });
    const result = await load(sql, user);
    const saved = result.staff.find(p => p.email === email);
    if (!saved || hash([...saved.roles].sort()) !== hash([...roles].sort()) ||
        hash([...saved.workshopIds].sort()) !== hash([...ids].sort())) {
      throw new KimeuError("Assignment readback failed; the transaction was rolled back.", 503, "ASSIGNMENT_READBACK_FAILED");
    }
    return result;
  });
}
