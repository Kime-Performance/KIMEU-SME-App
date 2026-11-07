/**
 * Prepared Supabase cutover policy. Not mounted in the current Clerk app:
 * reconciliation approval must precede enforcement.
 */
export const SITE_ROLES = ["PT", "Fellowship Reviewer", "RD", "SME Assist", "SME Lead", "Admin", "CEU Admin"] as const;
const CLINICAL_CEILING = ["PT", "Fellowship Reviewer", "RD", "SME Assist", "SME Lead", "Admin"] as const;
export type SiteRole = typeof SITE_ROLES[number];
export type Capability = "read" | "note" | "attendance" | "practical" | "onboarding" | "assessment" | "review" | "admin" | "course-admin";

export function siteRole(value: unknown): SiteRole | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().toLowerCase();
  return SITE_ROLES.find(role => role.toLowerCase() === clean) ?? null;
}

function assignedRole(value: string): SiteRole | null {
  const legacy = value.trim().toLowerCase();
  return siteRole(legacy === "foundations sme" ? "SME Assist" : legacy === "elite sme" ? "SME Lead" : value);
}

/** Clamp each assignment to the site ceiling, never elevate the site role. */
export function effectiveRoles(ceiling: SiteRole, assignments: readonly string[]): SiteRole[] {
  if (ceiling === "PT") return ["PT"];
  // CEU administration is orthogonal, not a higher clinical/user-admin tier.
  if (ceiling === "CEU Admin") return assignments.some(raw => assignedRole(raw) === "CEU Admin") ? ["CEU Admin"] : [];
  const ceilingRank = CLINICAL_CEILING.indexOf(ceiling);
  return [...new Set(assignments.flatMap(raw => {
    const role = assignedRole(raw);
    if (role === "CEU Admin") return ceiling === "Admin" ? [role] : [];
    return role ? [CLINICAL_CEILING[Math.min(ceilingRank, CLINICAL_CEILING.indexOf(role))]!] : [];
  }))];
}

const capabilities: Record<SiteRole, readonly Capability[]> = {
  PT: ["read"],
  "Fellowship Reviewer": ["read", "note", "review", "assessment"],
  RD: ["read", "note", "practical", "onboarding", "assessment"],
  "SME Assist": ["read", "note", "attendance"],
  "SME Lead": ["read", "note", "attendance", "practical", "onboarding", "assessment"],
  Admin: ["read", "note", "attendance", "practical", "onboarding", "assessment", "review", "admin"],
  "CEU Admin": ["course-admin"],
};

export function permits(roles: readonly SiteRole[], capability: Capability): boolean {
  return roles.some(role => capabilities[role].includes(capability));
}

/** No role ranking confers action rights; ranks only constrain assignments. */
export function mayLead(roles: readonly SiteRole[], stage: string): boolean {
  if (roles.includes("Admin")) return true;
  return /foundation/i.test(stage) ? roles.includes("SME Assist")
    : /fellowship|advanced|enrichment/i.test(stage) && roles.includes("SME Lead");
}

export type PersonScope = { personId: string };
export function withinScope(
  site: SiteRole, actor: PersonScope | null, target: PersonScope | null,
): boolean {
  if (!target?.personId) return false;
  if (site === "CEU Admin") return false;
  if (site === "Admin" || site === "RD") return true;
  if (!actor?.personId) return false;
  if (site === "PT") return actor.personId === target.personId;
  // Other staff still require the existing assignment/object checks.
  return true;
}
