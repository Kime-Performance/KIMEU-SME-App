---
name: Roster and workshop data directions
description: User-defined source systems and one-way data flow for SME operations.
---

The KIME Master Database's Roster tab is the continuing source of PTs available for selection in the SME app. This direction is read-only: roster sheet to app.

The SME opens a workshop subpage to record live attendance and write notes visible to the KIMEU director. RDs record practical results. These input records flow from the app into the KIMEU Master Database for consistent Foundations and Fellowship pathway tracking.

The user explicitly approved enabling live tracking instead of keeping saves isolated in a test copy. Preserve existing history and Kajabi inputs; do not bulk-copy sandbox records into the Master.

**Why:** The user observed that a saved weekly sign-off did not reach the Master or Clinician Development Tool and chose “Enable live tracking.”

**How to apply:** Keep the app-to-Master data flow live once verified. Treat individual RD requirement completion separately from overall Foundations completion; a finished weekly requirement does not waive other pathway prerequisites.

**Why:** The user specified two one-way connections, with the shared sheets supporting the KIMEU Progress Tracker.

**How to apply:** Keep the roster source separate from the workshop-record destination, even if both ultimately reside in the same spreadsheet. Do not write roster changes back from this app. Distinguish individual PT completion from closing a workshop session.

Regional Directors also work in this app and sign off post-workshop practicals. Each workshop subpage needs RD sign-off and notes when the PT has not passed.

**Why:** The user explicitly assigned post-workshop practical assessment to Regional Directors, separately from the SME's live workshop attendance.

**How to apply:** Keep RD practical assessment separate from SME attendance. Require corrective feedback for not-passed practicals; do not equate attendance alone with pathway completion.

Foundations workshop completion requires attendance and RD practical Pass, without a Kajabi percentage. Evaluation Retention requires its four completed RD weeks. Kajabi completion only matters for the separate Foundations assessment component; the Director uploads that data to the Master.

**Why:** The user explicitly removed Kajabi completion from Foundations workshop completion and clarified that it only matters for the Foundations assessment component.

**How to apply:** Let Foundations workshop checkmarks depend on attendance and RD Pass, not Kajabi progress. Preserve the assessment's Kajabi and exam requirements and the overall pathway calculation. Do not apply this Foundations-specific change to Fellowship/Advanced completion rules.

Workshop subpages must contain a running list of available PTs with checkboxes and an explicit Submit/Save action for attendance. There is no separate full-completion checklist or approval in the SME app.

**Why:** The user approved the course-page structure but could not find attendance there. They subsequently clarified that the SME app checks individual requirement boxes; the KIMEU sheet interprets those inputs for completion.

**How to apply:** Keep attendance directly on the course page, with separate RD practical sign-off. Do not silently save checkbox taps or add a full-completion approval. Leave completion to the sheet calculations.

The Clinician Development Tool reads the Foundations, Fellowship, and Advanced Workshop tabs, not Summary. The user needs the SME app's inputs to reach the sheet accurately so the Clinician tool can read them.

**Why:** The user explicitly corrected the assumption that Summary was the downstream integration source.

**How to apply:** Verify saves against the actual pathway source records and their existing calculated fields. Do not require a new Summary integration or describe added Summary columns as a necessary handoff to the Clinician Development Tool.
