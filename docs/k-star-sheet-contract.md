# Optional KB Resilience K-Star recognition

## Shared sheet contract

The SME app writes the KIMEU Master Database (`1cXPmoIV0El9aGjwsac9sszhjFYOpz0C0QFx4GoxSaxM`), tab **03b-Advanced Workshop Log**. The Clinician Development app consumes this tab directly; no second API or database write is needed.

- Header row: **2**. Records begin at **3**.
- PT identity: normalized **PT Email** plus **Workshop ID = FW-KB**.
- **AE / K-Star Test Performed**: boolean TRUE or FALSE.
- **AF / K-Star Stars Earned**: numeric integer 0–4, or blank.
- **AD / Last Updated**: full ISO timestamp on KB saves.
- Column names and positions are verified before K-Star writes; no columns are created, renamed, or shifted.

TRUE with 0 means an attempted test without a credential. TRUE with 1–4 is KR1–KR4. FALSE cannot be submitted with a level. Blank historical values mean not recorded, not a presumed award.

## Form and persistence

The existing RD practical form for KB Resilience includes an optional **K-Star fitness test performed** checkbox. Its **K-Star earned** selector is visible but disabled until checked, then requires a result with an empty initial choice. Reopening loads the saved fields. Eligible PT records have explicit **Record/Edit RD practical** and **Record K-Star result** entry buttons. Other courses do not expose or accept K-Star inputs.

Existing practical permissions, attendance/date eligibility, RD assignment checks, and fail-feedback requirements still apply. The same explicit **Save sign-off** action persists the optional fields together with the practical and private audit note.

An ordinary sign-off that omits both K-Star fields leaves them untouched. New KB attendance enrollments initialize FALSE and blank; existing attendance edits do not write either field.

The server rereads all retained same-email FW-KB rows and preserves the maximum valid earned level and performed evidence. A lower result, zero result, or unchecked box cannot erase a prior earned level. Related K-Star evidence is included in the optimistic revision, and the existing practical write lock serializes same-process saves. The submitted retest and retained result are included in private audit history.

Updates target the existing selected course row, never append a K-Star-only workshop row. Kajabi progress, attendance, exam evidence, formula cells, CEU fields, and other course inputs are not altered by the optional fields. KB/Fellowship completion remains the sheet's existing Kajabi + attendance + RD Pass rule.

## Verification boundaries

K-Star numeric evidence is read using `UNFORMATTED_VALUE` and `SERIAL_NUMBER` for AF only, while the rest of the row retains formatted calendar-date reads. This prevents a date-formatted AF cell from turning an underlying award of 3 into a false missing result or failed save confirmation. AF's shared display format is integer `0`; no award values or other columns were changed by that formatting correction.

Practical timing is shown as an inclusive two-week window from the workshop date through day 14. On-time dates are green; late dates remain saveable, while future completion dates and dates before the workshop remain invalid. New practical forms default the actual date to today, which can be changed to the date the practical actually occurred.

All Foundations, Fellowship and Advanced workshop course workspaces also provide a **separate practical schedule**, permitting today/future dates from workshop day through day 14 inclusively. Scheduling does not require marking attendance complete. Plans can be edited or removed; stale or uncertain saves keep the selected date and require explicit review before retrying.

Plans are appended to the existing Master `03g-Clinician Notes` audit history with a server-created `RD:<recordKey>:SCHEDULE:<noteId>` review marker. No columns are added or renamed, and scheduling writes no course/attendance/completion/award cells or Google Calendar events. The actual completion date remains separate and future dates cannot be recorded as completed. A saved workshop/session record must exist to identify the PT and dated occurrence.

On a stale or uncertain save, the form keeps the draft and does not auto-retry writes. Users review the latest saved card/history, explicitly accept that reviewed revision if another save is needed, then save again. A background read failure keeps cached records and the draft visible.

Isolated provider tests cover typed AE/AF writes, numeric zero, invalid and mismatched inputs, highest-level retention across historical rows, stale revisions, preserved course evidence, new attendance initialization, unrelated edits, authorized roles, header safety, and readback failure. Browser checks use the actual component with synthetic records and mocked network traffic. No real clinician award is created for testing.

The supplied consumer contract states that the Clinician Development app reads A:ZZ, examines all retained FW-KB rows, and awards the highest TRUE + integer 1–4 level. Its sheet cache and active-page refresh may take approximately **5–6 minutes**. That app must also be published with its K-Star changes.

This workspace cannot independently verify the separate app's public rendering, credential text, gold stars, Team progress, or printable summary. A cross-app check needs an authorized real test or a dedicated test sheet connected to both apps. Never fabricate a real clinician award to perform that check.
