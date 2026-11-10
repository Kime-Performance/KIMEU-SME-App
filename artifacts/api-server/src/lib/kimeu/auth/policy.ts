/**
 * Prepared Supabase cutover policy. Not mounted in the current Clerk app:
 * reconciliation approval must precede enforcement.
 */
export const SITE_ROLES = ["PT", "Fellowship Reviewer", "RD", "SME Assist", "SME Lead", "Admin", "CEU Admin"] as const;
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

const ALLOWED_ASSIGNMENTS: Record<SiteRole, readonly SiteRole[]> = {
  Admin: SITE_ROLES,
  "SME Lead": ["SME Lead", "SME Assist", "RD"],
  "SME Assist": ["SME Assist"],
  RD: ["RD"],
  "Fellowship Reviewer": ["Fellowship Reviewer"],
  "CEU Admin": ["CEU Admin"],
  PT: [],
};

/** Explicit owner matrix: never downgrade a forbidden assignment into a grant. */
export function effectiveRoles(
  ceiling: SiteRole, assignments: readonly string[],
  disagreement: (assignment: string) => void = () => {},
): SiteRole[] {
  const allowed: SiteRole[] = [];
  for (const raw of assignments) {
    const role = assignedRole(raw);
    if (!role || !ALLOWED_ASSIGNMENTS[ceiling].includes(role)) {
      disagreement(raw);
      continue;
    }
    allowed.push(role);
  }
  if (ceiling === "PT") return ["PT"];
  return [...new Set(allowed)];
}

const capabilities: Record<SiteRole, readonly Capability[]> = {
  PT: ["read"],
  "Fellowship Reviewer": ["read", "note", "review", "assessment"],
  RD: ["read", "note", "practical", "onboarding", "assessment"],
  "SME Assist": ["read", "note", "attendance"],
  "SME Lead": ["read", "note", "attendance", "practical", "onboarding", "assessment"],
  Admin: ["read", "note", "attendance", "practical", "onboarding", "assessment", "review", "admin", "course-admin"],
  "CEU Admin": ["read", "course-admin"],
};

export function permits(roles: readonly SiteRole[], capability: Capability): boolean {
  return roles.some(role => capabilities[role].includes(capability));
}

/** Stage leadership is explicit; no role hierarchy implies another SME title. */
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
  if (site !== "PT") return true;
  if (!actor?.personId) return false;
  return actor.personId === target.personId;
}
