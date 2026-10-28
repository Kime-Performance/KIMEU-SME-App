import assert from "node:assert/strict";
import test from "node:test";
import { isAssignedRd, validPracticalInput } from "../src/lib/kimeu/practical-rules.ts";

test("RD assignment requires an exact name or email; blank and substring assignments deny", () => {
  assert.equal(isAssignedRd(" RD Example ", "rd example", "rd@example.test"), true);
  assert.equal(isAssignedRd("RD@EXAMPLE.TEST", "RD Example", "rd@example.test"), true);
  assert.equal(isAssignedRd("", "", ""), false);
  assert.equal(isAssignedRd("RD", "RD Example", "rd@example.test"), false);
  assert.equal(isAssignedRd("Other RD", "RD Example", "rd@example.test"), false);
});

test("not-passed practicals require meaningful feedback; passes may omit it", () => {
  assert.match(validPracticalInput("Fail", "2026-10-20", "  ", "2026-10-19", "2026-10-28"), /Explain/);
  assert.equal(validPracticalInput("Fail", "2026-10-20", "Repeat the technique safely.", "2026-10-19", "2026-10-28"), null);
  assert.equal(validPracticalInput("Pass", "2026-10-20", "", "2026-10-19", "2026-10-28"), null);
  assert.match(validPracticalInput("Pending", "2026-10-20", "", "2026-10-19", "2026-10-28"), /Choose/);
  assert.match(validPracticalInput("Pass", "2026-10-20", "x".repeat(4001), "2026-10-19", "2026-10-28"), /4,000/);
});

test("practical dates must be real, on or after workshop, and not future", () => {
  for (const date of ["2026-02-30", "2026-13-01", "not a date", "2026-10-18", "2026-10-29"]) {
    assert.notEqual(validPracticalInput("Pass", date, "", "2026-10-19", "2026-10-28"), null);
  }
  assert.equal(validPracticalInput("Pass", "2026-10-19", "", "2026-10-19", "2026-10-28"), null);
});
