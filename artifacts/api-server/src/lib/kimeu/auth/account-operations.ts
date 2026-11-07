import { authAdministration, requestAuthClient } from "./clients";
import { AuthRejection, type Principal } from "./identity";
import type { SiteRole } from "./policy";

export const RESET_RESPONSE = "If that account exists, we've emailed a reset link.";

/** Redirects are server-configured, never supplied by the person requesting mail. */
function configuredRedirect(): string {
  const raw = process.env.SUPABASE_AUTH_REDIRECT_URL;
  if (!raw) throw new Error("The approved invitation/reset redirect is not configured.");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("The approved authentication redirect must be an HTTPS URL.");
  }
  return url.toString();
}

/**
 * Prepared internal operation, not a mounted endpoint.
 * Caller must supply the server-resolved principal and effective roles.
 */
export async function inviteApprovedUser(
  actor: Principal, effective: readonly SiteRole[], inputEmail: string,
  dependencies: {
    accessMatches(email: string): Promise<number>;
    admin?: typeof authAdministration;
    redirect?: () => string;
  },
): Promise<void> {
  if (actor.siteRole !== "Admin" || !effective.includes("Admin")) {
    throw new AuthRejection(403, "ROLE_NOT_ALLOWED", "Only an administrator can issue invitations.");
  }
  const email = inputEmail.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new AuthRejection(400, "INVALID_EMAIL", "Enter a valid email address.");
  }
  if (await dependencies.accessMatches(email) !== 1) {
    throw new AuthRejection(403, "INVITE_NOT_APPROVED", "The invitation requires an existing, unique approved access row.");
  }
  const admin = (dependencies.admin ?? authAdministration)();
  const result = await admin.inviteUserByEmail(email, {
    redirectTo: (dependencies.redirect ?? configuredRedirect)(),
  });
  if (result.error) throw new AuthRejection(503, "INVITE_FAILED", "The invitation could not be sent.");
}

/** Route must rate-limit before calling; identical response for all accounts. */
export async function requestPasswordReset(
  inputEmail: string,
  dependencies: {
    client?: typeof requestAuthClient;
    redirect?: () => string;
    failure(event: string): void;
  },
): Promise<string> {
  try {
    const email = inputEmail.trim().toLowerCase();
    if (email && email.length <= 254) {
      const result = await (dependencies.client ?? requestAuthClient)().auth.resetPasswordForEmail(email, {
        redirectTo: (dependencies.redirect ?? configuredRedirect)(),
      });
      if (result.error) dependencies.failure("RESET_DELIVERY_FAILED");
    }
  } catch {
    // No email, error text, tokens, or provider responses in logs.
    dependencies.failure("RESET_DELIVERY_FAILED");
  }
  return RESET_RESPONSE;
}
