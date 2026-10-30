# KIMEU live RD tracking contract

Source spreadsheet: `1cXPmoIV0El9aGjwsac9sszhjFYOpz0C0QFx4GoxSaxM` (KIMEU Master Database).

The SME app writes individual attendance and RD sign-off inputs, not an overall-completion approval. The separate KIME Master roster remains read-only.

## Per-clinician status

Join by normalized **PT Email**, never name or row number.

The RD-only **Foundations Assessment** subpage writes `Pass` or `Fail` to `03c-Foundations Tracker` → **Exam Result (H)**. The existing header stays unchanged. It matches an active roster clinician to exactly one existing Foundations row by PT Email; it never creates a partial tracker row. RDs see their assigned clinicians; administrators can record any eligible clinician. Each explicit save appends private audit history and verifies the saved result by rereading the sheet. It does not edit Kajabi percentages, exam scores, workshop checkmarks, or overall pathway formulas. The Clinician Development Tool should read this same Exam Result field for its separate assessment box.

In `03c-Foundations Tracker`, headers are row 2, real clinician data begins at row 4 (row 3 is the pre-existing example):

| Columns | Headers |
|---|---|
| AY | 1.1 Orientation Status |
| AZ | 1.2 Evaluation Retention Status |
| BA | Evaluation Retention Completed Weeks |
| BB | Cadaver Lab Attendance |
| BC | Surgical Observation Attendance |

In `03-KIMEU Summary`, headers are row 3, data begins at row 4, and PT Email remains column B. The same five headers appear in K:O. Existing A:J fields and their overall-pathway formulas were not replaced.

Evaluation Retention's standalone status is **Complete** after four dated, attended, one-hour weekly sessions with RD Pass. Read the explicit AZ/Summary L status for this requirement. Do not infer this requirement's status from the whole Foundations pathway, Kajabi progress, or the old single-session date fields.

Foundations workshop checkmarks no longer require Kajabi completion. Evaluation Retention in O uses its four completed RD weeks when weekly records exist; the six clinical workshop checkmarks require attendance and RD practical Pass. Kajabi remains required only for the separate Foundations assessment component. Overall Foundations may therefore remain In Progress even when individual workshop checkmarks are complete.

Cadaver and Surgical Observation use new RD records when present; otherwise their status formulas honor the existing manual RD attendance fields AW:AX.

## Input/audit records

`03i-RD Onboarding`: header row 2, inputs A:M from row 3, formula-owned results N:P. Unique record key is workshop ID + PT email + week. Completion is calculated by the sheet.

`03g-Clinician Notes` retains append-only audit history and its Visibility restrictions. Do not expose private notes in the Clinician Development Tool.

## Downstream application

A consuming app must fetch these live fields and invalidate/refetch its clinician progress cache on refresh. Adding spreadsheet columns does not itself modify code or cache behavior in a separate Replit project.
