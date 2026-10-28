import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const temp = await mkdtemp(join(tmpdir(), "rd-onboarding-"));
await build({
  stdin: { contents: "export * from './src/lib/kimeu/onboarding'; export * from './src/lib/kimeu/sme-assignments';", resolveDir: new URL("../", import.meta.url).pathname, loader: "ts" },
  outfile: join(temp, "module.mjs"), bundle: true, platform: "node", format: "esm",
  plugins: [{ name: "isolated-auth-and-sheets", setup(b) {
    b.onResolve({ filter: /^@replit\/connectors-sdk$/ }, () => ({ path: "sheets", namespace: "fixture" }));
    b.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: "clerk", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
      contents: path === "clerk" ? "export const clerkClient={};export const getAuth=()=>({});"
        : "export class ReplitConnectors {proxy(...args){return globalThis.__rdTransport(...args)}}",
    }));
  } }],
});
const env = process.env.KIMEU_SHEET_ID;
process.env.KIMEU_SHEET_ID = "isolated-rd-test-copy";
const { getOnboarding, saveOnboarding, getSmeAssignments, saveSmeAssignment } = await import(pathToFileURL(join(temp, "module.mjs")).href);
const T = "03i-RD Onboarding", F = "03c-Foundations Tracker", N = "03g-Clinician Notes", U = "03h-App Users";
const tables = {
  [T]: [[], ["Record ID", "PT Email", "Workshop ID", "Week", "Session Date", "Minutes", "Attended", "RD Result", "Signed By", "Signed At", "Notes", "Last Updated By", "Last Updated", "Unit Complete", "Completed Weeks", "Course Status"]],
  [F]: [[], ["PT Email", "RD"], [], ["one@example.test", "Fixture RD"], ["two@example.test", "Other RD"]],
  [N]: [[], ["Note ID", "Created", "PT Email", "Note Type", "Workshop ID", "Review ID", "Note", "Author", "Author Role", "Visibility"], ["old-note", "", "", "", "", "", "Prior history"]],
  [U]: [[], ["Email", "Name in Sheets", "App Role(s)", "Workshop IDs", "Active"], ["admin@example.test", "Fixture Admin", "Admin, Foundations SME", "F-11, F-TEST", "Yes"], ["sme@example.test", "Fixture SME", "Foundations SME", "F-TEST", "Yes"]],
  "03a-KIMEU Workshops": [[], ["Workshop ID", "Workshop Name", "Stage", "Region / Topic", "Lead SME"], ["F-TEST", "Test Foundation", "Foundations", "", ""], ["FW-TEST", "Test Fellowship", "Fellowship", "", ""], ["F-12", "1.2 Evaluation Retention", "Foundations", "", "RD"], ["EN-CAD", "Cadaver Lab", "Enrichment", "", ""]],
};
const directory = [
  ["Full Name", "Email", "Location", "Status", "Termination Date", "Department"],
  ["Fixture One", "one@example.test", "North", "Active", "", "Clinical"],
  ["Fixture Two", "two@example.test", "South", "Active", "", "Clinical"],
];
const writes = [];
let failWrite = false;
function renderedRows() {
  const input = tables[T].slice(2).filter(r => r[0]);
  const complete = r => r[6] === "Yes" && (["EN-CAD", "F-SURG-OBS"].includes(r[2]) || (r[7] === "Pass" && (r[2] === "F-11" || Number(r[5]) >= 60)));
  return tables[T].map((r, i) => {
    if (i < 2 || !r[0]) return r;
    const required = r[2] === "F-12" ? 4 : 1;
    const weeks = new Set(input.filter(other => other[1] === r[1] && other[2] === r[2] && complete(other)).map(other => Number(other[3])));
    return [...r.slice(0, 13), complete(r) ? "Yes" : "No", String(weeks.size), weeks.size === required ? "Complete" : "In Progress"];
  });
}
globalThis.__rdTransport = async (_slug, path, options) => {
  if (path.includes("1CCBAQrjlACcWDPAS6Z2UIirnn-4tleSEuZhc6wPTufo")) {
    assert.equal(options.method, "GET");
    return Response.json({ values: directory });
  }
  if (options.method === "POST") {
    if (failWrite) return Response.json({}, { status: 503 });
    const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
    const next = structuredClone(tables);
    for (const update of body.data) {
      const [, tab, letters, number] = update.range.match(/^'([^']+)'!([A-Z]+)(\d+)$/);
      const index = [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
      while (next[tab].length < Number(number)) next[tab].push([]);
      next[tab][Number(number) - 1][index] = String(update.values[0][0]);
    }
    Object.assign(tables, next); writes.push(body);
    return Response.json({});
  }
  const tab = decodeURIComponent(path.split("/values/")[1].split("?")[0]).match(/^'([^']+)'!/)[1];
  assert.ok(tables[tab], `Unexpected sheet ${tab}`);
  return Response.json({ values: tab === T ? renderedRows() : tables[tab] });
};
const rd = { email: "rd@example.test", nameInSheets: "Fixture RD", roles: ["RD"], workshopIds: [], active: true };
const admin = { email: "admin@example.test", nameInSheets: "Fixture Admin", roles: ["Admin"], workshopIds: [], active: true };
const person = ws => ws.people.find(p => p.email === "one@example.test");
const input = (ws, week, date, extra = {}) => ({ email: "one@example.test", revision: person(ws).revision, week, date, attended: true, result: "Pass", notes: "", ...extra });

