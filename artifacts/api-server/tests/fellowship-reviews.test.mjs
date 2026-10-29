import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { fellowshipLatestFormula } from "../../../scripts/src/kimeu-fellowship-summary.mjs";

const temp = await mkdtemp(join(tmpdir(), "fellowship-review-"));
await build({
  stdin: { contents: "export * from './src/lib/kimeu/fellowship-reviews'; export {isUnusedFellowshipRow} from './src/lib/kimeu/sheets';", resolveDir: new URL("../", import.meta.url).pathname, loader: "ts" },
  outfile: join(temp, "module.mjs"), bundle: true, platform: "node", format: "esm",
  plugins: [{ name: "isolated-provider", setup(b) {
    b.onResolve({ filter: /^@replit\/connectors-sdk$/ }, () => ({ path: "sheets", namespace: "fixture" }));
    b.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: "clerk", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
      contents: path === "clerk" ? "export const clerkClient={};export const getAuth=()=>({});"
        : "export class ReplitConnectors {proxy(...args){return globalThis.__fellowshipTransport(...args)}}",
    }));
  } }],
});
const previous = process.env.KIMEU_SHEET_ID;
process.env.KIMEU_SHEET_ID = "isolated-fellowship-fixture";
const { getFellowshipReviews, saveFellowshipReview, isUnusedFellowshipRow } = await import(pathToFileURL(join(temp, "module.mjs")).href);
const R = "03d-Fellowship Review Log", N = "03g-Clinician Notes", C = "03a-KIMEU Workshops";
const headers = ["Review ID", "Review Date", "Reviewed By", "Review Type", "PT Email", "PT Name", "Result", "Score",
  "Workshop ID (Refocus)", "Workshop Name", "Assigned SME", "Specific Need", "1:1 Due (Day 14)", "1:1 Date",
  "Re-demonstration Date", "Re-demonstration Result", "Verified By", "Status", "Days Open", "Notes",
  "Refocus Strategy", "Last Updated By", "Last Updated", "Scheduled Exam Date"];
const notesHeaders = ["Note ID", "Created", "PT Email", "PT Name (auto)", "Note Type", "Workshop ID", "Session ID", "Review ID", "Note",
  "Follow-up Needed", "Follow-up Due", "Follow-up Done", "Author", "Author Role", "Visibility"];
const tables = {
  [R]: [[], headers, ["example", "", "", "", "example@fixture.test"], [
    '=IF(E4="","","FR-"&E4)', "2025-01-02", "Earlier Reviewer", "Fellowship Exam", "one@fixture.test", "Fixture Clinician",
    "Pass", "85", "", '=IF(I4="","","Workshop")', '=IF(I4="","","Assigned SME")', "", '=IF(G4="Refocus",B4+14,"")',
    "", "", "", "", '=IF(G4="Pass","Passed","Open")', '=IF(G4="Refocus",1,"")', "Preserve earlier clinical feedback",
  ]],
  [N]: [[], notesHeaders, ["prior-audit", "", "", "", "", "", "", "", "Keep original audit"]],
  [C]: [[], ["Workshop ID", "Workshop Name", "Stage"], ["FW-TEST", "Fixture Fellowship", "Fellowship"], ["F-TEST", "Fixture Foundations", "Foundations"]],
};
const directory = [["Email", "Full Name", "Location", "Status", "Termination Date", "Department"],
  ["one@fixture.test", "Fixture Clinician", "Test Region", "Active", "", "Clinical"],
  ["inactive@fixture.test", "Inactive Clinician", "Test Region", "Inactive", "", "Clinical"]];
