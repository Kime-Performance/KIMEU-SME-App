# Supabase Auth: prepared components, not an active cutover

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
- Frontend anon-client/password-sign-in/sign-out/bearer adapters, not yet
  imported by the active application.
- Prepared invite/recovery callback handlers with URL-secret clearing,
  type-specific OTP or PKCE exchange, provider-validated password update,
  session-change protection, and no role/binding mutation. These are functions,
  not yet mounted screens.
- PT object-scope building blocks use an injected server-side immutable person
  resolver, fail closed for missing/ambiguous linkage, and share ownership
  filtering for lists and exports. The PT business-write ban also runs before
  capability checks, even if an assignment resolver accidentally returns Admin.
  Handlers must still integrate these checks and sanitize nested session data.

## Not activated

Clerk remains the active login. These candidate modules are unmounted.
Changing AUTH_PROVIDER alone does not integrate them. No clinical data, roles,
bindings, grants, or active login configuration were changed.

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
No keys are requested in chat. Use secure Secrets configuration.
Recovery needs Oracle's exact redirect allowlist confirmation before its
route is activated. AUTH_PROVIDER is a cutover
control, not a credential.

## Remaining activation work

1. Wire the now-confirmed roster-email → app-user → person chain throughout
   handlers. Do not substitute request email/name/query identity. Staff ceiling
   outcomes, PT admission, CEU support and RD scope are resolved.
2. Configure the anon-only connection settings securely.
3. Add reset/sign-out endpoint contracts and generated helpers where needed;
   rate-limit public recovery and mount the deny-by-default business gate.
   Keep health status-only and remove development-readiness exposure.
4. Integrate immutable actor resolution, assignment checks and scoped list,
   detail and write handlers. PT access is self-only, with no business writes.
5. Wire actual login/recovery/transport/cache behavior and course-admin surfaces
   per the reviewed package. Do not invent CEU access to staff or clinical data.
6. Stage the Clerk replacement, then activate only after the mandatory invite,
   sync, reconciliation and approval sequence. Remove Clerk provider, middleware,
   proxy, dependencies and configuration in that activation change.
   No dual-provider fallback; disabled auth fails closed.
7. Verify real-provider sessions, isolation, pending setup, role revocation,
   preserved RD sign-offs, CEU restrictions and password recovery. Unit mocks
   do not establish a working live-provider flow.
8. Inspect the built app for obsolete auth/privileged credentials and publish
   only after reviewed cutover and critical-flow checks pass.

Never delete or truncate `public.kimeu_sessions` for authentication: those are
workshop records, not login sessions.
