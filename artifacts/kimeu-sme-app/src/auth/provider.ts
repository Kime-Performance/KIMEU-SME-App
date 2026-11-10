/**
 * Auth provider selection. Clerk is the default. Supabase is selected ONLY by
 * the exact value VITE_AUTH_PROVIDER=supabase. Any other non-empty value fails
 * closed: no runtime fallback between providers.
 */
export type AuthProviderName = 'clerk' | 'supabase';
export type AuthProviderSelection = { ok: true; provider: AuthProviderName } | { ok: false; value: string };

export function selectAuthProvider(raw: unknown): AuthProviderSelection {
  if (raw === undefined || raw === null || raw === '') return { ok: true, provider: 'clerk' };
  if (raw === 'clerk') return { ok: true, provider: 'clerk' };
  if (raw === 'supabase') return { ok: true, provider: 'supabase' };
  return { ok: false, value: String(raw) };
}

export const authProviderSelection = selectAuthProvider(import.meta.env.VITE_AUTH_PROVIDER);

export const WRITER_ROLES = ['Admin', 'Foundations SME', 'Elite SME', 'SME Lead', 'SME Assist'];
/** Assignment roles (bootstrap.user.roles) that may record sessions. Ceilings never grant this. */
export const SESSION_WRITER_ASSIGNMENTS = WRITER_ROLES;
/** UI visibility only. The server enforces every write. */
export function siteRoleOf(user: unknown): string | null {
  const value = (user as { siteRole?: unknown } | null | undefined)?.siteRole;
  return typeof value === 'string' && value ? value : null;
}
/** Admin visibility follows the site-role ceiling, falling back to an Admin assignment. */
export function isSiteAdmin(user: { roles?: readonly string[] } | null | undefined) {
  const site = siteRoleOf(user);
  if (site) return site === 'Admin';
  return (user?.roles ?? []).some((role) => role.toLowerCase() === 'admin');
}
export function isReadOnlyPt(roles: readonly string[] | undefined, user?: unknown) {
  if (siteRoleOf(user) === 'PT') return true;
  const list = roles ?? [];
  return list.includes('PT') && !list.some((role) => WRITER_ROLES.includes(role) || ['rd', 'regional director', 'fellowship reviewer', 'admin'].includes(role.toLowerCase()));
}

export function authErrorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}
export function isAuthRejection(error: unknown) {
  const status = authErrorStatus(error);
  return status === 401 || status === 403;
}

export const VALID_SITE_ROLES = ['Admin', 'SME Lead', 'SME Assist', 'RD', 'Fellowship Reviewer', 'CEU Admin', 'PT'];
type RoleUser = { roles?: readonly string[] } | null | undefined;
/** Supabase site-role ceiling present and valid. */
export function validSiteRole(user: RoleUser): string | null {
  const site = siteRoleOf(user);
  return site && VALID_SITE_ROLES.includes(site) ? site : null;
}
function legacyFa(user: RoleUser) {
  return (user?.roles ?? []).some((r) => ['admin', 'rd', 'regional director'].includes(r.toLowerCase()));
}
function legacyFr(user: RoleUser) {
  return (user?.roles ?? []).some((r) => r.toLowerCase() === 'admin' || r === 'Fellowship Reviewer');
}
/** UI visibility only; the server authorises every read and write. */
export function foundationsAccess(user: RoleUser) {
  const site = validSiteRole(user);
  if (siteRoleOf(user) && !site) return { read: false, write: false };
  if (site) return { read: true, write: ['Admin', 'RD', 'SME Lead', 'Fellowship Reviewer'].includes(site) };
  const legacy = legacyFa(user);
  return { read: legacy, write: legacy };
}
export function fellowshipAccess(user: RoleUser) {
  const site = validSiteRole(user);
  if (siteRoleOf(user) && !site) return { read: false, write: false };
  if (site) return { read: true, write: ['Admin', 'Fellowship Reviewer'].includes(site) };
  const legacy = legacyFr(user);
  return { read: legacy, write: legacy };
}
