import { requestAuthClient } from "./clients";

export const RESET_RESPONSE = "If that account exists, we've emailed a reset link.";
// Verified via the deployment service on 2026-11-07. No client redirect input.
export const CANONICAL_APP_URL = "https://kimeu-sme-app.replit.app";
export const AUTH_REDIRECTS = {
  invite: `${CANONICAL_APP_URL}/auth/accept`,
  recovery: `${CANONICAL_APP_URL}/auth/recovery`,
} as const;

/** Redirects are server-configured, never supplied by the person requesting mail. */
function configuredRedirect(): string {
  return AUTH_REDIRECTS.recovery;
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
