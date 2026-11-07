import { requestAuthClient } from "./clients";
import { siteRole, type SiteRole } from "./policy";

export class AuthRejection extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

/** Request-local only: never serialize or log the session token. */
export type VerifiedIdentity = { authUserId: string; verifiedEmail: string; accessToken: string };
export type AccessRow = { auth_user_id: string | null; email: string; kimeu_sme: string | null };
export interface AccessStore {
  ownRoles(identity: VerifiedIdentity): Promise<{ kimeu_sme: string | null }[]>;
}
export type Principal = { authUserId: string; siteRole: SiteRole };
const pending = () => new AuthRejection(403, "ACCOUNT_PENDING", "Your account is pending setup. Contact your administrator.");
const invalid = () => new AuthRejection(401, "SIGN_IN_REQUIRED", "Sign in to continue.");

export async function verifiedIdentity(
  authorization: string | undefined,
  clientFactory = requestAuthClient,
): Promise<VerifiedIdentity> {
  const match = authorization?.match(/^Bearer ([^\s,]+)$/i);
  if (!match) throw invalid();
  let response;
  try {
    // Supabase's Auth server validates this project's token; no local decoding.
    response = await clientFactory().auth.getUser(match[1]);
  } catch {
    throw new AuthRejection(503, "IDENTITY_UNAVAILABLE", "Sign-in verification is temporarily unavailable.");
  }
  const user = response.data.user;
  if (response.error || !user?.id) throw invalid();
  if (!user.email_confirmed_at || !user.email?.trim()) {
    throw new AuthRejection(403, "EMAIL_REQUIRED", "Please confirm your email first — check your inbox.");
  }
  return { authUserId: user.id, verifiedEmail: user.email.trim().toLowerCase(), accessToken: match[1] };
}

/** No role cache: revocation is observed on the very next authorized request. */
export async function resolvePrincipal(
  identity: VerifiedIdentity,
  store: AccessStore,
  alert: (event: string) => void,
): Promise<Principal> {
  let rows;
  try {
    rows = await store.ownRoles(identity);
  } catch {
    throw new AuthRejection(503, "ROLE_UNAVAILABLE", "Account verification is temporarily unavailable.");
  }
  // The nightly roster sync owns binding. Zero rows never triggers an app write.
  if (rows.length !== 1) {
    alert("AUTH_BINDING_UNRESOLVED");
    throw pending();
  }
  const role = siteRole(rows[0].kimeu_sme);
  if (!role) throw pending();
  return { authUserId: identity.authUserId, siteRole: role };
}

export function requireSupabaseProvider(): void {
  if (process.env.AUTH_PROVIDER !== "supabase") {
    throw new AuthRejection(503, "AUTH_NOT_ENABLED", "Sign-in is unavailable until the authentication cutover is approved.");
  }
}