const reviewer = { email: "reviewer@fixture.test", nameInSheets: "Fixture Reviewer", roles: ["Fellowship Reviewer"], workshopIds: [], active: true };
let failWrite = false, inputWrites = 0;
function rendered() {
  return tables[R].map((r, index) => {
    if (index < 3 || !r[4]) return r;
    const out = [...r];
    out[0] = `FR-${r[1]}-${r[4]}`;
    out[9] = r[8] ? "Fixture Fellowship" : "";
    out[10] = r[8] ? "Workshop SME" : "";
    out[12] = r[6] === "Refocus" ? "2026-01-19" : "";
    out[17] = r[6] === "Pass" ? "Passed" : "Overdue";
    out[18] = r[6] === "Refocus" ? "20" : "";
    return out;
  });
}
globalThis.__fellowshipTransport = async (_slug, path, options) => {
  if (path.includes("1CCBAQrjlACcWDPAS6Z2UIirnn-4tleSEuZhc6wPTufo")) {
    assert.equal(options.method, "GET");
    return Response.json({ values: directory });
  }
  const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
  if (path.endsWith(":batchUpdate") && !path.includes("/values")) {
    for (const req of body.requests) {
      if (!req.copyPaste) continue;
      const { source, destination, pasteType } = req.copyPaste;
      assert.equal(pasteType, "PASTE_FORMULA");
      const column = source.startColumnIndex;
      assert.ok([0, 9, 10, 12, 17, 18].includes(column));
      for (let i = destination.startRowIndex; i < destination.endRowIndex; i++) {
        tables[R][i] ??= [];
        tables[R][i][column] = tables[R][3][column];
      }
    }
    return Response.json({});
  }
  if (options.method === "POST") {
    if (failWrite) return Response.json({}, { status: 503 });
    const next = structuredClone(tables);
    for (const update of body.data) {
      const [, tab, letters, number] = update.range.match(/^'([^']+)'!([A-Z]+)(\d+)$/);
      const column = [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
      if (tab === R) assert.ok(![0, 9, 10, 12, 17, 18].includes(column), "Input writes must never overwrite formula columns");
      while (next[tab].length < Number(number)) next[tab].push([]);
      const value = update.values[0][0];
      next[tab][Number(number) - 1][column] = typeof value === "string" && /^'[=+@-]/.test(value) ? value.slice(1) : String(value);
    }
    Object.assign(tables, next); inputWrites++;
    return Response.json({});
  }
  if (!path.includes("/values/")) return Response.json({ sheets: [{ properties: {
    sheetId: 99, title: R, gridProperties: { rowCount: 1000, columnCount: 28 },
  } }] });
  const decoded = decodeURIComponent(path.split("/values/")[1].split("?")[0]);
  const tab = decoded.match(/^'([^']+)'!/)[1];
  if (decoded.includes("A4:ZZ4")) return Response.json({ values: [tables[R][3]] });
  return Response.json({ values: tab === R ? rendered() : tables[tab] });
};
const input = (ws, extra = {}) => ({
  email: "one@fixture.test", reviewDate: "2026-01-05", result: "Refocus", score: 72,
  notes: "Clinical reasoning needs a clearer supporting explanation.", workshopId: null,
  revision: ws.people[0].revision, requestId: randomUUID(), ...extra,
});

