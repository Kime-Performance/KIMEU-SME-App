import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyWorkshop } from "../src/lib/kimeu/calendar-matching.ts";

const catalog = [
  { id: "F-12", name: "Workshop 1.2 — Eval", stage: "Foundations" },
  { id: "FW-KB", name: "Kettlebell Resilience", stage: "Fellowship" },
  { id: "FW-PRG", name: "Programming", stage: "Fellowship" },
  { id: "EN-CAD", name: "Cadaver Lab", stage: "Enrichment" },
];

test("excludes recurring meetings and enrichment workshops", () => {
  for (const title of ["Case Reviews/Discussions", "Tech Talk Tuesday", "Workshop: Cadaver Lab"]) {
    assert.equal(classifyWorkshop(title, catalog).include, false, title);
  }
});

test("includes Foundations titles and Advanced catalog matches", () => {
  assert.equal(classifyWorkshop("Workshop 1.2 — Eval", catalog).workshop.id, "F-12");
  assert.equal(classifyWorkshop("KB Resilience", catalog).workshop.id, "FW-KB");
  assert.equal(classifyWorkshop("Programming Advanced Course Part 1", catalog).workshop.id, "FW-PRG");
  assert.equal(classifyWorkshop("FW-KB regional offering", catalog).workshop.id, "FW-KB");
});

test("does not guess catalog identity for differing or ambiguous workshop titles", () => {
  const unmatched = classifyWorkshop("Workshop 2.2 Lower Extremity", catalog);
  assert.equal(unmatched.include, true);
  assert.equal(unmatched.workshop, null);
  const duplicate = classifyWorkshop("Programming", [...catalog, { id: "FW-OTHER", name: "Programming", stage: "Advanced" }]);
  assert.equal(duplicate.include, true);
  assert.equal(duplicate.workshop, null);
});
