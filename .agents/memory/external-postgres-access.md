---
name: External Postgres access checks
description: Distinguish database connectivity, object visibility, grants, and row-security access before a data-source cutover.
---

Do not infer that application tables are absent from an empty `information_schema` result under a restricted database login.

**Why:** During Supabase readiness checks, the application tables existed and had row-security policies, but the application's inherited role lacked table privileges. `SELECT 1` succeeded while information_schema hid those tables.

**How to apply:** Before provisioning or migrating anything, inspect PostgreSQL catalog object existence, effective table privileges, role inheritance, and row-security policies separately. A successful connectivity probe establishes neither permission to read application records nor permission to write them. Never substitute broader credentials or disable row security merely to make a probe pass.

Validate canonical identity relationships before a cutover, not just whether individual tables contain records.

**Why:** Supabase table access and verified TLS succeeded while the active provider records had no shared person links, leaving the application's eligible-PT join empty.

**How to apply:** Diagnose linkage coverage with aggregate counts before enabling the new source. Repair identity relationships only through verified, unique identifiers with appropriate owner approval. Never populate an empty roster by fuzzy-matching names or dropping its eligibility and access filters.

Column-scoped grants must cover columns used in filters and joins, not only returned columns.

**Why:** An existing restricted role could read other operational records but a newly added roster eligibility predicate failed with permission denied because its column was outside the older grants.

**How to apply:** Check effective column privileges and role inheritance, then execute the actual read queries using the application's configured login. Owner-level reads or privilege-catalog checks alone do not establish that the application can load its roster.

Sequential query success does not establish readiness for parallel workspace loading.

**Why:** App-role roster and operational reads succeeded individually, but concurrent reads stalled and left the signed-in access check pending. Privileges and TLS were not sufficient proof of a working browser journey.

**How to apply:** Verify concurrent staff, catalog, roster and session loading before declaring a cutover ready. Correlate client and pooler observations; do not presume that a permissions change or different pool size fixes a pending-request problem.
