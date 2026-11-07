import { effectiveRoles, siteRole } from "./policy";
import type { AccessRow } from "./identity";

export type StaffAccount = {
  email: string | null; name_in_sheets: string | null; active: boolean | null;
  app_roles: string | null; workshop_ids: string | null;
};
const normalized = (email: string | null) => email?.trim().toLowerCase() ?? "";

export function reconcileAccess(staff: StaffAccount[], access: AccessRow[]) {
  const census = new Map<string, number>();
  for (const row of access) {
    const raw = row.kimeu_sme ?? "(NULL)";
    census.set(raw, (census.get(raw) ?? 0) + 1);
  }
  const accounts = staff.map(account => {
    const email = normalized(account.email);
    const matches = email ? access.filter(row => normalized(row.email) === email) : [];
    const row = matches.length === 1 ? matches[0] : undefined;
    const role = siteRole(row?.kimeu_sme);
    const assigned = (account.app_roles ?? "").split(",").map(r => r.trim()).filter(Boolean);
    const effective = role ? effectiveRoles(role, assigned) : [];
    const issues: string[] = [];
    if (!email) issues.push("MISSING_STAFF_EMAIL");
    else if (matches.length !== 1) issues.push(matches.length ? "DUPLICATE_ACCESS_EMAIL" : "NO_ACCESS_ROW");
    if (row && !role) issues.push("NO_VALID_SME_ROLE");
    if (role && !effective.length) issues.push("NO_EFFECTIVE_CAPABILITY");
    if (account.active !== true) issues.push("STAFF_INACTIVE");
    if (row && !row.auth_user_id) issues.push("AUTH_ID_NOT_BOUND");
    if (role && effective.length && !effective.includes(role)) issues.push("CAPABILITY_BELOW_SITE_ROLE");
    return {
      email: account.email, name: account.name_in_sheets, active: account.active,
      assignedRoles: assigned, workshopIds: account.workshop_ids,
      rawSiteRole: row?.kimeu_sme ?? null, siteRole: role,
      authUserId: row?.auth_user_id ?? null, effectiveRoles: effective, issues,
    };
  });
  const active = accounts.filter(a => a.active === true);
  const retainedAdmins = active.filter(a => a.effectiveRoles.includes("Admin"));
  return {
    status: "OWNER_REVIEW_REQUIRED",
    enforcementApproved: false,
    summary: {
      totalStaff: accounts.length, activeStaff: active.length,
      activeWithValidSiteRole: active.filter(a => a.siteRole).length,
      activeWithEffectiveAdmin: retainedAdmins.length,
      activeWithoutEffectiveCapability: active.filter(a => !a.effectiveRoles.length).length,
      activeUnbound: active.filter(a => !a.authUserId).length,
    },
    // This census is of the synchronized DB field, NOT proof of sheet contents.
    databaseRoleCensus: [...census].map(([value, count]) => ({ value, count })),
    accounts,
  };
}
