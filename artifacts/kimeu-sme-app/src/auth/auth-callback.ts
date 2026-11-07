import { supabaseIdentity } from "./supabase-client";

/**
 * Prepared handlers for /auth/accept and /auth/recovery, not mounted yet.
 * Oracle should use type-specific token_hash email links for cross-device
 * invitations/recovery. PKCE code links require the original browser verifier.
 * No implicit token-fragment flow or open redirect is accepted.
 */
export async function preparePasswordCallback(
  href: string,
  dependencies: {
    clearUrl: () => void;
    clearUserState: () => void;
    client?: typeof supabaseIdentity;
  },
): Promise<(password: string) => Promise<void>> {
  const url = new URL(href);
  const expectedType = url.pathname === "/auth/accept" ? "invite"
    : url.pathname === "/auth/recovery" ? "recovery" : null;
  // Strip the sensitive callback URL before the first network request, even
  // when its parameters are invalid. Caller must use history.replaceState.
  dependencies.clearUrl();
  dependencies.clearUserState();
  if (url.origin !== "https://kimeu-sme-app.replit.app" || !expectedType || url.hash) {
    throw new Error("This account link is invalid. Request a new link.");
  }
  const code = url.searchParams.get("code");
  const token = url.searchParams.get("token_hash");
  const suppliedType = url.searchParams.get("type");
  const invalid = !code && !token || Boolean(code && token)
    || Boolean(token && suppliedType !== expectedType)
    || Boolean(code && suppliedType && suppliedType !== expectedType)
    || ["code", "token_hash", "type"].some(key => url.searchParams.getAll(key).length > 1);
  if (invalid) throw new Error("This account link is invalid. Request a new link.");
  const client = (dependencies.client ?? supabaseIdentity)();
  const result = token
    ? await client.auth.verifyOtp({ token_hash: token, type: expectedType })
    : await client.auth.exchangeCodeForSession(code!);
  if (result.error || !result.data.session || !result.data.user?.id) {
    throw new Error("This account link has expired or is invalid. Request a new link.");
  }
  const userId = result.data.user.id;
  let completed = false;
  return async (password: string) => {
    if (completed) throw new Error("This account link has already been used.");
    // Supabase remains authoritative for password strength/policy.
    if (!password) throw new Error("Enter a new password.");
    const verified = await client.auth.getUser();
    if (verified.error || verified.data.user?.id !== userId) {
      throw new Error("Your sign-in changed. Request a new account link.");
    }
    const update = await client.auth.updateUser({ password });
    if (update.error) throw new Error("The password could not be saved. Check password requirements and try again.");
    completed = true;
    dependencies.clearUserState();
    // Binding remains exclusively nightly sync's job. Successful Auth setup
    // must not treat an unbound user as approved for workspace admission.
  };
}
