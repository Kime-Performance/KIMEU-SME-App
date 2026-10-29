# KIMEU live RD tracking contract

Source spreadsheet: `1cXPmoIV0El9aGjwsac9sszhjFYOpz0C0QFx4GoxSaxM` (KIMEU Master Database).

The SME app writes individual attendance and RD sign-off inputs, not an overall-completion approval. The separate KIME Master roster remains read-only.

## Per-clinician status

Join by normalized **PT Email**, never name or row number.

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

The legacy Evaluation Retention checkmark in Foundations O still requires Kajabi completion. Overall Foundations can therefore remain In Progress while weekly Evaluation Retention is Complete. Existing history and Kajabi prerequisites are not overridden.

Cadaver and Surgical Observation use new RD records when present; otherwise their status formulas honor the existing manual RD attendance fields AW:AX.

## Input/audit records

`03i-RD Onboarding`: header row 2, inputs A:M from row 3, formula-owned results N:P. Unique record key is workshop ID + PT email + week. Completion is calculated by the sheet.

`03g-Clinician Notes` retains append-only audit history and its Visibility restrictions. Do not expose private notes in the Clinician Development Tool.

## Downstream application

A consuming app must fetch these live fields and invalidate/refetch its clinician progress cache on refresh. Adding spreadsheet columns does not itself modify code or cache behavior in a separate Replit project.
