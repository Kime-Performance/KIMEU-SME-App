---
name: Private SME and RD access
description: Who may enter the KIMEU workspace and the user's intended sign-in method.
---

The SME app admits approved staff (SMEs, RDs, Fellowship reviewers, limited CEU Admins and director/admins) and approved PTs with strictly self-only view access. The user is comfortable using email and password. The app will have a place in Kajabi; anyone may see the cover page, but workspace access requires approved authentication.

**Why:** The user requested a private site, later added Fellowship reviewers, and confirmed PT self-only admission in Oracle's final package on November 7, 2026.

**How to apply:** Keep the cover page public. Require approved access before serving workspace data. A Kajabi membership, corporate-domain address, or newly created authentication account alone must not grant access. Fellowship Reviewer admission grants reviews/Foundations Assessment, not SME attendance or RD practicals. CEU Admin grants course-tracking/CEU writes and reads, not user management or clinical sign-offs. Preserve course-level permissions. Let the authentication provider handle passwords; Oracle automation handles invitations. Never put passwords in the roster or app-user sheet.

Do not treat a failure in a separate workshop/log sheet-health check as revocation of a freshly approved staff account. Keep an already verified workspace and its draft forms mounted during transient connection-refresh errors, but enforce fresh authorization on every server-side save and honor explicit access revocation.

**Why:** During RD workflow verification, temporary Google Sheets read failures produced a setup-incomplete response that closed the approved user's workspace and could discard unsaved forms.

**How to apply:** Separate authorization from operational readiness. Never grant first-time access from a failed approval check, share cached workspace state across identities, or weaken the server's approval checks to work around connection outages.

The director plans to assign SMEs through the administrative controls after publishing and confirming access is secure. Every approved SME should see all workshop subpages, but visibility must not authorize attendance edits, RD sign-offs, or access to PT records outside their permitted work. Administrator access remains necessary.

**Why:** The user explicitly distinguished all-workshop visibility from the approved, secure staff login and said assignments will happen after publishing.

**How to apply:** Do not assign staff or broaden site admission merely to populate navigation. Let approved SME Assist and SME Lead accounts browse the full workshop catalog, while server-side role and assignment checks continue to protect each tracking action and record.

PT participants do not need authentication accounts merely to appear in the roster or have workshop requirements recorded.

**Why:** The product grants workspace login to approved staff, who select PT participants for tracking; those are separate identities and permissions.

**How to apply:** Keep roster eligibility independent of whether a PT has a Supabase Auth or Clerk account. Do not provision PT logins to work around missing roster links. Use the authoritative clinical roster and verified participant identifiers instead. Do not change financial-provider identities merely to populate the SME roster; clinical participation and financial-provider linkage are separate concerns.

RD sign-off permissions must survive the proposed shared-login/RBAC migration: practicals, Orientation, Evaluation Retention, Cadaver Lab, Surgical Observation, and Foundations Assessment.

**Why:** When the supplied migration spec excluded RDs from these writes, the user explicitly chose “Keep RD sign-offs.”

**How to apply:** Preserve explicit, appropriately scoped RD capabilities rather than following a role ranking that removes these actions. Retaining RD sign-offs does not grant SME attendance or administrator capabilities.

The intended shared identity provider is Supabase Auth, but enforcing the migration requires owner-reviewed account reconciliation before switching the working sign-in.

**Why:** The user authorized implementation against Oracle's SME spec and explicitly distinguished completed shared prerequisites from an enforcement cutover that still requires reconciliation review.

**How to apply:** Prepare and verify migration components without silently switching active authentication. Preserve existing access during preparation; do not treat database readiness or a passing unit suite as approval to enforce new staff roles.

The owner's November 7, 2026 Global Rule 3 amendment supersedes the prior Supabase auth checklist: anon key only; own-session-JWT own-row role reads; never write user_access or bind identities in this app; nightly roster sync binds; Oracle issues invites; unbound accounts show pending setup. RD scope is organization-wide, not regional. CEU Admin is supported for CEU/course administration only.

**Why:** The owner explicitly amended the shared authentication boundary and resolved the RD-scope and CEU-vocabulary questions.

**How to apply:** Do not request or introduce privileged Supabase credentials, app-side account binding, or invitations. Preserve anon-key enumeration-safe recovery. Do not reopen regional mapping as an RD blocker. Follow the subsequent owner-approved reconciliation and phased enforcement rules below.

PT admission is confirmed: view-only, own-record object checks on every ID/list/export, person resolved server-side, never from query parameters, with zero business writes. An Admin ceiling with narrower staff assignments intentionally retains only those assigned capabilities; do not auto-promote.

**Why:** The owner explicitly confirmed both decisions against Oracle's final reconciliation package on November 7, 2026.

**How to apply:** Keep participant roster eligibility separate from login eligibility. Treat unknown or ambiguous immutable person linkage as pending setup. Do not flag a higher ceiling alone as a permissions defect.

The owner-approved rollout starts with existing account-holders, then a SME Lead / CEU Admin invitation cluster, then PTs. Enable Supabase in development first; the owner checks real-account access before production activation.

**Why:** On November 8, 2026, the owner confirmed Oracle's reconciliation/binding approval and authorized this controlled rollout rather than inviting everyone before the first release.

**How to apply:** Oracle still owns invitations and binding. Keep Clerk code/settings/history for deliberate operator rollback until the owner declares rollout complete; never automatically fall back after Supabase denies access. Preserve identity history and progression records. PT invitation does not grant write permission; flag requests for PT saves against the read-only rule.

Oracle's judge-reviewed addendum keeps the existing restricted server DB path for business data and assignments. Identity uses the sync-owned roster email from the JWT/RLS own access row, not mutable Auth email, then the app-user's person identity. Ceilings constrain assignments by explicit matrix, never by rank or automatic downgrading; unmatched staff lose assignment-gated actions but retain valid role-gated surfaces.

**Why:** The owner explicitly clarified the Auth-key boundary, identity chain, and distinction between assignment-gated and role-gated access.

**How to apply:** Preserve SQL write allowlists and Admin-only audited assignment edits. Deny/log assignments outside the ceiling; CEU assignments require CEU/Admin ceilings. Blank roles are intentional No Access, not PT. Re-verify every bearer request and return 401 on getUser failure/revocation. RD sign-off scope is subject to the later clarification below.

The November 9, 2026 owner reconciliation preserves org-wide RD viewing, anon-key-only Auth, one live provider, rollback by redeploy with old auth code retained, read-only account reconciliation, and Admin-only audited workshop assignments. Account/role editing remains Oracle-owned, distinct from workshop assignment editing.

**Why:** The owner supplied reconciled rulings to resolve conflicts in Oracle's shared checklist.

**How to apply:** Oracle will supply and test role-aware business-table RLS separately; do not invent those policies or treat their delivery as complete. Preserve IDP privacy if applicable: clinician plus assigned director only, never blanket Admin access.

Keep existing SME RD sign-offs, including practicals, Orientation, Evaluation Retention, Cadaver Lab, Surgical Observation and Foundations Assessment, with the previously approved organization-wide scope.

**Why:** On November 9, 2026, after being shown the conflict with the Community Outreach wording, the owner explicitly selected “Keep existing SME sign-offs.”

**How to apply:** Do not remove or relocate these SME features or silently add regional restrictions. Oracle's forthcoming RLS policies must preserve these existing approved capabilities.
