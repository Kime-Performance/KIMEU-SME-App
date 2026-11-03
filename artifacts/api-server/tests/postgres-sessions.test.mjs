import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Postgres data-layer slice tests. No real database: the postgres driver is
// stubbed out of the bundle and a recording fake sql executor is injected
// through the real db/client.setSql hook.
const temp = await mkdtemp(join(tmpdir(), "pg-sessions-"));
await build({
  entryPoints: [
    new URL("../src/lib/kimeu/sessions.ts", import.meta.url).pathname,
    new URL("../src/lib/kimeu/db/client.ts", import.meta.url).pathname,
  ],
  outdir: temp,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  splitting: true,
  platform: "node",
  format: "esm",
  plugins: [{ name: "stub-drivers", setup(b) {
    b.onResolve({ filter: /^postgres$/ }, () => ({ path: "postgres", namespace: "stub" }));
    b.onResolve({ filter: /^@replit\/connectors-sdk$/ }, () => ({ path: "sdk", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, ({ path }) => ({
      contents: path === "postgres"
        ? "export default function postgres(){ throw new Error('postgres driver is stubbed in tests'); }"
        : "export class ReplitConnectors { proxy(){ throw new Error('sheets transport is stubbed in tests'); } }",
    }));
  } }],
});

const savedSource = process.env.KIMEU_DATA_SOURCE;
const savedUrl = process.env.DATABASE_URL;
process.env.KIMEU_DATA_SOURCE = "postgres";
process.env.DATABASE_URL = "postgres://test";
process.env.KIMEU_SHEET_ID = "isolated-sessions-copy";

const sessions = await import(pathToFileURL(join(temp, "sessions.mjs")).href);
const client = await import(pathToFileURL(join(temp, "db", "client.mjs")).href);
const { getSessionDetail, openSession, saveAttendance, completeSession } = sessions;

test.after(async () => {
  if (savedSource === undefined) delete process.env.KIMEU_DATA_SOURCE;
  else process.env.KIMEU_DATA_SOURCE = savedSource;
  if (savedUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedUrl;
  await rm(temp, { recursive: true, force: true });
});

const user = {
  email: "sme@example.test",
  nameInSheets: "SME One",
  roles: ["SME Lead"],
  workshopIds: ["FW-TEST", "F-TEST"],
  active: true,
};

function sessionRow(overrides = {}) {
  return {
    session_id: "FW-TEST-20261102",
    workshop_id: "FW-TEST",
    workshop_name: "Test advanced",
    stage: "Fellowship",
    session_date: "2026-11-02",
    start_time: null,
    location: null,
    lead_sme: "SME One",
    session_status: "Live",
    session_notes: "prior note",
    changes_for_next_session: "prior change",
    ...overrides,
  };
}

/**
 * Queue-based fake sql executor. Each call shifts one expected step,
 * asserts the query text matches, and resolves with the step rows.
 * Records every call with its text, values, and transaction depth.
 */
function fakeSql(steps) {
  const calls = [];
  let depth = 0;
  const sql = (strings, ...values) => {
    const text = strings.reduce((out, part, i) => out + part + (i < values.length ? `$${i + 1}` : ""), "");
    const step = steps.shift();
    calls.push({ text, values, inTx: depth > 0 });
    if (!step) return Promise.reject(new Error(`Unexpected query: ${text}`));
    assert.match(text, step.match, `Query did not match expected ${step.match}: ${text}`);
    const rows = step.rows ?? [];
    rows.count = step.count ?? rows.length;
    return Promise.resolve(rows);
  };
  sql.begin = async (fn) => {
    calls.push({ text: "BEGIN", values: [], inTx: false });
    depth += 1;
    try {
      return await fn(sql);
    } finally {
      depth -= 1;
      calls.push({ text: "COMMIT", values: [], inTx: false });
    }
  };
  sql.calls = calls;
  sql.unused = () => steps;
  return sql;
}

const LOCK = { match: /pg_advisory_xact_lock/, rows: [] };

test("getSessionDetail returns the session summary and roster from Postgres", async () => {
  const sql = fakeSql([
    { match: /from kimeu_sessions/, rows: [sessionRow()] },
    { match: /from kimeu_workshop_records/, rows: [
      { pt_email: "One@Example.test", full_name: "Fixture One", attended: true, computed_status: "In Progress", practical_status: "Pass" },
      { pt_email: "two@example.test", full_name: null, attended: null, computed_status: null, practical_status: null },
    ] },
  ]);
  client.setSql(sql);
  const detail = await getSessionDetail("FW-TEST-20261102");
  assert.equal(detail.session.sessionId, "FW-TEST-20261102");
  assert.equal(detail.session.workshopName, "Test advanced");
  assert.equal(detail.session.rosterCount, 2);
  assert.equal(detail.session.presentCount, 1);
  assert.equal(detail.session.unmarkedCount, 1);
  assert.equal(detail.roster[0].clinicianEmail, "One@Example.test");
  assert.equal(detail.roster[0].name, "Fixture One");
  assert.equal(detail.roster[0].attended, "Yes");
  assert.equal(detail.roster[0].sourceTab, "03b-Advanced Workshop Log");
  assert.equal(detail.roster[1].name, "Unnamed clinician");
  assert.equal(detail.roster[1].attended, null);
  assert.equal(detail.sessionNotes, "prior note");
  assert.equal(detail.changesForNextSession, "prior change");
  assert.deepEqual(sql.unused(), []);
});

test("openSession inserts a new kimeu_sessions row inside the advisory lock", async () => {
  const sql = fakeSql([
    { match: /from kimeu_workshops/, rows: [{ found: 1 }] },
    LOCK,
    { match: /from kimeu_sessions/, rows: [] },
    { match: /insert into kimeu_sessions/, rows: [], count: 1 },
    { match: /from kimeu_sessions/, rows: [sessionRow()] },
    { match: /from kimeu_workshop_records/, rows: [] },
  ]);
  client.setSql(sql);
  const detail = await openSession(user, "FW-TEST", "2026-11-02");
  const insert = sql.calls.find((call) => /insert into kimeu_sessions/.test(call.text));
  assert.ok(insert, "an INSERT into kimeu_sessions was issued");
  assert.equal(insert.inTx, true, "insert ran inside the advisory-lock transaction");
  assert.deepEqual(insert.values.slice(0, 4), ["FW-TEST-20261102", "FW-TEST", "2026-11-02", "SME One"]);
  assert.match(insert.text, /'Live'/, "insert sets Session Status to Live");
  assert.equal(detail.session.sessionStatus, "Live");
  assert.deepEqual(sql.unused(), []);
});

test("openSession rejects reopening a completed session", async () => {
  const sql = fakeSql([
    { match: /from kimeu_workshops/, rows: [{ found: 1 }] },
    LOCK,
    { match: /from kimeu_sessions/, rows: [{
      session_id: "FW-TEST-20261102", workshop_id: "FW-TEST",
      session_date: "2026-11-02", session_status: "Complete",
    }] },
  ]);
  client.setSql(sql);
  await assert.rejects(
    openSession(user, "FW-TEST", "2026-11-02"),
    (error) => error.code === "SESSION_CLOSED",
  );
  assert.deepEqual(sql.unused(), []);
});

test("saveAttendance updates workshop_records and writes one audit note atomically", async () => {
  const sql = fakeSql([
    { match: /from kimeu_sessions/, rows: [sessionRow()] },
    { match: /from kimeu_workshop_records/, rows: [
      { pt_email: "one@example.test", full_name: "Fixture One", attended: null, computed_status: null, practical_status: null },
    ] },
    LOCK,
    { match: /select session_status/, rows: [{ session_status: "Live" }] },
    { match: /update kimeu_workshop_records/, rows: [], count: 1 },
    { match: /insert into kimeu_clinician_notes/, rows: [], count: 1 },
    { match: /from kimeu_sessions/, rows: [sessionRow()] },
    { match: /from kimeu_workshop_records/, rows: [
      { pt_email: "one@example.test", full_name: "Fixture One", attended: true, computed_status: "Attended", practical_status: null },
    ] },
  ]);
  client.setSql(sql);
  const result = await saveAttendance(user, "FW-TEST-20261102", [
    { clinicianEmail: "One@Example.test", attended: "Yes" },
  ]);
  const update = sql.calls.find((call) => /update kimeu_workshop_records/.test(call.text));
  const note = sql.calls.find((call) => /insert into kimeu_clinician_notes/.test(call.text));
  assert.ok(update && note, "attendance update and audit note were both issued");
  assert.equal(update.inTx, true, "attendance update ran inside the transaction");
  assert.equal(note.inTx, true, "audit note ran inside the same transaction");
  assert.equal(update.values[0], true, "attended boolean column receives the mark as true");
  assert.equal(update.values[1], "SME One");
  assert.equal(update.values[4], "one@example.test", "matched case-insensitively on normalized email");
  assert.equal(update.values[5], "FW-TEST");
  assert.equal(update.values[6], "2026-11-02");
  assert.ok(note.values[6].includes("one@example.test=Yes"), "audit note summarizes the marks");
  assert.equal(note.values[4], "FW-TEST");
  assert.equal(note.values[5], "FW-TEST-20261102");
  assert.equal(result.results[0].attended, "Yes");
  assert.equal(result.results[0].computedStatus, "Attended");
  assert.deepEqual(sql.unused(), []);
});

test("saveAttendance updates foundations_blocks for a Foundations session", async () => {
  const foundation = sessionRow({
    session_id: "F-TEST-20261103",
    workshop_id: "F-TEST",
    workshop_name: "Test foundation",
    stage: "Foundations",
    session_date: "2026-11-03",
  });
  const sql = fakeSql([
    { match: /from kimeu_sessions/, rows: [foundation] },
    { match: /from kimeu_foundations_blocks/, rows: [
      { pt_email: "two@example.test", full_name: "Fixture Two", attended: null, computed_status: null, practical_status: null },
    ] },
    LOCK,
    { match: /select session_status/, rows: [{ session_status: "Live" }] },
    { match: /update kimeu_foundations_blocks/, rows: [], count: 1 },
    { match: /insert into kimeu_clinician_notes/, rows: [], count: 1 },
    { match: /from kimeu_sessions/, rows: [foundation] },
    { match: /from kimeu_foundations_blocks/, rows: [
      { pt_email: "two@example.test", full_name: "Fixture Two", attended: false, computed_status: null, practical_status: null },
    ] },
  ]);
  client.setSql(sql);
  const result = await saveAttendance(user, "F-TEST-20261103", [
    { clinicianEmail: "two@example.test", attended: "No" },
  ]);
  const update = sql.calls.find((call) => /update kimeu_foundations_blocks/.test(call.text));
  assert.ok(update, "foundations block update was issued");
  assert.equal(update.inTx, true);
  assert.equal(update.values[0], "2026-11-03");
  assert.equal(update.values[1], false, "attended_sme boolean column receives the mark as false");
  assert.equal(result.results[0].attended, "No");
  assert.deepEqual(sql.unused(), []);
});

test("saveAttendance rolls back when the roster row is ambiguous", async () => {
  const sql = fakeSql([
    { match: /from kimeu_sessions/, rows: [sessionRow()] },
    { match: /from kimeu_workshop_records/, rows: [
      { pt_email: "one@example.test", full_name: "Fixture One", attended: null, computed_status: null, practical_status: null },
    ] },
    LOCK,
    { match: /select session_status/, rows: [{ session_status: "Live" }] },
    { match: /update kimeu_workshop_records/, rows: [], count: 0 },
  ]);
  client.setSql(sql);
  await assert.rejects(
    saveAttendance(user, "FW-TEST-20261102", [{ clinicianEmail: "one@example.test", attended: "Yes" }]),
    (error) => error.code === "ROSTER_ROW_CHANGED",
  );
  assert.equal(
    sql.calls.some((call) => /insert into kimeu_clinician_notes/.test(call.text)),
    false,
    "no audit note was written after the failed update",
  );
});

test("completeSession rejects unmarked attendance unless confirmed, then updates status", async () => {
  const unmarkedRoster = [
    { pt_email: "one@example.test", full_name: "Fixture One", attended: true, computed_status: null, practical_status: null },
    { pt_email: "two@example.test", full_name: "Fixture Two", attended: null, computed_status: null, practical_status: null },
  ];
  // Unconfirmed: rejected before any write.
  const rejecting = fakeSql([
    { match: /from kimeu_sessions/, rows: [sessionRow()] },
    { match: /from kimeu_workshop_records/, rows: unmarkedRoster },
  ]);
  client.setSql(rejecting);
  await assert.rejects(
    completeSession(user, "FW-TEST-20261102", {
      sessionNotes: "done", changesForNextSession: "none", confirmUnmarked: false,
    }),
    (error) => {
      assert.equal(error.code, "UNMARKED_ATTENDANCE");
      assert.deepEqual(JSON.parse(error.message), ["Fixture Two"]);
      return true;
    },
  );
  assert.deepEqual(rejecting.unused(), []);

  // Confirmed: status update inside the lock, then a refreshed read.
  const confirming = fakeSql([
    { match: /from kimeu_sessions/, rows: [sessionRow()] },
    { match: /from kimeu_workshop_records/, rows: unmarkedRoster },
    LOCK,
    { match: /update kimeu_sessions/, rows: [], count: 1 },
    { match: /from kimeu_sessions/, rows: [sessionRow({ session_status: "Complete", session_notes: "done", changes_for_next_session: "none" })] },
    { match: /from kimeu_workshop_records/, rows: unmarkedRoster },
  ]);
  client.setSql(confirming);
  const summary = await completeSession(user, "FW-TEST-20261102", {
    sessionNotes: "done", changesForNextSession: "none", confirmUnmarked: true,
  });
  const update = confirming.calls.find((call) => /update kimeu_sessions/.test(call.text));
  assert.ok(update, "session status update was issued");
  assert.equal(update.inTx, true, "update ran inside the advisory-lock transaction");
  assert.equal(update.values[0], "done");
  assert.equal(update.values[1], "none");
  assert.equal(update.values[2], "SME One");
  assert.equal(summary.sessionStatus, "Complete");
  assert.equal(summary.unmarkedCount, 1);
  assert.deepEqual(confirming.unused(), []);
});
