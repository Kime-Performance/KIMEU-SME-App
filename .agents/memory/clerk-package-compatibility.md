---
name: Clerk package compatibility
description: Version mismatch encountered when installing managed Clerk React authentication.
---

Use the current Clerk React major when applying the managed-auth setup instructions. The older v5 package lacks both Show and publishableKeyFromHost from its internal export.

**Why:** An inherited v5 dependency range resolved successfully but could not compile the canonical managed-domain wiring. Upgrading to the current major resolved the missing APIs; replacing the helper with a raw publishable key would weaken custom-domain support.

**How to apply:** If the setup instructions reference exports absent from installed Clerk packages, inspect the installed major and current available version before rewriting the authentication flow. Keep React at a supported patched version.
