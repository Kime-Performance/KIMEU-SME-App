import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Exercise the real Sheets allowlist, header mapping, atomic batch and readback
// against an isolated fake transport. This test never reaches Google.
const directory = await mkdtemp(join(tmpdir(), "kimeu-practical-tests-"));
const output = join(directory, "practicals.mjs");
await build({
  entryPoints: [new URL("../src/lib/kimeu/practicals.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", outfile: output,
  plugins: [{
    name: "isolated-sheets-transport",
    setup(builder) {
      builder.onResolve({ filter: /^@replit\/connectors-sdk$/ }, () => ({ path: "transport", namespace: "fake" }));
      builder.onLoad({ filter: /.*/, namespace: "fake" }, () => ({
        contents: "export class ReplitConnectors { proxy(...args) { return globalThis.__practicalTestTransport(...args); } }",
        loader: "js",
      }));
    },
  }],
});
const originalSheet = process.env.KIMEU_SHEET_ID;
process.env.KIMEU_SHEET_ID = "isolated-test-copy";
const { getPracticals, savePractical } = await import(pathToFileURL(output).href);
const F = "03c-Foundations Tracker";
const A = "03b-Advanced Workshop Log";
const N = "03g-Clinician Notes";
const data = {
  "03a-KIMEU Workshops": [
    [], ["Workshop ID", "Workshop Name", "Stage"],
    ["F-TEST", "Foundation test", "Foundations"], ["FW-TEST", "Advanced test", "Fellowship"],
  ],
  [F]: [
    ["", "", "", "F-TEST — Test"],
    ["PT Email", "PT Name", "RD", "Session Date", "Attended (SME)", "Practical Date", "Practical Result", "Complete", "Last Updated By", "Last Updated"],
    [],
    ["fixture@example.test", "Fixture PT", "Fixture RD", "2026-01-01", "Yes", "", "", "=computed"],
    ["other@example.test", "Other PT", "Different RD", "2026-01-01", "Yes"],
    ["absent@example.test", "Absent PT", "Fixture RD", "2026-01-01", "No"],
  ],
  [A]: [
    [],
    ["Record ID", "PT Email", "PT Name", "RD", "Workshop ID", "Session Date", "Attended", "Practical Date", "Practical Result", "Practical Scored By (RD)", "Workshop Status", "Last Updated By", "Last Updated"],
    ["record-1", "fixture@example.test", "Fixture PT", "Fixture RD", "FW-TEST", "2026-01-01", "Yes", "", "", "", "=computed"],
  ],
  [N]: [
    [],
    ["Note ID", "Created", "PT Email", "PT Name (auto)", "Note Type", "Workshop ID", "Session ID", "Review ID", "Note", "Follow-up Needed", "Author", "Author Role", "Visibility"],
    ["old-note", "2026-01-01", "fixture@example.test", "=formula", "General", "F-TEST", "", "", "Keep this prior note.", "", "Different RD", "RD", "Aaron + author"],
    ["", "", "", "=formula"],
  ],
};
let batches = [];
let rejectNextBatch = false;
globalThis.__practicalTestTransport = async (_connector, url, options) => {
  assert.match(url, /isolated-test-copy/);
  if (options?.method === "POST") {
    const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
    if (rejectNextBatch) {
      rejectNextBatch = false;
      return new Response("{}", { status: 503 });
    }
    batches.push(body);
    for (const update of body.data) {
      const match = update.range.match(/^'([^']+)'!([A-Z]+)(\d+)$/);
      assert.ok(match, update.range);
      const [, tab, letters, number] = match;
      const column = [...letters].reduce((sum, c) => sum * 26 + c.charCodeAt(0) - 64, 0) - 1;
      const row = Number(number) - 1;
      while (data[tab].length <= row) data[tab].push([]);
      data[tab][row][column] = update.values[0][0];
    }
    return Response.json({});
  }
  const range = decodeURIComponent(url.split("/values/")[1].split("?")[0]);
  const tab = range.match(/^'([^']+)'!/)[1];
  return Response.json({ values: data[tab] });
};
const rd = { email: "rd@example.test", nameInSheets: "Fixture RD", roles: ["RD"], workshopIds: ["F-TEST", "FW-TEST"], active: true };
const sme = { ...rd, nameInSheets: "Fixture SME", roles: ["Foundations SME"] };
const admin = { ...rd, nameInSheets: "Fixture Director", roles: ["Admin"], workshopIds: [] };
const inputFor = (record, override = {}) => ({
  recordKey: record.recordKey, revision: record.revision, result: "Pass",
  practicalDate: "2026-01-02", notes: "", ...override,
});

