# Supabase Auth: integrated behind an inactive cutover

## Governing owner ruling — November 7, 2026

Global Rule 3 amendment to SME spec v2.2 supersedes the earlier checklist.

- The only Supabase API key permitted in this app is the **anon key**, with
  server and frontend configuration names. No privileged Supabase key or
  Auth admin client is permitted.
- Role reads use the verified user's **own session JWT**, via the anon client
  and own-row RLS: select `email,kimeu_sme` from `user_access`, filtering by
  the verified Auth ID (the JWT supplies `auth.uid()` to RLS). The email is
  sync-owned roster identity, never the mutable email returned by Auth.
- The app **never writes `user_access` or binds `auth_user_id`**. Nightly roster
  sync owns binding. Zero rows means **account pending setup**, fail closed.
- Oracle automation issues invitations. There is no app invitation operation,
  route, UI, or invitation credential requirement.
- Password recovery uses the anon client's `resetPasswordForEmail`, with
  enumeration-safe responses, approved redirects, and route rate limiting.
- **CEU Admin is supported**, for course-tracking/CEU writes and reads, but
  no user management, invitations, RD sign-offs, or assessment/review writes.
  CEU assignments require an Admin or CEU Admin ceiling.
- **RD scope is organization-wide**. No region mapping or region prerequisite
  is required. Preserve practicals, Orientation, Evaluation Retention, Cadaver
  Lab, Surgical Observation, and Foundations Assessment sign-offs.
- **PT admission is confirmed**: view-only, own-records object checks on every
  ID, list and export, with the person resolved server-side from immutable
  identity. No query-parameter identity selection and no business writes.

## Final reconciliation confirmation — November 7, 2026

The owner confirmed Oracle's live verification:

- An Admin ceiling with Fellowship Reviewer assignments intentionally retains
  only Fellowship Reviewer capabilities.
- An Admin ceiling with Fellowship Reviewer and SME Lead assignments
  intentionally retains those two capabilities. Neither combination is an
  error or an instruction to promote to effective Admin.
- CEU Admin site role and course-admin assignments agree and need no correction.
- Source sheet census: Admin 3, SME Lead 5, CEU Admin 1, PT 37, blank 14; no
  legacy/typo role values.
- Bindings intentionally start at 0/60 before invitations. This is expected
  pending setup, not an app defect and never justification for app-side binding.

Enforcement order is mandatory:
**Oracle invites → nightly sync binds → reconciliation re-run → owner approval.**
Build/test preparation is authorized now. Enforcement and publishing are not.

## Judge-reviewed Oracle addendum

Data access is not changing: the existing restricted server DB credential
(`kimeu_sme_app_bot` / `sme_app`) handles `kimeu_app_users` and clinical reads/
writes. Global Rule 3 applies to Auth keys and `user_access`, not a replacement
of the SQL data path. Preserve every `db/allowlist.ts` write allowlist.

Identity chain:
verified JWT → own-row `user_access.email,kimeu_sme` → match `kimeu_app_users`
by that sync-owned roster email → `person_id` for PT ownership.
The prepared SQL staff resolver uses only that roster email; it does not read
or write `user_access`. No Auth-email fallback is permitted.

Explicit assignment matrix (not a linear hierarchy):

| Ceiling | Permitted assignments / rights |
|---|---|
| Admin | All assignments |
| SME Lead | SME Lead, SME Assist, RD participation under existing action gates; reads |
| SME Assist | SME Assist; reads |
| RD | RD practical/onboarding/Foundations Assessment sign-offs; reads |
| Fellowship Reviewer | Fellowship review and Foundations Assessment writes; reads |
| CEU Admin | Course-tracking/CEU writes; reads; no user management |
| PT | Own-record view only; no business writes |

Forbidden assignments are dropped and a ceiling-disagreement event is logged;
they are never converted into another role. Missing/inactive app-user records
deny assignment-gated actions. Role-gated surfaces evaluate the valid ceiling
alone; a missing assignment is not an automatic site-role revocation. Unknown,
blank or multi-value site roles deny pending setup; the 14 blank rows are
intentional No Access, never default PT.

