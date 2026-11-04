---
name: External Postgres access checks
description: Distinguish database connectivity, object visibility, grants, and row-security access before a data-source cutover.
---

Do not infer that application tables are absent from an empty `information_schema` result under a restricted database login.

**Why:** During Supabase readiness checks, the application tables existed and had row-security policies, but the application's inherited role lacked table privileges. `SELECT 1` succeeded while information_schema hid those tables.

**How to apply:** Before provisioning or migrating anything, inspect PostgreSQL catalog object existence, effective table privileges, role inheritance, and row-security policies separately. A successful connectivity probe establishes neither permission to read application records nor permission to write them. Never substitute broader credentials or disable row security merely to make a probe pass.
