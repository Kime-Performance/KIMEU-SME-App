# Supabase Auth: prepared components, not an active cutover

## Governing owner ruling — November 7, 2026

Global Rule 3 amendment to SME spec v2.2 supersedes the earlier checklist.

- The only Supabase API key permitted in this app is the **anon key**, with
  server and frontend configuration names. No privileged Supabase key or
  Auth admin client is permitted.
- Role reads use the verified user's **own session JWT**, via the anon client
  and own-row RLS: select only `kimeu_sme` from `user_access`, filtering by
  the verified Auth ID (the JWT supplies `auth.uid()` to RLS).
- The app **never writes `user_access` or binds `auth_user_id`**. Nightly roster
  sync owns binding. Zero rows means **account pending setup**, fail closed.
- Oracle automation issues invitations. There is no app invitation operation,
  route, UI, or invitation credential requirement.
- Password recovery uses the anon client's `resetPasswordForEmail`, with
  enumeration-safe responses, approved redirects, and route rate limiting.
- **CEU Admin is supported**, for CEU/course administration only. It is not a
  higher clinical role and grants no user management, invitations, attendance,
  RD sign-offs, assessment/review writes, or clinical-record read permission.
- **RD scope is organization-wide**. No region mapping or region prerequisite
  is required. Preserve practicals, Orientation, Evaluation Retention, Cadaver
  Lab, Surgical Observation, and Foundations Assessment sign-offs.

## Prepared and unit-tested

- Fresh per-request anon clients; server `getUser(token)` validates identity
  and confirmed email. No server `getSession` or unverified token decoding.
- Read-only own-row role store forwarding that same verified JWT, selecting
  only `kimeu_sme`. No email fallback, binding, privileged SQL role lookup, or
  role cache. Errors/duplicates deny access; zero rows show pending setup.
- Explicit role/capability policy and candidate deny-by-default route registry.
  CEU administration is orthogonal to the clinical ceiling; existing clinical
  routes do not become CEU management routes. Course-admin endpoint contracts
  and the applicable CEU surfaces await Oracle's full reconciliation package.
- RD sign-off capabilities with org-wide object scope. Workshop assignment
  checks remain separate from object scope and must follow the reviewed spec.
- Enumeration-safe password-reset operation; no invitation operation.
- Frontend anon-client/password-sign-in/sign-out/bearer adapters, not yet
  imported by the active application.

## Not activated

Clerk remains the active login. These candidate modules are unmounted.
Changing AUTH_PROVIDER alone does not integrate them. No clinical data, roles,
bindings, grants, or active login configuration were changed.

The earlier generated cross-account report is historical and predates this
owner ruling. In particular its unsupported-CEU and region-blocker statements
are superseded. The old direct-database reconciliation command is retired.
Oracle will supply the updated reconciliation package separately.

## Configuration

Proceed with these four Supabase connection settings:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (the same anon key)

Approved URL: `https://mzuitumuqidunwkaaxtz.supabase.co`.
No keys are requested in chat. Use secure Secrets configuration.
Recovery also needs an approved allowlisted return destination before its
route is activated; never guess a production URL. AUTH_PROVIDER is a cutover
control, not a credential.

## Remaining activation work

1. Review Oracle's forthcoming full reconciliation package, including intended
   effective staff assignments, immutable Auth-to-staff/person linkage, and
   any PT self-service admission. CEU support and org-wide RD scope are already
   decided and must not be reopened as blockers.
2. Configure the anon-only connection settings securely.
3. Add reset/sign-out endpoint contracts and generated helpers where needed;
   rate-limit public recovery and mount the deny-by-default business gate.
   Keep health status-only and remove development-readiness exposure.
4. Integrate immutable actor resolution, assignment checks and scoped list,
   detail and write handlers. PT access, if approved, remains self-only.
5. Wire actual login/recovery/transport/cache behavior and course-admin surfaces
   per the reviewed package. Do not invent CEU access to staff or clinical data.
6. Remove Clerk provider, middleware, proxy, dependencies and configuration in
   the activation change. No dual-provider fallback; disabled auth fails closed.
7. Verify real-provider sessions, isolation, pending setup, role revocation,
   preserved RD sign-offs, CEU restrictions and password recovery. Unit mocks
   do not establish a working live-provider flow.
8. Inspect the built app for obsolete auth/privileged credentials and publish
   only after reviewed cutover and critical-flow checks pass.

Never delete or truncate `public.kimeu_sessions` for authentication: those are
workshop records, not login sessions.
