---
name: Google Sheets quotas
description: Shared connector throttling and safe treatment of unconfirmed writes.
---

Managed Google Sheets requests can be throttled at the provider-project level even when this app's own traffic is low. Do not assume a 429 means the user lacks spreadsheet permissions or needs new credentials.

**Why:** Live tracking verification encountered project-level quota errors while using the existing authorized connector and batched reads.

**How to apply:** Batch related reads and use bounded backoff for explicit 429 rejections. Do not automatically replay ambiguous write timeouts or 5xx failures: the write may already have committed. Preserve unsaved forms and optimistic revisions when a post-save readback cannot be confirmed.
