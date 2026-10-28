export const SITE_ROLES = ["Foundations SME", "Elite SME", "RD", "Admin"] as const;

export function hasSiteRole(roles: readonly string[]): boolean {
  return roles.some(role => (SITE_ROLES as readonly string[]).includes(role));
}

export function verifiedPrimaryEmail(user: {
  primaryEmailAddressId: string | null;
  emailAddresses: Array<{ id: string; emailAddress: string; verification: { status: string } | null }>;
}): string | null {
  const primary = user.emailAddresses.find(email => email.id === user.primaryEmailAddressId);
  return primary?.verification?.status === "verified" ? primary.emailAddress.trim().toLowerCase() : null;
}
