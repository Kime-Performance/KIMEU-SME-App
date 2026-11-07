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
export function requestAuthClient() {
  const key = process.env.SUPABASE_ANON_KEY;
  if (!key) throw new Error("Supabase public authentication configuration is missing.");
  return createClient(projectUrl(), key, options);
}

let admin: ReturnType<typeof createClient> | undefined;
/** Expose only admin operations, never the mutable sign-in client. */
export function authAdministration() {
  if (admin) return admin.auth.admin;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Supabase invitation administration is not configured.");
  admin = createClient(projectUrl(), key, options);
  return admin.auth.admin;
}
