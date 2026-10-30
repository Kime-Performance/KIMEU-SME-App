import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { foundationsFixture } from "./helpers/foundations-fixture.mjs";

const temp = await mkdtemp(join(tmpdir(), "foundations-assessment-"));
await build({
  entryPoints: [new URL("../src/lib/kimeu/foundations-assessment.ts", import.meta.url).pathname],
  outfile: join(temp, "module.mjs"), bundle: true, platform: "node", format: "esm",
  plugins: [{ name: "isolated-provider", setup(b) {
    b.onResolve({ filter: /^@replit\/connectors-sdk$/ }, () => ({ path: "sheets", namespace: "fixture" }));
    b.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: "clerk", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
      contents: path === "clerk" ? "export const clerkClient={};export const getAuth=()=>({});"
        : "export class ReplitConnectors {proxy(...args){return globalThis.__assessmentTransport(...args)}}",
    }));
  } }],
});
const previous = process.env.KIMEU_SHEET_ID;
process.env.KIMEU_SHEET_ID = "isolated-assessment-fixture";
const { getFoundationsAssessment, saveFoundationsAssessment } = await import(pathToFileURL(join(temp, "module.mjs")).href);
const F = "03c-Foundations Tracker", N = "03g-Clinician Notes";
const foundation = foundationsFixture();
foundation[3][7] = "Pass";
foundation[4][2] = "Other RD";
const notesHeaders = ["Note ID", "Created", "PT Email", "PT Name (auto)", "Note Type", "Workshop ID", "Session ID", "Review ID", "Note", "Author", "Author Role", "Visibility"];
const tables = { [F]: foundation, [N]: [[], notesHeaders] };
const roster = [[], [], ["Email", "Full Name", "Location", "Status", "Termination Date", "Department"],
  ["one@example.test", "Same Name", "North", "Active", "", "Clinical"],
  ["two@example.test", "Same Name", "South", "Active", "", "Clinical"],
  ["missing@example.test", "No tracker", "", "Active", "", "Clinical"]];
let writes = 0, ignoreWrite = false, failWrite = false;
globalThis.__assessmentTransport = async (_connector, path, options) => {
  if (options.method === "POST") {
    if (failWrite) return Response.json({}, { status: 503 });
    const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
    for (const update of body.data) {
      const [, tab, letters, number] = update.range.match(/^'([^']+)'!([A-Z]+)(\d+)$/);
      const column = [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
      if (tab === F) assert.equal(column, 7, "Only existing column H may change");
      if (!ignoreWrite) {
        tables[tab][Number(number) - 1] ??= [];
        tables[tab][Number(number) - 1][column] = String(update.values[0][0]);
      }
    }
    writes++;
    return Response.json({});
  }
  const decoded = decodeURIComponent(path.split("/values/")[1].split("?")[0]);
  const tab = decoded.match(/^'([^']+)'!/)[1];
  return Response.json({ values: tab === "01-PT Roster" ? roster.slice(2) : tables[tab] });
};
const admin = { active: true, roles: ["Admin"], email: "admin@fixture.test", nameInSheets: "Fixture Admin", workshopIds: [] };
const rd = { ...admin, roles: ["RD"], email: "rd@fixture.test", nameInSheets: "Fixture RD" };
const freshPerson = async (user = admin, email = "one@example.test") => (await getFoundationsAssessment(user)).people.find(p => p.email === email);

test("assessment reads the active roster, matches by email, and scopes to assigned RD", async () => {
  const all = await getFoundationsAssessment(admin);
  assert.equal(all.people.length, 2);
  assert.equal(all.people[0].name, all.people[1].name);
  assert.equal(all.people[0].result, "Pass");
  assert.deepEqual((await getFoundationsAssessment(rd)).people.map(p => p.email), ["one@example.test"]);
});
test("non-RD and inactive staff cannot read or save results", async () => {
  for (const user of [{ ...admin, roles: ["Foundations SME"] }, { ...rd, active: false }]) {
    await assert.rejects(() => getFoundationsAssessment(user), e => e.status === 403);
    await assert.rejects(() => saveFoundationsAssessment(user, { email: "one@example.test", result: "Fail", revision: "x" }), e => e.status === 403);
  }
  assert.equal(writes, 0);
});
test("explicit save changes only email-matched H cell and appends audit history", async () => {
  const before = structuredClone(tables[F]), person = await freshPerson(rd);
  const result = await saveFoundationsAssessment(rd, { email: " ONE@example.test ", result: "Fail", revision: person.revision });
  before[3][7] = "Fail";
  assert.deepEqual(tables[F], before);
  assert.equal(result.people[0].result, "Fail");
  assert.equal(tables[F][1][7], "Exam Result");
  assert.match(tables[N][2][8], /"previousResult":"Pass","result":"Fail"/);
});
test("stale revisions, unassigned PTs, missing rows and invalid results never write", async () => {
  const count = writes, person = await freshPerson(rd);
  for (const input of [
    { email: person.email, result: "Pass", revision: "stale" },
    { email: "two@example.test", result: "Pass", revision: person.revision },
    { email: "missing@example.test", result: "Pass", revision: person.revision },
    { email: person.email, result: "Complete", revision: person.revision },
  ]) await assert.rejects(() => saveFoundationsAssessment(rd, input));
  assert.equal(writes, count);
});
test("duplicate email or shifted header blocks writes rather than guessing", async () => {
  const count = writes;
  tables[F].push([...tables[F][3]]);
  await assert.rejects(() => getFoundationsAssessment(admin), e => e.code === "ASSESSMENT_DUPLICATE");
  tables[F].pop();
  tables[F][1][7] = "Renamed";
  await assert.rejects(() => getFoundationsAssessment(admin), e => e.code === "ASSESSMENT_HEADER_CHANGED");
  tables[F][1][7] = "Exam Result";
  assert.equal(writes, count);
});
test("unrelated workshop changes do not invalidate the assessment revision", async () => {
  const person = await freshPerson(rd);
  tables[F][3][11] = "Yes";
  assert.equal((await freshPerson(rd)).revision, person.revision);
});
test("write failures and unconfirmed readbacks are not reported as success", async () => {
  const person = await freshPerson(rd);
  failWrite = true;
  await assert.rejects(() => saveFoundationsAssessment(rd, { ...person, result: "Pass" }));
  failWrite = false; ignoreWrite = true;
  await assert.rejects(() => saveFoundationsAssessment(rd, { ...person, result: "Pass" }), e => e.code === "ASSESSMENT_READBACK_FAILED");
  ignoreWrite = false;
});
test.after(async () => {
  if (previous === undefined) delete process.env.KIMEU_SHEET_ID; else process.env.KIMEU_SHEET_ID = previous;
  delete globalThis.__assessmentTransport;
  await rm(temp, { recursive: true, force: true });
});