Every request re-verifies its bearer with `getUser`; a failed verification or
revoked identity returns 401. Public signup is reported OFF and Oracle must
re-verify that prerequisite before enforcement. RD org-wide scope covers
both reads and sign-off writes; `clinicians.region` is display-only.
App-side Admin assignment edits remain Admin-only, audited, with logging on
ceiling disagreement; sheet/sync ownership of assignments does not remove
these approved, allowlisted administrative edits.

## Canonical URL and Oracle allowlist handoff

Deployment service verified on November 7, 2026:
`https://kimeu-sme-app.replit.app`

Exact planned callbacks:

- Invite/account setup: `https://kimeu-sme-app.replit.app/auth/accept`
- Recovery: `https://kimeu-sme-app.replit.app/auth/recovery`

Use the canonical root as the logical `SUPABASE_AUTH_REDIRECT_URL`. No fifth
connection env is required: callback destinations are derived in code from
this verified root. Oracle must allowlist the exact callback URLs before use.
For token-hash email links, invitation uses `type=invite` and recovery uses
`type=recovery`; the `token_hash` is secret and must never be logged or pasted
into chat. PKCE code callbacks require the originating browser's verifier.
Oracle email templates must match the prepared callback format; implicit
access-token URL fragments are deliberately not accepted.

## Prepared and unit-tested

- Fresh per-request anon clients; server `getUser(token)` validates identity
  and confirmed email. No server `getSession` or unverified token decoding.
- Read-only own-row role store forwarding that same verified JWT, selecting
  sync-owned `email,kimeu_sme`. No Auth-email fallback, binding, SQL role lookup, or
  role cache. Errors/duplicates deny access; zero rows show pending setup.
- Explicit role/capability policy and candidate deny-by-default route registry.
  CEU course-tracking writes are a separate permitted capability on the
  existing tracking endpoint; this does not allow practicals or assessments.
- RD sign-offs use org-wide object scope for both reads and writes. Attendance/
  course-tracking assignment checks remain separate from role-gated sign-offs.
- Enumeration-safe password-reset operation; no invitation operation.
- Frontend anon-client/password-sign-in/sign-out/bearer adapters are connected
  to a deterministic staged provider branch. Clerk remains the default.
- Prepared invite/recovery callback handlers with URL-secret clearing,
  type-specific OTP or PKCE exchange, provider-validated password update,
  session-change protection, and no role/binding mutation. The invite and
  recovery screens are mounted in the staged Supabase route branch.
- PT object-scope building blocks use an injected server-side immutable person
  resolver, fail closed for missing/ambiguous linkage, and share ownership
  filtering for lists and exports. The PT business-write ban also runs before
  capability checks, even if an assignment resolver accidentally returns Admin.
  The actual PostgreSQL readers now constrain participants by the actor's
  app-user person ID: attendance tracking, practicals, onboarding, assessment,
  Fellowship reviews, session rosters and today's sessions. Session counters are
  recalculated from the scoped roster, inaccessible session details return 404,
  and group/private staff notes are withheld from PT responses.

## Not activated

Clerk remains the active business login. The server business boundary and
frontend replacement are wired behind explicit, inactive provider controls.
No clinical data, roles,
bindings, grants, or active login configuration were changed.

### Integrated staged behavior

- Server `AUTH_PROVIDER=supabase` selects fresh verified bearer authentication
  on business requests and skips Clerk middleware; it never retries with Clerk.
  The boundary denies unknown routes/methods and PT writes before handlers run.
  Actor resolution is memoized only within a request, never across requests.
- Frontend `VITE_AUTH_PROVIDER=supabase` selects the Supabase bridge and screens.
  Missing flags preserve Clerk. Other nonempty values fail closed.
  Do not change either flag until the owner's enforcement gate is satisfied.
- Supabase mode uses the sync-owned roster email for app-user linkage. The
  bootstrap exposes permitted assignments and the separate site-role ceiling,
  never the internal authorization context or JWT.
- Read-only PTs can reach their own attendance, practicals, onboarding,
  assessment and review surfaces, with no write controls. Record identity is
  resolved on the server, not from a search or query parameter.