test("assigned RD can save failure with notes, reassess, and retain private audit history atomically", async () => {
  const workspace = await getPracticals(rd, "F-TEST");
  assert.equal(workspace.canSignOff, true);
  assert.equal(workspace.records.length, 2);
  const record = workspace.records.find(r => r.name === "Fixture PT");
  const count = batches.length;
  await assert.rejects(savePractical(rd, "F-TEST", inputFor(record, { result: "Fail", notes: " " })), /Explain/);
  assert.equal(batches.length, count);
  const failed = await savePractical(rd, "F-TEST", inputFor(record, { result: "Fail", notes: "Repeat the technique safely." }));
  assert.equal(batches.length, count + 1);
  const failure = failed.records.find(r => r.recordKey === record.recordKey);
  assert.equal(failure.result, "Fail");
  assert.match(failure.history[0].note, /Repeat the technique safely/);
  assert.equal(failure.scoredBy, "Fixture RD");
  assert.equal(data[F][3][7], "=computed");
  assert.equal(data[N][2][8], "Keep this prior note.");
  assert.equal(data[N][3][3], "=formula");
  assert.ok(batches.at(-1).data.some(x => x.range.startsWith(`'${F}'`)));
  assert.ok(batches.at(-1).data.some(x => x.range.startsWith(`'${N}'`)));
  await assert.rejects(savePractical(rd, "F-TEST", inputFor(record)), /changed/);
  const passed = await savePractical(rd, "F-TEST", inputFor(failure));
  const pass = passed.records.find(r => r.recordKey === record.recordKey);
  assert.equal(pass.result, "Pass");
  assert.equal(pass.history.length, 2);
  const reader = await getPracticals(sme, "F-TEST");
  assert.equal(reader.canSignOff, false);
  assert.equal(reader.records.find(r => r.recordKey === record.recordKey).history.length, 0);
  const director = await getPracticals(admin, "F-TEST");
  assert.equal(director.records.find(r => r.recordKey === record.recordKey).history.length, 2);
});

test("server denies SMEs, other RDs, unassigned workshops, and unconfirmed attendance without writes", async () => {
  const workspace = await getPracticals(rd, "F-TEST");
  const record = workspace.records.find(r => r.name === "Fixture PT");
  const count = batches.length;
  await assert.rejects(savePractical(sme, "F-TEST", inputFor(record)), /Only an assigned RD/);
  await assert.rejects(savePractical({ ...rd, nameInSheets: "Different RD" }, "F-TEST", inputFor(record)), /not assigned/);
  await assert.rejects(getPracticals({ ...rd, workshopIds: [] }, "F-TEST"), /not assigned/);
  const absent = workspace.records.find(r => r.name === "Absent PT");
  await assert.rejects(savePractical(rd, "F-TEST", inputFor(absent)), /attendance/);
  assert.equal(batches.length, count);
});

test("Advanced sign-off writes scorer and preserves computed status; provider failure changes nothing", async () => {
  const record = (await getPracticals(rd, "FW-TEST")).records[0];
  rejectNextBatch = true;
  await assert.rejects(savePractical(rd, "FW-TEST", inputFor(record)), /Sheets/);
  assert.equal(data[A][2][8], "");
  assert.equal(data[A][2][9], "");
  const saved = await savePractical(rd, "FW-TEST", inputFor(record));
  assert.equal(saved.records[0].scoredBy, "Fixture RD");
  assert.equal(data[A][2][10], "=computed");
  assert.equal(data[A][2][9], "Fixture RD");
});

test("master spreadsheet remains blocked without explicit live approval", async () => {
  process.env.KIMEU_SHEET_ID = "1cXPmoIV0El9aGjwsac9sszhjFYOpz0C0QFx4GoxSaxM";
  const liveApproval = process.env.KIMEU_ENABLE_LIVE_WRITES;
  delete process.env.KIMEU_ENABLE_LIVE_WRITES;
  try { await assert.rejects(getPracticals(rd, "F-TEST"), { code: "SHEET_NOT_CONFIGURED" }); }
  finally {
    if (liveApproval === undefined) delete process.env.KIMEU_ENABLE_LIVE_WRITES;
    else process.env.KIMEU_ENABLE_LIVE_WRITES = liveApproval;
  }
});

test.after(async () => {
  if (originalSheet === undefined) delete process.env.KIMEU_SHEET_ID;
  else process.env.KIMEU_SHEET_ID = originalSheet;
  delete globalThis.__practicalTestTransport;
  await rm(directory, { recursive: true, force: true });
});
