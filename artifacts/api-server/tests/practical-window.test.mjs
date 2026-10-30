import assert from "node:assert/strict";
import test from "node:test";
import { practicalWindow } from "../../kimeu-sme-app/src/lib/practical-window.ts";
import { validPracticalInput } from "../src/lib/kimeu/practical-rules.ts";

test("all dates from workshop day through day 14 are on time, not one fixed deadline", () => {
  for (const date of ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-23", "2026-10-24"]) {
    const w = practicalWindow("2026-10-10", date, "2026-10-30");
    assert.equal(w.onTime, true);
    assert.equal(w.end, "2026-10-24");
    assert.equal(validPracticalInput("Pass", date, "", "2026-10-10", "2026-10-30"), null);
  }
});
test("late dates remain recordable but not green; future dates are not green or saveable", () => {
  assert.equal(practicalWindow("2026-10-10", "2026-10-25", "2026-10-30").onTime, false);
  assert.equal(validPracticalInput("Pass", "2026-10-25", "", "2026-10-10", "2026-10-30"), null);
  assert.equal(practicalWindow("2026-10-10", "2026-10-24", "2026-10-20").onTime, false);
  assert.notEqual(validPracticalInput("Pass", "2026-10-24", "", "2026-10-10", "2026-10-20"), null);
});
test("calendar window crosses month, leap day and DST without timezone shifts", () => {
  assert.equal(practicalWindow("2026-10-25", "", "2026-10-30").end, "2026-11-08");
  assert.equal(practicalWindow("2028-02-20", "", "2028-02-25").end, "2028-03-05");
  assert.equal(practicalWindow("2026-12-25", "", "2026-12-30").end, "2027-01-08");
  assert.equal(practicalWindow("2026-02-30", "", "2026-03-10"), null);
  assert.equal(practicalWindow("", "", "2026-03-10"), null);
});
