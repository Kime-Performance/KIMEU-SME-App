import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const temp = await mkdtemp(join(tmpdir(), "k-star-safety-"));
await build({
  stdin: { contents: "export * from './src/lib/kimeu/practicals'; export * from './src/lib/kimeu/course-tracking'; export * from './src/lib/kimeu/k-star'; export {SaveKimeuPracticalBody} from '@workspace/api-zod';",
    loader: "ts", resolveDir: new URL("../", import.meta.url).pathname },
  outfile: join(temp, "module.mjs"), bundle: true, platform: "node", format: "esm",
  plugins: [{ name: "isolated-k-star-provider", setup(b) {
    b.onResolve({ filter: /^@replit\/connectors-sdk$/ }, () => ({ path: "sheets", namespace: "fixture" }));
    b.onResolve({ filter: /^\.\/sessions$/ }, () => ({ path: "sessions", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
      contents: path === "sessions" ? "export async function openSession(){}" :
        "export class ReplitConnectors {proxy(...args){return globalThis.__kStarTransport(...args)}}",
    }));
  } }],
});
const prior = process.env.KIMEU_SHEET_ID;
process.env.KIMEU_SHEET_ID = "isolated-k-star-copy";
const api = await import(pathToFileURL(join(temp, "module.mjs")).href);
const A = "03b-Advanced Workshop Log", N = "03g-Clinician Notes", C = "03a-KIMEU Workshops";
const ah = ["Record ID", "PT Email", "PT Name", "RD", "Workshop ID", "Workshop Name", "Stage", "Lead SME", "Session Date", "Kajabi Progress %",
  "Pre-work Complete", "Attended", "Attendance Confirmed By", "Exam Score", "Exam Result", "Practical Date", "Practical Result", "Practical Scored By (RD)",
  "Workshop Status", "Completed Date", "CEU Issued", "Adoption Task Assigned", "Adoption Task Submitted", "Check-in Date", "Adoption Status",
  "Adoption Due (Day 60)", "Adoption Flag", "SME / Aaron Notes", "Last Updated By", "Last Updated", "K-Star Test Performed", "K-Star Stars Earned"];
const nh = ["Note ID", "Created", "PT Email", "PT Name (auto)", "Note Type", "Workshop ID", "Session ID", "Review ID", "Note", "Author", "Author Role", "Visibility", "Follow-up Needed"];
const row = (email, workshop = "FW-KB", date = "2026-01-01") => {
  const r = Array(32).fill("");
  Object.assign(r, { 0: `=record-${email}-${date}`, 1: email, 2: `PT ${email}`, 3: "Fixture RD", 4: workshop, 5: "=course-name",
    6: "=stage", 7: "=lead", 8: date, 9: "100", 10: "=pre-work", 11: "Yes", 12: "Fixture SME",
    13: "95", 14: "Pass", 15: date, 16: "Pass", 17: "Fixture RD", 18: "=complete-formula", 19: "=date-formula",
    20: "Keep CEU", 21: "Keep adoption", 27: "Keep director notes", 28: "Earlier RD", 29: "2026-01-01T12:00:00.000Z" });
  return r;
};
const admin = { active: true, email: "admin@fixture.test", roles: ["Admin"], nameInSheets: "Fixture Admin", workshopIds: [] };
const rd = { ...admin, email: "rd@fixture.test", roles: ["RD"], nameInSheets: "Fixture RD", workshopIds: ["FW-KB", "FW-OTHER"] };
let tables, batches, ignoreKStar = false;
function reset() {
  const blank = Array(32).fill(""); blank[0] = "=new-record"; blank[18] = "=status-formula";
  tables = {
    [A]: [[], [...ah], row("one@example.test"), row("two@example.test"), row("one@example.test", "FW-OTHER"), blank],
    [N]: [[], nh, ["earlier-audit", "", "", "=name-formula", "", "", "", "", "Preserve history"]],
    [C]: [[], ["Workshop ID", "Workshop Name", "Stage"], ["FW-KB", "KB Resilience", "Fellowship"], ["FW-OTHER", "Other workshop", "Fellowship"]],
    "03f-Session Log": [[], ["Session ID", "Session Status"]],
  };
  batches = []; ignoreKStar = false;
}
reset();
globalThis.__kStarTransport = async (_connector, url, options) => {
  if (url.includes("1CCBAQrjlACcWDPAS6Z2UIirnn-4tleSEuZhc6wPTufo")) return Response.json({ values: [
    ["Email", "Full Name", "Location", "Status", "Termination Date", "Department"],
    ...["one", "two", "new"].map(id => [`${id}@example.test`, `PT ${id}`, "North", "Active", "", "Clinical"]),
  ] });
  if (options?.method === "POST") {
    const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
    batches.push(body);
    for (const update of body.data) {
      const [, tab, letters, n] = update.range.match(/^'([^']+)'!([A-Z]+)(\d+)$/);
      const column = [...letters].reduce((v, c) => v * 26 + c.charCodeAt(0) - 64, 0) - 1;
      assert.ok(tab === N || tab === A, "No unrelated tab writes");
      if (ignoreKStar && tab === A && column >= 30) continue;
      tables[tab][Number(n) - 1] ??= [];
      tables[tab][Number(n) - 1][column] = update.values[0][0];
    }
    return Response.json({});
  }
  const decoded = decodeURIComponent(url.split("/values/")[1].split("?")[0]);
  const tab = decoded.match(/^'([^']+)'!/)[1];
  return Response.json({ values: tables[tab] });
};
const get = async (email = "one@example.test", workshop = "FW-KB", user = rd) =>
  (await api.getPracticals(user, workshop)).records.find(r => r.clinicianEmail === email);
