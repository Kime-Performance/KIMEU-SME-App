import type { VerifiedIdentity, Principal } from "./identity";
import { AuthRejection, resolvePrincipal, verifiedIdentity } from "./identity";
import { accessStore } from "./access-store";
import { effectiveRoles, type SiteRole } from "./policy";

export type StaffIdentity = {
  person_id: string | null; active: boolean | null;
  app_roles: string | null; workshop_ids: string | null;
  name_in_sheets?: string | null;
};
export interface StaffStore {
  byRosterEmail(email: string): Promise<StaffIdentity[]>;
}
export type RequestActor = {
  principal: Principal; roles: SiteRole[]; personId: string | null;
  workshopIds: string[];
  displayName?: string;
};
const split = (value: string | null) => [...new Set((value ?? "").split(",").map(v => v.trim()).filter(Boolean))];

/**
 * Prepared request-local chain. Never pass Auth email to the SQL staff store.
 * No cross-request identity/role cache and no token included in returned actor.
 */
export async function resolveRequestActor(
  authorization: string | undefined,
  dependencies: {
    staff: StaffStore;
    log(event: string): void;
    verify?: (authorization: string | undefined) => Promise<VerifiedIdentity>;
    access?: typeof accessStore;
  },
): Promise<RequestActor> {
  const identity = await (dependencies.verify ?? verifiedIdentity)(authorization);
  const principal = await resolvePrincipal(identity, dependencies.access ?? accessStore, dependencies.log);
  let rows: StaffIdentity[];
  try {
    rows = await dependencies.staff.byRosterEmail(principal.rosterEmail);
  } catch {
    throw new AuthRejection(503, "ASSIGNMENTS_UNAVAILABLE", "Staff assignments are temporarily unavailable.");
  }
  if (rows.length > 1) {
    dependencies.log("STAFF_IDENTITY_AMBIGUOUS");
    throw new AuthRejection(403, "ACCOUNT_PENDING", "Your account is pending setup. Contact your administrator.");
  }
  const staff = rows[0]?.active === true ? rows[0] : undefined;
  const roles = effectiveRoles(principal.siteRole, split(staff?.app_roles ?? null), () => {
    // No raw assignment, email, JWT or provider response in operational logs.
    dependencies.log("ASSIGNMENT_CEILING_DISAGREEMENT");
  });
  const personId = staff?.person_id?.trim() || null;
  if (principal.siteRole === "PT" && !personId) {
    throw new AuthRejection(403, "ACCOUNT_PENDING", "Your account is pending setup. Contact your administrator.");
  }
  return { principal, roles, personId, workshopIds: split(staff?.workshop_ids ?? null),
    displayName: staff?.name_in_sheets?.trim() || principal.rosterEmail };
}
