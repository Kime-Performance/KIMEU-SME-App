---
name: Civil date contracts
description: Preserve exact calendar-date strings through generated request and response validators.
---

Keep strict calendar-only API fields as patterned strings and validate actual calendar validity in the domain, rather than allowing generated validators to coerce them into Date objects.

**Why:** The OpenAPI generator's date coercion can normalize an impossible date before domain validation and serialize a calendar date as a timestamp. Both change the meaning expected by date-only form controls and sheet inputs.

**How to apply:** Preserve `YYYY-MM-DD` across the request/response boundary, reject rollover dates and future assessments where required, and reserve instant conversion for actual timestamp fields. Treat timezone-less sheet timestamps as Pacific wall-clock values.
