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
  return recoveryRedirectForEnvironment({
    nodeEnv: process.env.NODE_ENV,
    previewHost: process.env.REPLIT_DEV_DOMAIN,
  });
}

/** Only the runtime-owned preview host may override recovery in development. */
export function recoveryRedirectForEnvironment(environment: {
  nodeEnv?: string;
  previewHost?: string;
}): string {
  if (environment.nodeEnv !== "development") return AUTH_REDIRECTS.recovery;
  const host = environment.previewHost;
  if (!host || !/^[a-z0-9][a-z0-9.-]*\.replit\.dev$/i.test(host)) {
    throw new Error("The test recovery callback is not configured.");
  }
  return `https://${host.toLowerCase()}/auth/recovery`;
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
