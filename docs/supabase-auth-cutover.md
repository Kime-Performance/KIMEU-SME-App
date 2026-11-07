# Supabase Auth migration: prepared components, not an active cutover

The owner confirmed that shared prerequisites were applied and verified on
2026-11-07. Enforcement still requires the owner's reconciliation review.
The current deployed/runtime login has **not** been switched from Clerk.

## Prepared and unit-tested

- Server-side Supabase `getUser(token)` using a fresh client per request, with
  verified email required. The Auth URL is pinned to the approved shared project.
- Atomic first-login binding (`auth_user_id IS NULL`), safe same-user race retry,
  no rebinding, and subsequent resolution by immutable Auth ID.
- Role reads on every request (no role cache); exact, case-insensitive canonical
  site roles. Unknown, blank, legacy, or multi-value site roles deny admission.
- Assignment ceiling and explicit capability policy preserving RD practical,
  onboarding, and Foundations Assessment sign-offs. RD does not imply SME
  attendance or administrator permissions.
- Explicit deny-by-default candidate route registry, including coverage checks
  against current business-route declarations; scoped reads require an object
  enforcement callback. A newly declared route has no implicit access.
- Separate admin-only invitation operation, requiring a unique access row;
  reset-email operation with an enumeration-safe response. These operations
  are not exposed by new live routes.
- Frontend Supabase client/sign-in/sign-out/bearer adapters, not imported by the
  current application. No sign-up method or service-role key is used there.
- Read-only reconciliation command:

  ```
  node artifacts/api-server/scripts/reconcile-auth.mjs
  ```

  Reports go to ignored `generated-artifacts/auth-review/`, not Git or published
  app assets. They contain staff information and must only be shared with the
  owner/reviewers. The role census is from the synchronized DB, not a direct
  source-sheet inspection. Auth binding state does not prove an Auth account
  exists or is confirmed.

## Live read-only findings for the owner's review

The configured SME DB role can SELECT `email`, `auth_user_id`, `kimeu_sme` and
UPDATE `auth_user_id`. No grants were changed by this implementation.

The inspected `providers` table has **no `region` column**. The spec's proposed
`providers.region` resolver cannot be implemented literally. The owner must
identify an authoritative location-to-region mapping and stable actor/person
linkage before RD region-scoped access is activated. Missing mappings deny
access; there is no fallback to all PTs, names, or client-supplied regions.

The current access table does not expose a direct person/staff identity link
through the app's approved readable columns. A reviewed immutable identity
resolution contract is required so changes to Auth email cannot transfer
staff assignments or PT ownership. Do not substitute fresh Auth-email lookups
on subsequent requests.

## Intentionally not done before review

This is **not a completed authentication migration**. The candidate modules are
unmounted; changing AUTH_PROVIDER alone does not activate them. No live request
uses them and no accounts have been bound.

The activation change must:

1. Obtain the owner's signed-off reconciliation (including admin retention,
   unmatched/unsupported staff, and intended PT self-service admission).
2. Resolve immutable person/staff linkage, RD region source and scope ruling.
3. Configure public/server Supabase Auth settings through Secrets. No new keys
   have been requested or changed yet. The current environment has no
   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, or frontend
   VITE_SUPABASE_* configuration. Redirects must be allowlisted; never guess the
   published URL.
4. Define new invite/reset/sign-out API contracts in OpenAPI and regenerate
   schemas/hooks before exposing routes. Mount public auth routes with rate
   limiting; mount the global gate before business routers. Preserve
   health's status-only response; remove the development readiness route from
   the cutover API.
5. Wire every handler, list, detail and export to the new server-resolved actor,
   effective roles, workshop assignments, and immutable person/object scope.
   Do not just add a global role gate and assume existing email-based checks
   have become immutable-ID authorization.
6. Replace the actual login/provider/reset/invite screens and transport with
   Supabase adapters; clear all user caches/drafts on identity changes.
7. Remove the Clerk backend, frontend provider/components/proxy, dependencies,
   and configuration in that same activation change. No production dual-auth
   window or automatic fallback. Once activated, AUTH_PROVIDER unset/off
   must fail closed.
8. Verify real Auth token rejection, two-user isolation, PT list/detail/write
   boundaries, RD in/out-of-region behavior and Admin invitations/reset using
   isolated authorized fixtures. Unit tests with stubbed Auth responses are
   not equivalent to those real-provider/browser tests.
9. Check built frontend for Clerk keys/references and service-role secrets;
   publish only after cutover tests pass.

Never delete or truncate `public.kimeu_sessions` to revoke logins: it stores
workshop sessions. No workshop rows, clinical facts, permissions, or existing
login configuration were changed during preparation.