- Staff reads are organization-wide. Role-gated RD/assessment actions do not
  require an RD assignment or regional link. Attendance/note assignment gates
  still require allowed assignments and authoritative workshop membership.
- CEU Admin assignments can use course-tracking attendance only for assigned
  workshops; they do not grant session creation, practicals, assessment or staff
  administration. Staff assignment edits retain the Admin gate and audit path;
  conflicting assignments remain denied/logged by the ceiling resolver.
- Password sign-in, reset requests, invite/recovery password setup, sign-out,
  password changes, pending-setup and revoked-session screens are wired.
  React Query is canceled/cleared when identity changes; drafts stay keyed by
  authenticated user ID. Exact 401/403 closes access even with cached data,
  while transient operational failures do not pretend to revoke staff access.

### Connected own-account endpoints

- `GET /api/auth/supabase/session` now runs the verified bearer → own RLS access
  row → restricted SQL staff chain on every call. It returns only the caller's
  sync-owned email, ceiling, permitted assignments, person ID and workshop IDs.
  It does not grant access to any existing business route or replace Clerk.
- `POST /api/auth/supabase/recovery` has a generated request/response contract,
  enumeration-safe 202 acknowledgement and bounded per-process source/account/
  global budgets. Delivery is disabled while `AUTH_PROVIDER` is not `supabase`;
  merely adding keys does not send account emails. These local budgets supplement
  Supabase limits, not a distributed rate limit across autoscale instances.
- These isolated endpoints run before Clerk, so Supabase bearer tokens are not
  passed to the wrong identity provider. Both responses are private/no-store.
  Auth rejection errors preserve their 401/403/503 statuses in the app handler.
- HTTP integration tests inject provider/SQL dependencies, send no real email
  and perform no clinical writes. They do not establish real-account login,
  callback or PT business-route isolation.

The earlier generated cross-account report is historical and predates this
owner ruling. In particular its unsupported-CEU and region-blocker statements
are superseded. The old direct-database reconciliation command is retired.
The final owner confirmation above supersedes its staff/scope concerns.

## Configuration

Proceed with these four Supabase connection settings:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (the same anon key)

Approved URL: `https://mzuitumuqidunwkaaxtz.supabase.co`.
Both anon-key Secrets have been confirmed present; their values are never read
or printed by the agent.
No keys are requested in chat. Use secure Secrets configuration.
Recovery needs Oracle's exact redirect allowlist confirmation before its
route is activated. AUTH_PROVIDER is a cutover
control, not a credential.

## Verification and remaining release gates

Automated checks cover the explicit matrix, the actual route boundary,
PostgreSQL reader scopes, privacy projection, provider choice, recovery HTTP
contracts and callback handling. SQL/Auth dependencies in those tests are fake:
they perform no live clinical writes, account creation or email delivery.

An isolated browser harness renders the real staged auth screens/bridge with a
fake SDK and API, without switching either provider flag. Its output is ignored
under `generated-artifacts`; it is not an application feature or deployable route.
These UI checks do not substitute for real-provider validation.

Remaining:

1. Oracle confirms exact redirect allowlisting and compatible email templates,
   then performs owner-authorized invitations and nightly identity binding.
2. Re-run reconciliation and obtain explicit owner cutover approval. Zero
   bindings before invites remains expected, not a reason for app-side binding.
3. Confirm production availability of all four connection settings. Stage a
   coordinated server/frontend provider change only after approval. Do not
   enable just one flag or use failures to fall back to the other provider.
4. Verify real-provider sign-in/recovery, revoked sessions, own-row RLS,
   participant isolation, RD sign-offs, CEU restrictions and approved fixture
   saves. No test has established those against newly invited Supabase accounts.
5. In the approved activation change, remove the unused Clerk provider, proxy,
   dependencies and settings rather than keeping a dual-provider fallback.
6. Confirm staff have submitted pending attendance drafts before changing
   providers, inspect the production bundle/configuration, and publish only
   after the reviewed cutover and critical-flow checks pass.

Never delete or truncate `public.kimeu_sessions` for authentication: those are
workshop records, not login sessions.
