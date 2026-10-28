---
name: Private SME and RD access
description: Who may enter the KIMEU workspace and the user's intended sign-in method.
---

The SME app is private to approved SMEs and Regional Directors, with director/admin access retained. The user is comfortable using email and password. The app will have a place in Kajabi; anyone may see the cover page, but only assigned SMEs and RDs (plus the administrator) may enter the app.

**Why:** The user explicitly requested a private site for SMEs and Regional Directors, not an app open to every clinician or company email address, and clarified that a publicly visible cover page or Kajabi placement must not expose the workspace.

**How to apply:** Keep the cover page public. Require an active approved app-user record and an SME, RD, or Admin role before serving workspace data. A Kajabi membership, corporate-domain address, or newly created authentication account alone must not grant access. Other reviewer/administrative roles need one of these site-access roles as well. Preserve course-level permissions. Let the authentication provider handle passwords and invitations; never put passwords in the roster or app-user sheet.

Do not treat a failure in a separate workshop/log sheet-health check as revocation of a freshly approved staff account. Keep an already verified workspace and its draft forms mounted during transient connection-refresh errors, but enforce fresh authorization on every server-side save and honor explicit access revocation.

**Why:** During RD workflow verification, temporary Google Sheets read failures produced a setup-incomplete response that closed the approved user's workspace and could discard unsaved forms.

**How to apply:** Separate authorization from operational readiness. Never grant first-time access from a failed approval check, share cached workspace state across identities, or weaken the server's approval checks to work around connection outages.

The director plans to assign SMEs through the administrative controls after publishing and confirming access is secure. Every approved SME should see all workshop subpages, but visibility must not authorize attendance edits, RD sign-offs, or access to PT records outside their permitted work. Administrator access remains necessary.

**Why:** The user explicitly distinguished all-workshop visibility from the approved, secure staff login and said assignments will happen after publishing.

**How to apply:** Do not assign staff or broaden site admission merely to populate navigation. Let approved SME Assist and SME Lead accounts browse the full workshop catalog, while server-side role and assignment checks continue to protect each tracking action and record.
