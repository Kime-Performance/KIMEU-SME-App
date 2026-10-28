import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const temp = await mkdtemp(join(tmpdir(), "course-tracking-"));
await build({
  entryPoints: [new URL("../src/lib/kimeu/course-tracking.ts", import.meta.url).pathname],
  outfile: join(temp, "module.mjs"), bundle: true, platform: "node", format: "esm",
  plugins: [{ name: "isolated-transport", setup(b) {
    b.onResolve({ filter: /^@replit\/connectors-sdk$/ }, () => ({ path: "transport", namespace: "mock" }));
    b.onResolve({ filter: /^\.\/sessions$/ }, () => ({ path: "sessions", namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({
      contents: path === "sessions" ? "export async function openSession(){ globalThis.__opened = true; }" :
        "export class ReplitConnectors { proxy(...args){ return globalThis.__trackingTransport(...args); } }",
    }));
  } }],
});
const savedEnv = process.env.KIMEU_SHEET_ID;
process.env.KIMEU_SHEET_ID = "isolated-checklist-copy";
const { getCourseTracking, saveCourseTracking, validateTrackingDate } = await import(pathToFileURL(join(temp, "module.mjs")).href);
const F = "03c-Foundations Tracker", A = "03b-Advanced Workshop Log", N = "03g-Clinician Notes";
const directory = [
  ["Full Name", "Email", "Location", "Status", "Termination Date", "Department"],
  ["Fixture One", "one@example.test", "North", "Active", "", "Clinical"],
  ["Fixture Two", "two@example.test", "South", "Active", "", "Clinical"],
  ["Former PT", "former@example.test", "North", "Terminated", "2026-01-01", "Clinical"],
];
const tables = {
  "03a-KIMEU Workshops": [[], ["Workshop ID", "Workshop Name", "Stage"], ["F-TEST", "Test foundation", "Foundations"], ["FW-TEST", "Test advanced", "Fellowship"]],
  [F]: [
    ["", "", "", "", "F-TEST — Test"],
    ["PT Email", "PT Name", "RD", "Kajabi Course %", "Session Date", "Attended (SME)", "Practical Date", "Practical Result", "Complete", "Last Updated By", "Last Updated"],
    [], ["one@example.test", "Fixture One", "Fixture RD", "100", "2026-01-01", "No", "", "", "=computed"],
    ["", "=name-formula", "", "", "", "", "", "", "=complete-formula"],
  ],
  [A]: [
    [],
    ["PT Email", "PT Name", "RD", "Workshop ID", "Session Date", "Kajabi Progress %", "Attended", "Practical Result", "Workshop Status", "Attendance Confirmed By", "Last Updated By", "Last Updated"],
    [], ["one@example.test", "Fixture One", "Fixture RD", "FW-TEST", "2026-01-01", "100", "Yes", "Pass", "=status-formula"],
    ["", "", "", "", "", "", "", "", "=status-formula"],
  ],
  [N]: [
    [], ["Note ID", "Created", "PT Email", "PT Name (auto)", "Note Type", "Workshop ID", "Session ID", "Review ID", "Note", "Author", "Author Role", "Visibility"],
    ["old-id", "", "", "=name-formula", "", "", "", "", "Old note remains."],
  ],
  "03f-Session Log": [[], ["Session ID", "Session Status"]],
};
const writes = [];
globalThis.__trackingTransport = async (_connector, path, options) => {
  if (path.includes("1CCBAQrjlACcWDPAS6Z2UIirnn-4tleSEuZhc6wPTufo")) {
    assert.equal(options.method, "GET");
    return Response.json({ values: directory });
  }
  if (path.includes("?fields=sheets")) {
    return Response.json({ sheets: [
      { properties: { title: F, sheetId: 42, gridProperties: { rowCount: 1000, columnCount: 52 } } },
      { properties: { title: A, sheetId: 43, gridProperties: { rowCount: 1000, columnCount: 52 } } },
    ] });
  }
  if (options.method === "POST") {
    const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
    writes.push(body);
    if (body.requests) {
      for (const { copyPaste } of body.requests) {
        if (!copyPaste) continue;
        assert.equal(copyPaste.pasteType, "PASTE_FORMULA");
        const tab = copyPaste.source.sheetId === 42 ? F : A;
        const column = copyPaste.source.startColumnIndex;
        for (let row = copyPaste.destination.startRowIndex; row < copyPaste.destination.endRowIndex; row++) {
          while (tables[tab].length <= row) tables[tab].push([]);
          assert.equal(tables[tab][row][column], undefined);
          tables[tab][row][column] = tables[tab][3][column];
        }
      }
      return Response.json({});
    }
    for (const update of body.data) {
      const [, tab, letters, number] = update.range.match(/^'([^']+)'!([A-Z]+)(\d+)$/);
      const index = [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
      while (tables[tab].length < Number(number)) tables[tab].push([]);
      tables[tab][Number(number) - 1][index] = update.values[0][0];
    }
    return Response.json({});
  }
  const range = decodeURIComponent(path.split("/values/")[1].split("?")[0]);
  const tab = range.match(/^'([^']+)'!/)[1];
  if (path.includes("valueRenderOption=FORMULA")) return Response.json({ values: [tables[tab][3]] });
  return Response.json({ values: tables[tab] });
};
const sme = { email: "sme@example.test", nameInSheets: "Fixture SME", roles: ["Foundations SME"], workshopIds: ["F-TEST", "FW-TEST"], active: true };
const date = "2026-01-01";
const saveInput = (workspace, kind, email, checked) => ({ sessionDate: date, revision: workspace.revision, kind, marks: [{ email, checked }] });

test("invalid workshop dates fail", () => {
  assert.throws(() => validateTrackingDate("2026-02-30"));
});
test("live directory excludes terminated PTs; attendance saves only selected input cells and rereads", async () => {
  const ws = await getCourseTracking(sme, "F-TEST", date);
  assert.equal(ws.people.length, 2);
  assert.equal(ws.people[0].attended, false);
  const result = await saveCourseTracking(sme, "F-TEST", saveInput(ws, "attendance", "one@example.test", true));
  assert.equal(result.people[0].attended, true);
  assert.equal(globalThis.__opened, true);
  assert.equal(tables[F][3][8], "=computed");
  assert.equal(result.people[0].preCourseComplete, true);
  assert.equal(result.people[0].sheetStatus, "=computed");
  await assert.rejects(saveCourseTracking(sme, "F-TEST", saveInput(ws, "attendance", "one@example.test", false)), /changed/);
  await assert.rejects(saveCourseTracking(sme, "F-TEST", saveInput(result, "completion", "one@example.test", true)), /calculated by the KIMEU sheet/);
});
test("available PT selection enrolls into blank template without touching formulas", async () => {
  const ws = await getCourseTracking(sme, "F-TEST", date);
  const saved = await saveCourseTracking(sme, "F-TEST", saveInput(ws, "attendance", "two@example.test", true));
  assert.equal(saved.people.find(p => p.email === "two@example.test").attended, true);
  assert.equal(tables[F][4][1], "=name-formula");
  assert.equal(tables[F][4][8], "=complete-formula");
});
test("legacy completion submissions are rejected without writing status, history or input cells", async () => {
  const ws = await getCourseTracking(sme, "FW-TEST", date);
  const before = structuredClone(tables);
  const count = writes.length;
  await assert.rejects(saveCourseTracking(sme, "FW-TEST", saveInput(ws, "completion", "one@example.test", true)), { code: "COMPLETION_SHEET_OWNED" });
  assert.equal(writes.length, count);
  assert.deepEqual(tables, before);
  assert.equal("completionVerified" in ws.people[0], false);
  assert.equal("canSaveCompletion" in ws, false);
  assert.equal(tables[A][3][8], "=status-formula");
  assert.equal(tables[N][2][8], "Old note remains.");
});
test("server rejects RD-only writers, missing assignments and unavailable PTs", async () => {
  const ws = await getCourseTracking(sme, "F-TEST", date);
  const count = writes.length;
  await assert.rejects(saveCourseTracking({ ...sme, roles: ["RD"] }, "F-TEST", saveInput(ws, "attendance", "one@example.test", true)), /Only an assigned SME/);
  await assert.rejects(getCourseTracking({ ...sme, workshopIds: [] }, "F-TEST", date), /not assigned/);
  await assert.rejects(saveCourseTracking(sme, "F-TEST", saveInput(ws, "attendance", "former@example.test", true)), /no longer/);
  assert.equal(writes.length, count);
});
test("full templates extend only new formula cells before saving another PT", async () => {
  directory.push(["Fixture Three", "three@example.test", "North", "Active", "", "Clinical"]);
  // Force a source refresh via save: the first attempt safely rejects a stale
  // roster revision, then the subsequent GET reads that refreshed directory.
  const old = await getCourseTracking(sme, "F-TEST", date);
  await assert.rejects(saveCourseTracking(sme, "F-TEST", saveInput(old, "attendance", "three@example.test", true)), /changed/);
  const ws = await getCourseTracking(sme, "F-TEST", date);
  const before = tables[F][3].slice();
  const result = await saveCourseTracking(sme, "F-TEST", saveInput(ws, "attendance", "three@example.test", true));
  assert.equal(result.people.find(p => p.email === "three@example.test").attended, true);
  assert.deepEqual(tables[F][3], before);
  assert.equal(tables[F].at(-1)[8], "=computed");
  assert.ok(writes.some(w => w.requests?.some(r => r.copyPaste)));
});
test.after(async () => {
  if (savedEnv === undefined) delete process.env.KIMEU_SHEET_ID; else process.env.KIMEU_SHEET_ID = savedEnv;
  delete globalThis.__trackingTransport;
  delete globalThis.__opened;
  await rm(temp, { recursive: true, force: true });
});
