import { createClient } from "@supabase/supabase-js";

const PROJECT_URL = "https://mzuitumuqidunwkaaxtz.supabase.co";
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

function projectUrl(): string {
  if (process.env.SUPABASE_URL?.replace(/\/$/, "") !== PROJECT_URL) {
    throw new Error("The approved Supabase Auth project is not configured.");
  }
  return PROJECT_URL;
}

/** Never cache this client: getUser/sign-in must not share auth state. */
export function requestAuthClient(accessToken?: string) {
  const key = process.env.SUPABASE_ANON_KEY;
  if (!key) throw new Error("Supabase public authentication configuration is missing.");
  return createClient(projectUrl(), key, {
    ...options,
    ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}),
  });
}