const input = (record, kStarPerformed, kStarStars) => ({
  recordKey: record.recordKey, revision: record.revision, result: "Pass", practicalDate: record.sessionDate, notes: "",
  ...(kStarPerformed === undefined ? {} : { kStarPerformed, kStarStars }),
});
test.beforeEach(reset);

test("numeric sheet formatting remains valid evidence; FALSE or blank never implies an award", () => {
  assert.deepEqual(api.readKStar("TRUE", "3.00"), { performed: true, stars: 3 });
  for (const stars of ["", "-1", "1.5", "5", "KR3", "3 stars"]) assert.equal(api.readKStar("TRUE", stars).stars, null);
  assert.equal(api.readKStar("FALSE", "3").stars, null);
  assert.equal(api.readKStar("", "3").stars, null);
});

test("TRUE+3 writes real boolean and numeric level to existing AE/AF, ISO AD, preserving all course evidence", async () => {
  const before = structuredClone(tables[A]), r = await get();
  const ws = await api.savePractical(rd, "FW-KB", input(r, true, 3));
  assert.equal(tables[A].length, before.length, "No K-Star-only row appended");
  assert.equal(tables[A][2][30], true); assert.equal(tables[A][2][31], 3);
  assert.match(tables[A][2][29], /^\d{4}-\d{2}-\d{2}T.*Z$/);
  for (let i = 0; i < 32; i++) if (![15,16,17,28,29,30,31].includes(i)) assert.equal(tables[A][2][i], before[2][i], `preserve column ${i}`);
  assert.deepEqual(tables[A].slice(3), before.slice(3), "Other PT and workshop preserved");
  assert.equal(ws.records.find(x => x.recordKey === r.recordKey).kStarStars, 3);
  assert.equal((await get()).kStarPerformed, true, "Reopened values read from sheet");
  assert.equal((await get()).kStarHighestEarned, 3);
});
test("TRUE+0 is a recorded attempt, not a credential; blank historical evidence is not inferred", async () => {
  assert.equal((await get()).kStarPerformed, null);
  assert.equal((await get()).kStarStars, null);
  await api.savePractical(rd, "FW-KB", input(await get(), true, 0));
  const reopened = await get();
  assert.equal(reopened.kStarPerformed, true); assert.equal(reopened.kStarStars, 0); assert.equal(reopened.kStarHighestEarned, null);
});
test("unchecked new result writes FALSE/blank and cannot contain a level", async () => {
  await api.savePractical(rd, "FW-KB", input(await get(), false, null));
  assert.equal(tables[A][2][30], false); assert.equal(tables[A][2][31], "");
  for (const stars of [0, 1, 4]) {
    const sent = await inputFromCurrent(false, stars);
    await assert.rejects(() => api.savePractical(rd, "FW-KB", sent), /cannot include/);
  }
});
async function inputFromCurrent(performed, stars) { return input(await get(), performed, stars); }
test("negative, decimal, out-of-range, null and string levels are rejected by service and HTTP schema", async () => {
  const r = await get();
  for (const stars of [-1, 1.5, 5, null, "KR3", "3", NaN]) {
    await assert.rejects(() => api.savePractical(rd, "FW-KB", input(r, true, stars)), /whole-number/);
    if (stars !== null) assert.equal(api.SaveKimeuPracticalBody.safeParse(input(r, true, stars)).success, false);
  }
  assert.equal(batches.length, 0);
});
test("lower, zero, and unchecked retests preserve KR3 and performed evidence", async () => {
  await api.savePractical(rd, "FW-KB", input(await get(), true, 3));
  for (const [performed, stars] of [[true, 1], [true, 0], [false, null]]) {
    await api.savePractical(rd, "FW-KB", input(await get(), performed, stars));
    assert.equal(tables[A][2][30], true); assert.equal(tables[A][2][31], 3);
  }
});
test("highest evidence across retained same-email KB rows is retained and included in concurrency revision", async () => {
  const old = await get();
  const previous = row(" ONE@EXAMPLE.TEST ", "FW-KB", "2025-12-01"); previous[30] = "TRUE"; previous[31] = "4";
  tables[A].push(previous);
  await assert.rejects(() => api.savePractical(rd, "FW-KB", input(old, true, 1)), /changed/);
  assert.equal(batches.length, 0);
  await api.savePractical(rd, "FW-KB", input(await get(), true, 1));
  assert.equal(tables[A][2][31], 4);
  assert.equal(tables[A].at(-1)[31], "4");
});
test("unrelated course edits and omitted K-Star input preserve raw AE/AF", async () => {
  tables[A][2][30] = "TRUE"; tables[A][2][31] = "3";
  const before = tables[A][2].slice(30);
  await api.savePractical(rd, "FW-OTHER", input(await get("one@example.test", "FW-OTHER")));
  await api.savePractical(rd, "FW-KB", input(await get()));
  assert.deepEqual(tables[A][2].slice(30), before);
});
test("other workshop, foreign record, unassigned RD and SME cannot save K-Star results", async () => {
  const r = await get();
  await assert.rejects(() => api.savePractical(rd, "FW-OTHER", input(r, true, 3)), /only available/);
  await assert.rejects(() => api.savePractical(rd, "FW-KB", { ...input(r, true, 3), recordKey: "foreign" }), /not assigned/);
  await assert.rejects(() => api.savePractical({ ...rd, workshopIds: [] }, "FW-KB", input(r, true, 3)), /not assigned/);
  await assert.rejects(() => api.savePractical({ ...rd, nameInSheets: "Other RD" }, "FW-KB", input(r, true, 3)), /not assigned/);
  await assert.rejects(() => api.savePractical({ ...rd, roles: ["SME Lead"] }, "FW-KB", input(r, true, 3)), /Only an assigned RD/);
  assert.equal(batches.length, 0);
});
test("missing, shifted or duplicate K-Star headers block writes", async () => {
  for (const change of [
    () => { tables[A][1][30] = "Wrong header"; },
    () => { [tables[A][1][30], tables[A][1][31]] = [tables[A][1][31], tables[A][1][30]]; },
    () => { tables[A][1].push("K-Star Stars Earned"); },
  ]) {
    reset(); change();
    await assert.rejects(() => get(), /Expected K-Star/);
    assert.equal(batches.length, 0);
  }
});
test("unconfirmed K-Star readback is an error, not a false success", async () => {
  ignoreKStar = true;
  const sent = await inputFromCurrent(true, 3);
  await assert.rejects(() => api.savePractical(rd, "FW-KB", sent), e => e.code === "PRACTICAL_READBACK_FAILED");
});
test("new attendance enrollment initializes FALSE/blank; later attendance edits preserve awards", async () => {
  const date = "2026-01-01";
  const ws = await api.getCourseTracking(admin, "FW-KB", date);
  await api.saveCourseTracking(admin, "FW-KB", { kind: "attendance", sessionDate: date, revision: ws.revision, marks: [{ email: "new@example.test", checked: true }] });
  const created = tables[A].find(r => r[1] === "new@example.test");
  assert.equal(created[30], false); assert.equal(created[31], "");
  tables[A][2][30] = "TRUE"; tables[A][2][31] = "3";
  const latest = await api.getCourseTracking(admin, "FW-KB", date);
  await api.saveCourseTracking(admin, "FW-KB", { kind: "attendance", sessionDate: date, revision: latest.revision, marks: [{ email: "one@example.test", checked: true }] });
  assert.deepEqual(tables[A][2].slice(30), ["TRUE", "3"]);
});
test.after(async () => {
  if (prior === undefined) delete process.env.KIMEU_SHEET_ID; else process.env.KIMEU_SHEET_ID = prior;
  delete globalThis.__kStarTransport;
  await rm(temp, { recursive: true, force: true });
});
