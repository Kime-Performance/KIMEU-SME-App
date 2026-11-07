import { requestAuthClient } from "./clients";

export const RESET_RESPONSE = "If that account exists, we've emailed a reset link.";

/** Redirects are server-configured, never supplied by the person requesting mail. */
function configuredRedirect(): string {
  const raw = process.env.SUPABASE_AUTH_REDIRECT_URL;
  if (!raw) throw new Error("The approved password-reset redirect is not configured.");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("The approved authentication redirect must be an HTTPS URL.");
  }
  return url.toString();
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
