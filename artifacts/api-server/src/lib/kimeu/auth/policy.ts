/**
 * Prepared Supabase cutover policy. Not mounted in the current Clerk app:
 * reconciliation and RD scope approval must precede enforcement.
 */
export const SITE_ROLES = ["PT", "Fellowship Reviewer", "RD", "SME Assist", "SME Lead", "Admin"] as const;
export type SiteRole = typeof SITE_ROLES[number];
export type Capability = "read" | "note" | "attendance" | "practical" | "onboarding" | "assessment" | "review" | "admin";

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
  const ceilingRank = SITE_ROLES.indexOf(ceiling);
  return [...new Set(assignments.flatMap(raw => {
    const role = assignedRole(raw);
    return role ? [SITE_ROLES[Math.min(ceilingRank, SITE_ROLES.indexOf(role))]!] : [];
  }))];
}

const capabilities: Record<SiteRole, readonly Capability[]> = {
  PT: ["read"],
  "Fellowship Reviewer": ["read", "note", "review", "assessment"],
  RD: ["read", "note", "practical", "onboarding", "assessment"],
  "SME Assist": ["read", "note", "attendance"],
  "SME Lead": ["read", "note", "attendance", "practical", "onboarding", "assessment"],
  Admin: ["read", "note", "attendance", "practical", "onboarding", "assessment", "review", "admin"],
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

export type PersonScope = { personId: string; region: string | null };
export function withinScope(
  site: SiteRole, actor: PersonScope | null, target: PersonScope | null,
): boolean {
  if (!target?.personId) return false;
  if (site === "Admin") return true;
  if (!actor?.personId) return false;
  if (site === "PT") return actor.personId === target.personId;
  if (site === "RD") {
    const region = actor.region?.trim().toLowerCase();
    return Boolean(region && region === target.region?.trim().toLowerCase());
  }
  // Other staff still require the existing assignment/object checks.
  return true;
}
