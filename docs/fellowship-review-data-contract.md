# Fellowship overall reviews

The private SME app provides `/fellowship-reviews` for active, explicitly approved **Fellowship Reviewer** and **Admin** accounts. Other SME/RD roles alone cannot read or submit overall reviews.

## Master input mapping

Spreadsheet: `1cXPmoIV0El9aGjwsac9sszhjFYOpz0C0QFx4GoxSaxM`.
Tab: `03d-Fellowship Review Log`; headers row 2, actual reviews start row 4. Row 3 is an example, never a real review.

| App input | Master header | Type / meaning |
|---|---|---|
| Review date | Review Date | Valid, non-future calendar date |
| Signed-in reviewer | Reviewed By | Server-owned Name in Sheets |
| Overall assessment | Review Type | Fellowship Exam |
| Selected clinician | PT Email; PT Name | Authoritative active roster selection |
| Pass | Result | `Pass` |
| Fail / Refocus | Result | `Refocus`, matching the existing strict dropdown |
| Overall score | Score | Number, 0–100; no app-invented pass threshold |
| Assessment feedback | Notes | Text, up to 4,000 characters |
| Failed-review feedback | Specific Need | Required meaningful feedback, also retained in Notes |
| Optional deficiency area | Workshop ID (Refocus) | Existing Fellowship workshop ID or blank |
| Audit attribution | Last Updated By; Last Updated | Server-owned identity and time |

Every save appends an attempt. Existing reviews, follow-up inputs, and scheduled exams are preserved. Formula-only template cells are copied into an unused row; the app never writes Review ID, workshop lookups, due dates, Status, Days Open, or overall pathway completion as input values.

Review and private audit inputs share one atomic values batch. Optimistic revisions reject stale history. A stable request UUID, stored with the audit, makes retries safe after an unconfirmed response.

## Summary feed for the Clinician Development Tool

Tab `03-KIMEU Summary`: headers row 3, data from row 4. Join by normalized **PT Email** in B, never clinician name or row number.

- I: existing **Fellowship Review** (`Pass` / `Refocus`).
- P: **Fellowship Review Score** (number or blank for unscored historical reviews).
- Q: **Fellowship Review Notes** (shared assessment feedback).
- R: **Fellowship Reviewed By**.
- S: **Fellowship Review Date**.
- T: **Fellowship Review Updated At**.

Prefer header-based mapping. All six fields select the same latest review using review date, server-stamped Last Updated, then row as tie-breakers. Two attempts on the same day must not leave the older result displayed.

The separate Clinician Development Tool must fetch these fields and refresh its own cache. Its code is not in this workspace, so this feed does not by itself verify or change that app's display.

Overall **Fellowship** in Summary E is still calculated by the Master's existing workshop, exam, and historical-status rules. An exam result alone is not an app-side overall-completion override.

## Feedback versus private audit

Review-log Notes are assessment feedback requested for downstream tracking. The private `03g-Clinician Notes` audit remains `Aaron + author`; never forward that private audit JSON or unrelated clinician notes into the Clinician Development Tool.

The reviewer email approval does not create passwords or send invitations. Reviewers still need their own verified authentication account; existing staff invitation/login controls remain responsible for that.
