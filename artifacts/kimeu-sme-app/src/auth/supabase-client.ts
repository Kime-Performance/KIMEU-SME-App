import { createClient } from "@supabase/supabase-js";

/**
 * Client adapter selected only by the explicit Supabase provider branch.
 * Clerk is retained for owner-controlled rollback during the phased rollout.
 * Only public VITE_* values are accepted; service-role keys never belong here.
 */
let client: ReturnType<typeof createClient> | undefined;
export function supabaseIdentity() {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (url !== "https://mzuitumuqidunwkaaxtz.supabase.co" || !key) {
    throw new Error("Supabase sign-in is not configured.");
  }
  client = createClient(url, key, {
    auth: { flowType: "pkce", detectSessionInUrl: false },
  });
  return client;
}

export async function bearerHeaders(): Promise<Headers> {
  const { data, error } = await supabaseIdentity().auth.getSession();
  if (error || !data.session) throw new Error("Sign in to continue.");
  return new Headers({ Authorization: `Bearer ${data.session.access_token}` });
}

export async function signInWithCompanyPassword(email: string, password: string) {
  const { data, error } = await supabaseIdentity().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(signInFailure(error.code));
  if (!data.user?.email_confirmed_at) {
    await supabaseIdentity().auth.signOut({ scope: "local" });
    throw new Error(signInFailure("email_not_confirmed"));
  }
  return data.session;
}

export async function signOutOfCompanyApp(clearUserState: () => void) {
  // Clear user-scoped in-memory state immediately, even on network failure.
  clearUserState();
  const { error } = await supabaseIdentity().auth.signOut({ scope: "local" });
  if (error) throw new Error("Sign-out could not be completed. Please try again.");
}

export function signInFailure(code?: string): string {
  if (code === "email_not_confirmed") return "Please confirm your email first — check your inbox.";
  if (code === "invalid_credentials") return "The email or password is incorrect.";
  return "Sign-in could not be completed. Check your connection and try again.";
}
