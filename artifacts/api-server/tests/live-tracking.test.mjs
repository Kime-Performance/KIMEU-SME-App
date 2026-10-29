import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { rdHeaders, foundationRollups, evaluationCompletion, summaryRollups, rdArrayFormulas } from "../../../scripts/src/kimeu-rd-live-formulas.mjs";
import { foundationWorkshopCompletion } from "../../../scripts/src/kimeu-foundations-completion.mjs";

const temp = await mkdtemp(join(tmpdir(), "kimeu-live-config-"));
await build({ entryPoints: [new URL("../src/lib/kimeu/sheet-configuration.ts", import.meta.url).pathname], outfile: join(temp, "config.mjs"), bundle: true, platform: "node", format: "esm" });
const { resolveSheetConfiguration, MASTER_SHEET_ID } = await import(pathToFileURL(join(temp, "config.mjs")).href);

test("live Master remains blocked unless the explicit approval is exactly true", () => {
  for (const approval of [undefined, "", "false", "1", "TRUE"]) {
    assert.equal(resolveSheetConfiguration(MASTER_SHEET_ID, approval).configured, false);
  }
  assert.equal(resolveSheetConfiguration(MASTER_SHEET_ID, "true").trackingMode, "live");
  assert.equal(resolveSheetConfiguration(MASTER_SHEET_ID, "true").configured, true);
  assert.equal(resolveSheetConfiguration("isolated-test-copy", "true").trackingMode, "test");
  assert.equal(resolveSheetConfiguration().trackingMode, "unconfigured");
});
test("RD formulas retain separate weekly input fields and require dated attendance", () => {
  assert.equal(rdHeaders.length, 16);
  assert.match(rdArrayFormulas()[0], /ISNUMBER\(E3:E\)/);
  assert.match(rdArrayFormulas()[0], /F3:F>=60/);
  assert.match(rdArrayFormulas()[1], /D3:D,4,N3:N,"Yes"/);
  assert.match(rdArrayFormulas()[2], /"F-12",4,1/);
});
test("Foundations rollups preserve legacy attendance and do not use array formulas in PT templates", () => {
  const result = foundationRollups(7);
  assert.equal(result.length, 5);
  assert.match(result[3], /AW7/);
  assert.match(result[4], /AX7/);
  assert.ok(result.every(formula => !formula.includes("ARRAYFORMULA")));
  assert.match(result[1], /"F-12"/);
});
test("Evaluation workshop completion uses four RD weeks, not Kajabi assessment progress", () => {
  const legacy = '=IF(AND(E7=100,L7="Yes",N7="Pass"),"✓","")';
  const formula = evaluationCompletion(7, legacy);
  assert.match(formula, /\$AZ7="Complete"/);
  assert.ok(!formula.includes("E7"));
  assert.match(formula, /L7="Yes",N7="Pass"/);
  assert.match(formula, /"Fail"/);
  assert.throws(() => evaluationCompletion(7, "✓"));
});
test("all Foundations workshop checkmarks require attendance and RD Pass without a Kajabi gate", () => {
  for (const [start, attended, practical] of [[15, "Q", "S"], [20, "V", "X"], [25, "AA", "AC"], [30, "AF", "AH"], [35, "AK", "AM"], [40, "AP", "AR"]]) {
    const formula = foundationWorkshopCompletion(4, start);
    assert.match(formula, new RegExp(`${attended}4="Yes",${practical}4="Pass"`));
    assert.ok(!formula.includes("E4"));
    assert.match(formula, /"Retake"/);
  }
  assert.throws(() => foundationWorkshopCompletion(4, 4));
});
test("Summary adds explicit RD status columns without rewriting overall pathway status", () => {
  const formulas = summaryRollups(38);
  assert.match(formulas[1], /\$AZ\$4:\$AZ/);
  assert.match(formulas[2], /\$BA\$4:\$BA/);
  assert.ok(formulas.every(formula => formula.includes("$B38")));
});
test.after(() => rm(temp, { recursive: true, force: true }));
