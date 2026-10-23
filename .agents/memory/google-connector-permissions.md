---
name: Google connector permissions
description: Avoid unnecessary JSON credentials when the connected Google account already permits Sheets edits.
---

Inspect the full connector permission list and confirm provider access before asking for a service-account credential. A Drive read-only scope does not prevent Sheets edits when a separate spreadsheets edit scope is present.

**Why:** Misreading only the Drive scope caused an unnecessary service-account setup blocker. The existing Google Sheets OAuth connection could access the test copy and authorise the write endpoint, while the separate service account could not read that copy.

**How to apply:** Treat permissions by API rather than inferring a single read-only status from one scope. Prefer the existing authorised connector when it meets the app's access requirements; do not require a JSON key merely because Drive access is read-only.
