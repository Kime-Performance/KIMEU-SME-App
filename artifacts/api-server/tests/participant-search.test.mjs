import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transformSync } from "esbuild";

const source = readFileSync(new URL("../../kimeu-sme-app/src/lib/participant-search.ts", import.meta.url), "utf8");
const code = transformSync(source, { loader: "ts", format: "esm" }).code;
const { matchesParticipantSearch } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

test("attendance and practical searches select the same clinician, never an unrelated practical record", () => {
  const roster = [
    { name: "Grant Example", email: "grant@example.test", location: "North" },
    { name: "Matt Example", email: "matt@example.test", location: "South" },
  ];
  const practicals = roster.map(({ name, email }) => ({ name, clinicianEmail: email, recordKey: email }));
  for (const query of ["Grant", "  GRANT  ", "grant@example.test", "North", "", "absent"]) {
    const attendance = roster.filter(p => matchesParticipantSearch(query, p.name, p.email, p.location));
    const filtered = practicals.filter(p => matchesParticipantSearch(query, p.name, p.clinicianEmail, roster.find(r => r.email === p.clinicianEmail)?.location));
    assert.deepEqual(filtered.map(p => p.clinicianEmail), attendance.map(p => p.email));
  }
  assert.equal(matchesParticipantSearch("Grant", "Matt Example", "matt@example.test"), false);
  assert.equal(matchesParticipantSearch("Grant", "Grant Example", "grant@example.test"), true);
  const savedPracticals = practicals.filter(p => p.name.startsWith("Matt"));
  assert.equal(savedPracticals.filter(p => matchesParticipantSearch("Grant", p.name, p.clinicianEmail)).length, 0);
  assert.equal(savedPracticals[0].recordKey, "matt@example.test");
});
