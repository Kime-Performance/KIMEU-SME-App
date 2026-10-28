---
name: Private SME and RD access
description: Who may enter the KIMEU workspace and the user's intended sign-in method.
---

The SME app is private to approved SMEs and Regional Directors, with director/admin access retained. The user is comfortable using email and password.

**Why:** The user explicitly requested a private site for SMEs and Regional Directors, not an app open to every clinician or company email address.

**How to apply:** Require an active approved app-user record and an SME, RD, or Admin role before serving workspace data. A corporate-domain address or newly created authentication account alone must not grant access. Other reviewer/administrative roles need one of these site-access roles as well. Preserve course-level permissions. Let the authentication provider handle passwords and invitations; never put passwords in the roster or app-user sheet.

Do not treat a failure in a separate workshop/log sheet-health check as revocation of a freshly approved staff account. Keep an already verified workspace and its draft forms mounted during transient connection-refresh errors, but enforce fresh authorization on every server-side save and honor explicit access revocation.

**Why:** During RD workflow verification, temporary Google Sheets read failures produced a setup-incomplete response that closed the approved user's workspace and could discard unsaved forms.

**How to apply:** Separate authorization from operational readiness. Never grant first-time access from a failed approval check, share cached workspace state across identities, or weaken the server's approval checks to work around connection outages.
