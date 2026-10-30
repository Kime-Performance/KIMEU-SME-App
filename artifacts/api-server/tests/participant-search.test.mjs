import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transformSync } from "esbuild";

const source = readFileSync(new URL("../../kimeu-sme-app/src/lib/participant-search.ts", import.meta.url), "utf8");
const code = transformSync(source, { loader: "ts", format: "esm" }).code;
const { matchesParticipantSearch } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

test("all PT entry screens share the workshop search matcher", () => {
  for (const path of [
    "components/workshop-workspace.tsx", "components/course-onboarding.tsx",
    "pages/foundations-assessment.tsx", "pages/fellowship-reviews.tsx",
  ]) {
    const component = readFileSync(new URL(`../../kimeu-sme-app/src/${path}`, import.meta.url), "utf8");
    assert.match(component, /import \{ matchesParticipantSearch \} from '@\/lib\/participant-search'/, path);
    assert.match(component, /matchesParticipantSearch\(search,/, path);
    assert.doesNotMatch(component, /toLowerCase\(\)\.includes\(q\)/, path);
  }
});

test("compound names, punctuation and accents remain searchable without changing emails", () => {
  for (const name of ["Alex De La Cruz", "Taylor O’Neil", "Jordan Smith-Jones", "José Example", "Casey Example Jr."]) {
    const email = "clinician@example.test";
    const words = name.split(/\s+/);
    for (const query of [name, name.toUpperCase(), `  ${words.join("   ")}  `, words.toReversed().join(" "), `${words[0]} ${words.at(-1)}`, email]) {
      assert.equal(matchesParticipantSearch(query, name, email), true, `${name}: ${query}`);
    }
  }
  assert.equal(matchesParticipantSearch("Jose", "José Example", "clinician@example.test"), true);
  assert.equal(matchesParticipantSearch("constructor", "Alex Example", "clinician@example.test"), false);
});

test("PT search supports name parts, spacing and Nate as a short form without changing identity", () => {
  const name = "Nathaniel Van Dusen", email = "nathaniel@example.test";
  for (const query of ["Nate Van Dusen", "  NATE   van   DUSEN ", "Van Dusen", "Dusen Nathaniel", email]) {
    assert.equal(matchesParticipantSearch(query, name, email), true, query);
  }
  assert.equal(matchesParticipantSearch("Nate Van Dusen", "Nathaniel Other", "other@example.test"), false);
  assert.equal(matchesParticipantSearch("Nate Van Dusen", "Matt Van Dusen", "matt@example.test"), false);
  assert.equal(matchesParticipantSearch("Nate", "Natalie Example", "natalie@example.test"), false);
  const matches = [
    { name, email },
    { name: "Nathan Van Dusen", email: "another@example.test" },
  ].filter(person => matchesParticipantSearch("Nate Van Dusen", person.name, person.email));
  assert.equal(matches.length, 2, "shared nicknames must remain ambiguous for explicit PT selection");
});

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