test("RD onboarding is visible only to assigned RD or Admin; SMEs cannot sign off", async () => {
  assert.equal((await getOnboarding(rd, "F-11")).people.length, 1);
  assert.equal((await getOnboarding(admin, "F-11")).people.length, 2);
  await assert.rejects(getOnboarding({ ...rd, roles: ["SME Assist"] }, "F-11"), { code: "ROLE_NOT_ALLOWED" });
  const ws = await getOnboarding(rd, "F-11");
  await assert.rejects(saveOnboarding(rd, "F-11", input(ws, 1, "2026-01-05", { email: "two@example.test" })), { code: "PT_NOT_ASSIGNED" });
});
test("Orientation saves attendance plus RD result and retains append-only history", async () => {
  const ws = await getOnboarding(rd, "F-11");
  const saved = await saveOnboarding(rd, "F-11", input(ws, 1, "2026-01-05"));
  assert.equal(person(saved).sheetStatus, "Complete");
  assert.equal(person(saved).completedWeeks, 1);
  assert.equal(tables[N][2][6], "Prior history");
  assert.equal(tables[T][2][5], "0");
  await assert.rejects(saveOnboarding(rd, "F-11", input(ws, 1, "2026-01-05")), { code: "ONBOARDING_CHANGED" });
});
test("RD confirms and corrects attendance for Cadaver Lab and Surgical Observation without practicals", async () => {
  for (const id of ["EN-CAD", "F-SURG-OBS"]) {
    const ws = await getOnboarding(rd, id);
    assert.equal(ws.requiredWeeks, 1);
    await assert.rejects(saveOnboarding(rd, id, input(ws, 1, "2026-01-05")), { code: "ATTENDANCE_ONLY" });
    const saved = await saveOnboarding(rd, id, input(ws, 1, "2026-01-05", { result: "" }));
    assert.equal(person(saved).sheetStatus, "Complete");
    assert.equal(person(saved).units[0].result, "");
    assert.equal(person(saved).units[0].signedBy, rd.email);
    assert.ok(person(saved).units[0].signedAt);
    const corrected = await saveOnboarding(rd, id, input(saved, 1, "2026-01-05", { result: "", attended: false }));
    assert.equal(person(corrected).units[0].attended, false);
    assert.equal(person(corrected).sheetStatus, "In Progress");
    assert.equal(tables[N].filter(r => r[4] === id).length, 2);
    await assert.rejects(saveOnboarding(rd, id, input(saved, 1, "2026-01-05", { result: "" })), { code: "ONBOARDING_CHANGED" });
  }
});
test("Evaluation Retention requires four chronological, separate weekly one-hour sign-offs", async () => {
  let ws = await getOnboarding(rd, "F-12");
  for (const week of [1, 2, 3, 4]) {
    const date = `2026-01-${String(5 + (week - 1) * 7).padStart(2, "0")}`;
    ws = await saveOnboarding(rd, "F-12", input(ws, week, date));
    assert.equal(person(ws).completedWeeks, week);
    assert.equal(person(ws).sheetStatus, week === 4 ? "Complete" : "In Progress");
  }
  const before = structuredClone(tables), count = writes.length;
  for (const bad of [
    input(ws, 4, "2026-01-19"), input(ws, 4, "2035-01-01"),
    input(ws, 4, "2026-01-26", { result: "Fail" }),
    input(ws, 4, "2026-01-26", { attended: false }),
    input(ws, 5, "2026-02-02"),
  ]) await assert.rejects(saveOnboarding(rd, "F-12", bad));
  assert.equal(writes.length, count);
  assert.deepEqual(tables, before);
  ws = await saveOnboarding(rd, "F-12", input(ws, 4, "2026-01-26", { result: "Fail", notes: "Needs more practice." }));
  assert.equal(person(ws).sheetStatus, "In Progress");
  assert.equal(person(ws).completedWeeks, 3);
  assert.ok(tables[N].filter(r => r[4] === "F-12" && r[6]?.includes('"week":4')).length === 2);
});
test("provider failures cannot partially change onboarding inputs or audit history", async () => {
  const ws = await getOnboarding(rd, "F-12"), before = structuredClone(tables);
  failWrite = true;
  await assert.rejects(saveOnboarding(rd, "F-12", input(ws, 4, "2026-01-26")), { code: "SHEET_WRITE_FAILED" });
  failWrite = false;
  assert.deepEqual(tables, before);
});
test("Admin assigns SME Assist/Lead with matching workshops while preserving Admin and RD assignments", async () => {
  const current = await getSmeAssignments(admin);
  assert.ok(current.staff[0].roles.includes("SME Assist"));
  await assert.rejects(getSmeAssignments(rd), { code: "ROLE_NOT_ALLOWED" });
  await assert.rejects(saveSmeAssignment(admin, { email: "sme@example.test", revision: current.revision, smeRoles: ["SME Assist"], workshopIds: ["FW-TEST"] }), { code: "SME_ASSIGNMENT_MISMATCH" });
  const saved = await saveSmeAssignment(admin, { email: "admin@example.test", revision: current.revision, smeRoles: ["SME Lead"], workshopIds: ["F-11", "FW-TEST"] });
  assert.deepEqual(saved.staff[0].roles, ["Admin", "SME Lead"]);
  assert.equal(saved.staff[0].active, true);
  assert.deepEqual(saved.staff[0].workshopIds, ["F-11", "FW-TEST"]);
  await assert.rejects(saveSmeAssignment(admin, { email: "admin@example.test", revision: current.revision, smeRoles: [], workshopIds: [] }), { code: "STAFF_CHANGED" });
});
test.after(async () => {
  if (env === undefined) delete process.env.KIMEU_SHEET_ID; else process.env.KIMEU_SHEET_ID = env;
  delete globalThis.__rdTransport;
  await rm(temp, { recursive: true, force: true });
});
