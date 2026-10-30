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

The existing RD practical form for KB Resilience includes an optional **K-Star fitness test performed** checkbox. Checking it reveals a required result selector with an empty initial choice. Reopening loads the saved fields. Other courses do not expose or accept these inputs.

Existing practical permissions, attendance/date eligibility, RD assignment checks, and fail-feedback requirements still apply. The same explicit **Save sign-off** action persists the optional fields together with the practical and private audit note.

An ordinary sign-off that omits both K-Star fields leaves them untouched. New KB attendance enrollments initialize FALSE and blank; existing attendance edits do not write either field.

The server rereads all retained same-email FW-KB rows and preserves the maximum valid earned level and performed evidence. A lower result, zero result, or unchecked box cannot erase a prior earned level. Related K-Star evidence is included in the optimistic revision, and the existing practical write lock serializes same-process saves. The submitted retest and retained result are included in private audit history.

Updates target the existing selected course row, never append a K-Star-only workshop row. Kajabi progress, attendance, exam evidence, formula cells, CEU fields, and other course inputs are not altered by the optional fields. KB/Fellowship completion remains the sheet's existing Kajabi + attendance + RD Pass rule.

## Verification boundaries

Isolated provider tests cover typed AE/AF writes, numeric zero, invalid and mismatched inputs, highest-level retention across historical rows, stale revisions, preserved course evidence, new attendance initialization, unrelated edits, authorized roles, header safety, and readback failure. Browser checks use the actual component with synthetic records and mocked network traffic. No real clinician award is created for testing.

The supplied consumer contract states that the Clinician Development app reads A:ZZ, examines all retained FW-KB rows, and awards the highest TRUE + integer 1–4 level. Its sheet cache and active-page refresh may take approximately **5–6 minutes**. That app must also be published with its K-Star changes.

This workspace cannot independently verify the separate app's public rendering, credential text, gold stars, Team progress, or printable summary. A cross-app check needs an authorized real test or a dedicated test sheet connected to both apps. Never fabricate a real clinician award to perform that check.
