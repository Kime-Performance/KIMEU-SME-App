---
name: Roster and workshop data directions
description: User-defined source systems and one-way data flow for SME operations.
---

The approved direction is Supabase-only SME application data, replacing the prior Master Sheet read/write handoff. Do not build a Sheets write-back mirror or silently fall back to Sheets after the cutover.

**Why:** The user explicitly selected “Switch to Supabase only” after being told that the separate Clinician Development Tool would also need its own Supabase connection.

**How to apply:** Use the existing shared truth database, not a new app database. Verify permissions, row security, certificate identity, all remaining application paths, and completion calculations before activating the cutover. Treat the separate Clinician Tool migration as a real dependency, not an automatic result of connecting this app.

The user has a separate agent that sets up the shared Supabase schema; coordinate proposed schema and access changes with that agent.

**Why:** The user proposed having their schema agent review the roster setup script before applying changes to the shared database.

**How to apply:** Hand off verified findings, the proposed SQL, required app interfaces, and unresolved identity checks. Confirm the schema agent's approved contract and which changes were actually applied before wiring or activating the app against them.

Preserve existing history and Kajabi inputs; do not bulk-copy sandbox records into the shared truth database. PT-roster identity remains a read-only input to SME operations, separate from attendance and practical-result writes.

**Why:** The user's original direction separated roster selection from workshop documentation and rejected wholesale sandbox transfers.

**How to apply:** Do not change roster identity or employment information from this app. Distinguish individual RD requirement completion from overall pathway completion and from closing a workshop session.

Regional Directors also work in this app and sign off post-workshop practicals. Each workshop subpage needs RD sign-off and notes when the PT has not passed.

**Why:** The user explicitly assigned post-workshop practical assessment to Regional Directors, separately from the SME's live workshop attendance.

**How to apply:** Keep RD practical assessment separate from SME attendance. Require corrective feedback for not-passed practicals; do not equate attendance alone with pathway completion.

Foundations workshop completion requires attendance and RD practical Pass, without a Kajabi percentage. Evaluation Retention requires its four completed RD weeks. Kajabi completion only matters for the separate Foundations assessment component; the Director uploads that data to the Master.

**Why:** The user explicitly removed Kajabi completion from Foundations workshop completion and clarified that it only matters for the Foundations assessment component.

**How to apply:** Let Foundations workshop checkmarks depend on attendance and RD Pass, not Kajabi progress. Preserve the assessment's Kajabi and exam requirements and the overall pathway calculation. Do not apply this Foundations-specific change to Fellowship/Advanced completion rules.

Workshop subpages use one shared PT selector/search. Attendance and RD practicals are specific to that selected person, not separate filtered lists of people. Keep an explicit Submit/Save action for attendance. There is no separate full-completion checklist or approval in the SME app.

**Why:** The user clarified: “I should go into a workshop, select a PT or search for one and then the attendance and RD practical are specific to that person.” The SME app checks individual requirements; the shared truth system interprets completion.

**How to apply:** Selecting or searching for a PT controls both attendance and RD practicals by their email identity. Do not show an unrelated PT's practical record. Warn before discarding unsaved changes when switching people. Do not silently save checkbox taps or add a full-completion approval.

Foundations Assessment has its own SME-app subpage after the Foundations workshops, with PT-roster identity selection and RD Pass/Fail. Its legacy Sheets mapping was the existing Exam Result field in the Foundations Tracker, without renaming that header. The gold assessment display belongs in the separate Clinician Development Tool.

**Why:** The user supplied the Clinician Tool's mapping, then explicitly requested a separate left-side RD assessment subpage in this app.

**How to apply:** Keep assessment entry distinct from individual workshop practicals and overall pathway completion. Preserve the shared assessment-result meaning when moving to Supabase and use verified PT identity, not display names, for integration with the other app.
