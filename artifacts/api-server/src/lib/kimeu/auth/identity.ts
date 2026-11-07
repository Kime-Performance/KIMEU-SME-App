import { requestAuthClient } from "./clients";
import { siteRole, type SiteRole } from "./policy";

export class AuthRejection extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export type VerifiedIdentity = { authUserId: string; verifiedEmail: string };
export type AccessRow = { auth_user_id: string | null; email: string; kimeu_sme: string | null };
export interface AccessStore {
  byAuthId(id: string): Promise<AccessRow[]>;
  bindUnclaimed(id: string, verifiedEmail: string): Promise<AccessRow[]>;
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
  return { authUserId: user.id, verifiedEmail: user.email.trim().toLowerCase() };
}

/** No role cache: revocation is observed on the very next authorized request. */
export async function resolvePrincipal(
  identity: VerifiedIdentity,
  store: AccessStore,
  alert: (event: string) => void,
): Promise<Principal> {
  // Existing binding wins even after a verified Auth email change.
  let rows = await store.byAuthId(identity.authUserId);
  if (!rows.length) {
    try {
      rows = await store.bindUnclaimed(identity.authUserId, identity.verifiedEmail);
    } catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error;
      // A concurrent login may have established the SAME binding.
    }
    if (!rows.length) rows = await store.byAuthId(identity.authUserId);
  }
  if (rows.length !== 1 || rows[0].auth_user_id !== identity.authUserId) {
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