test("reviewers and admins can review; ordinary SMEs/RDs and inactive staff cannot", async () => {
  const ws = await getFellowshipReviews(reviewer);
  assert.equal(ws.people.length, 1);
  assert.equal(ws.reviews.length, 1, "Exclude the example row");
  assert.equal(ws.workshops.length, 1);
  for (const roles of [["RD"], ["SME Lead"], ["SME Assist"]]) {
    await assert.rejects(getFellowshipReviews({ ...reviewer, roles }), { code: "ROLE_NOT_ALLOWED" });
    await assert.rejects(saveFellowshipReview({ ...reviewer, roles }, input(ws)), { code: "ROLE_NOT_ALLOWED" });
  }
  await assert.rejects(getFellowshipReviews({ ...reviewer, active: false }), { code: "APP_USER_INACTIVE" });
  assert.equal((await getFellowshipReviews({ ...reviewer, roles: ["Admin"] })).reviews.length, 1);
});
test("Refocus preserves prior attempts, maps numeric score/notes, and appends private audit atomically", async () => {
  const original = structuredClone(tables[R][3]);
  const ws = await getFellowshipReviews(reviewer), request = input(ws);
  const saved = await saveFellowshipReview(reviewer, request);
  assert.deepEqual(tables[R][3], original);
  assert.equal(saved.reviews.length, 2);
  assert.equal(saved.reviews[0].result, "Refocus");
  assert.equal(saved.reviews[0].score, 72);
  assert.equal(saved.reviews[0].notes, request.notes);
  assert.equal(saved.reviews[0].specificNeed, request.notes);
  assert.equal(saved.reviews[0].reviewedBy, reviewer.nameInSheets);
  assert.equal(saved.reviews[0].reviewType, "Fellowship Exam");
  assert.equal(saved.reviews[0].status, "Overdue");
  const audit = tables[N].find(r => r[0] === `FELLOWSHIP:${request.requestId}`);
  assert.equal(audit[14], "Aaron + author");
  const count = inputWrites;
  const retry = await saveFellowshipReview(reviewer, request);
  assert.equal(retry.reviews.length, 2);
  assert.equal(inputWrites, count, "Retry of the same request must not duplicate a review");
  await assert.rejects(saveFellowshipReview(reviewer, { ...request, score: 10 }), { code: "REVIEW_REQUEST_CONFLICT" });
});
test("invalid scores, missing failure feedback, stale history and unavailable PTs never write", async () => {
  const ws = await getFellowshipReviews(reviewer), count = inputWrites;
  for (const extra of [{ score: -1 }, { score: 101 }, { score: NaN }, { result: "Fail" }, { notes: " " },
    { reviewDate: "2026-02-30" }, { reviewDate: "2099-01-01" }, { notes: "x".repeat(4001) }, { requestId: "bad" },
    { workshopId: "F-TEST" }, { result: "Pass", workshopId: "FW-TEST" }]) {
    await assert.rejects(saveFellowshipReview(reviewer, input(ws, extra)));
  }
  await assert.rejects(saveFellowshipReview(reviewer, input(ws, { revision: "stale" })), { code: "REVIEW_CHANGED" });
  await assert.rejects(saveFellowshipReview(reviewer, input(ws, { email: "inactive@fixture.test" })), { code: "PT_UNAVAILABLE" });
  assert.equal(inputWrites, count);
});
test("explicit reviewer choice is not overridden by a score threshold; a pass is a new attempt", async () => {
  const ws = await getFellowshipReviews(reviewer);
  const saved = await saveFellowshipReview(reviewer, input(ws, { result: "Pass", score: 0, notes: "" }));
  assert.equal(saved.reviews[0].result, "Pass");
  assert.equal(saved.reviews[0].score, 0);
  assert.equal(saved.reviews[0].status, "Passed");
  assert.equal(saved.reviews.length, 3);
});
test("provider rejection does not append an assessment or audit", async () => {
  const ws = await getFellowshipReviews(reviewer), before = structuredClone(tables[N]), count = inputWrites;
  failWrite = true;
  try { await assert.rejects(saveFellowshipReview(reviewer, input(ws)), { code: "SHEET_WRITE_FAILED" }); }
  finally { failWrite = false; }
  assert.equal(inputWrites, count);
  assert.deepEqual(tables[N], before);
  assert.equal((await getFellowshipReviews(reviewer)).reviews.length, 3);
});
test("reserved exam slots and drafts cannot be reused; Summary handles same-day attempts", () => {
  const scheduled = []; scheduled[23] = "2026-02-01";
  assert.equal(isUnusedFellowshipRow(scheduled), false);
  const draft = []; draft[19] = "Draft feedback";
  assert.equal(isUnusedFellowshipRow(draft), false);
  assert.equal(isUnusedFellowshipRow(["", "", "", "Fellowship Exam"]), true);
  assert.match(fellowshipLatestFormula(7, "H"), /1,FALSE,3,FALSE,4,FALSE/);
  assert.match(fellowshipLatestFormula(7, "T"), /\$W\$4:\$W/);
});
test.after(async () => {
  if (previous === undefined) delete process.env.KIMEU_SHEET_ID;
  else process.env.KIMEU_SHEET_ID = previous;
  delete globalThis.__fellowshipTransport;
  await rm(temp, { recursive: true, force: true });
});
