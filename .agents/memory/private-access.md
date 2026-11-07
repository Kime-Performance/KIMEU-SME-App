---
name: Private SME and RD access
description: Who may enter the KIMEU workspace and the user's intended sign-in method.
---

The SME app is private to approved SMEs, Regional Directors, and explicitly assigned Fellowship reviewers, with director/admin access retained. The user is comfortable using email and password. The app will have a place in Kajabi; anyone may see the cover page, but only approved staff may enter the app.

**Why:** The user explicitly requested a private site, not an app open to every clinician or company email address. They later requested named Fellowship reviewers with their own secure access to record overall assessments.

**How to apply:** Keep the cover page public. Require an active approved app-user record and an SME, RD, Fellowship Reviewer, or Admin role before serving workspace data. A Kajabi membership, corporate-domain address, or newly created authentication account alone must not grant access. Fellowship Reviewer admission grants the overall-review workspace, not SME attendance or RD practical editing rights. Preserve course-level permissions. Let the authentication provider handle passwords and invitations; never put passwords in the roster or app-user sheet.

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
