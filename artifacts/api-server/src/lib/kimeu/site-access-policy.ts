export const SITE_ROLES = ["SME Assist", "SME Lead", "RD", "Fellowship Reviewer", "Admin"] as const;

export function canonicalRole(role: string): string {
  return role === "Foundations SME" ? "SME Assist" : role === "Elite SME" ? "SME Lead" : role;
}

export function canLeadStage(roles: readonly string[], stage: string): boolean {
  const names = roles.map(canonicalRole);
  if (names.includes("Admin")) return true;
  return /foundation/i.test(stage) ? names.includes("SME Assist")
    : /fellowship|advanced|enrichment/i.test(stage) && names.includes("SME Lead");
}

export function hasSiteRole(roles: readonly string[]): boolean {
  return roles.some(role => (SITE_ROLES as readonly string[]).includes(canonicalRole(role)));
}

export function verifiedPrimaryEmail(user: {
  primaryEmailAddressId: string | null;
  emailAddresses: Array<{ id: string; emailAddress: string; verification: { status: string } | null }>;
}): string | null {
  const primary = user.emailAddresses.find(email => email.id === user.primaryEmailAddressId);
  return primary?.verification?.status === "verified" ? primary.emailAddress.trim().toLowerCase() : null;
}
