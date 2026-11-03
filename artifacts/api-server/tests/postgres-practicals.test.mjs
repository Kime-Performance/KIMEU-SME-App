import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

// Exercise the Postgres data layer for RD practical sign-off against a fake
// query executor injected via db/client.setSql. No live database is touched.
// The bundle includes the real practicals.ts delegation (KIMEU_DATA_SOURCE
// is set to "postgres" below), the real db/practicals.ts, transaction lock
// wrapper, allowlist, practical rules, and K-Star merge logic.

const directory = await mkdtemp(join(tmpdir(), "kimeu-pg-practical-tests-"));
const output = join(directory, "postgres-practicals.mjs");
const apiServerDir = new URL("..", import.meta.url).pathname;
await build({
  stdin: {
    contents: [
      'export { getPracticals, savePractical, savePracticalSchedule } from "./src/lib/kimeu/practicals.ts";',
      'export { setSql } from "./src/lib/kimeu/db/client.ts";',
      'export { todayInAppTimeZone } from "./src/lib/kimeu/sheets.ts";',
    ].join("\n"),
    resolveDir: apiServerDir,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: output,
  plugins: [{
    name: "stub-externals",
    setup(builder) {
      builder.onResolve({ filter: /^postgres$/ }, () => ({ path: "postgres", namespace: "stub" }));
      builder.onResolve({ filter: /^@replit\/connectors-sdk$/ }, () => ({ path: "sdk", namespace: "stub" }));
      builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) =>
        args.path === "postgres"
          ? { contents: "export default function postgres(){ throw new Error('postgres stub: tests must call setSql'); }", loader: "js" }
          : { contents: "export class ReplitConnectors { proxy(){ throw new Error('sheets transport stubbed in postgres tests'); } }", loader: "js" });
    },
  }],
});

process.env.KIMEU_DATA_SOURCE = "postgres";
delete process.env.DATABASE_URL;

const { getPracticals, savePractical, savePracticalSchedule, setSql, todayInAppTimeZone } =
  await import(pathToFileURL(output).href);

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const shift = (base, days) =>
  new Date(Date.parse(`${base}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

const RD = { email: "rd@kimeperformance.com", nameInSheets: "RD Example", roles: ["RD"], workshopIds: ["ADV-1", "FW-KB", "F-1"], active: true };
const ADMIN = { email: "admin@kimeperformance.com", nameInSheets: "Admin Example", roles: ["Admin"], workshopIds: [], active: true };
const SME = { email: "sme@kimeperformance.com", nameInSheets: "SME Example", roles: ["SME Assist"], workshopIds: ["ADV-1"], active: true };

function createFakeSql(seed) {
  const state = {
    workshops: seed.workshops ?? [],
    records: (seed.records ?? []).map(r => ({
      person_id: null, pt_name: "", rd: "", attended: "No",
      practical_date: "", practical_result: "", scored_by: "",
      k_performed: null, k_stars: null, last_updated_by: "", last_updated: "",
      ...r,
    })),
    blocks: (seed.blocks ?? []).map(b => ({
      pt_name: "", rd: "", attended: "No",
      practical_date: "", practical_result: "", last_updated_by: "", last_updated: "",
      ...b,
    })),
    notes: (seed.notes ?? []).map(n => ({ ...n })),
    calls: [],
    beginCount: 0,
  };
  const recordRow = (r) => ({
    person_id: r.person_id ?? null,
    block_index: null,
    pt_email: r.pt_email,
    pt_name: r.pt_name,
    rd: r.rd ?? "",
    session_date: r.session_date,
    attended: r.attended,
    practical_date: r.practical_date ?? "",
    practical_result: r.practical_result ?? "",
    scored_by: r.scored_by ?? "",
    k_performed: r.k_performed ?? null,
    k_stars: r.k_stars ?? null,
    last_updated_by: r.last_updated_by ?? "",
    last_updated: r.last_updated ?? "",
  });
  const blockRow = (b) => ({
    person_id: b.person_id,
    block_index: b.block_index,
    pt_email: b.pt_email,
    pt_name: b.pt_name,
    rd: b.rd ?? "",
    session_date: b.session_date,
    attended: b.attended,
    practical_date: b.practical_date ?? "",
    practical_result: b.practical_result ?? "",
    scored_by: null,
    k_performed: null,
    k_stars: null,
    last_updated_by: b.last_updated_by ?? "",
    last_updated: b.last_updated ?? "",
  });
  const sql = async (strings, ...values) => {
    const text = strings.join("?").replace(/\s+/g, " ");
    state.calls.push({ text, values });
    if (text.includes("pg_advisory_xact_lock")) return [];
    if (text.startsWith("update kimeu_workshop_records") || text.includes(" update kimeu_workshop_records")) {
      const n = values.length;
      const [workshopId, sessionDate, personId, email] = values.slice(n - 4);
      const row = state.records.find(r =>
        r.workshop_id === workshopId && r.session_date === sessionDate &&
        (r.person_id === personId || (r.pt_email ?? "").toLowerCase() === email));
      assert.ok(row, `update must target an existing record (values: ${JSON.stringify(values)})`);
      row.practical_date = values[0];
      row.practical_result = values[1];
      row.scored_by = values[2];
      row.last_updated_by = values[3];
      row.last_updated = values[4];
      if (text.includes("k_star_test_performed")) {
        row.k_performed = values[5];
        row.k_stars = values[6];
      }
      return [];
    }
    if (text.includes("update kimeu_foundations_blocks")) {
      const [practicalDate, result, updatedBy, updated, personId, workshopId, blockIndex] = values;
      const row = state.blocks.find(b =>
        b.person_id === personId && b.workshop_id === workshopId && b.block_index === blockIndex);
      assert.ok(row, "update must target an existing foundations block");
      row.practical_date = practicalDate;
      row.practical_result = result;
      row.last_updated_by = updatedBy;
      row.last_updated = updated;
      return [];
    }
    if (text.includes("insert into kimeu_clinician_notes")) {
      state.notes.push({
        id: values[0], created: values[1], pt_email: values[2], note_type: values[3],
        workshop_id: values[4], session_id: values[5], review_id: values[6], note: values[7],
        follow_up: values[8], author: values[9], author_role: values[10], visibility: values[11],
      });
      return [];
    }
    if (text.includes("from kimeu_workshops")) {
      return state.workshops.filter(w => w.workshop_id === values[0]);
    }
    if (text.includes("from kimeu_foundations_blocks")) {
      return state.blocks.filter(b => b.workshop_id === values[0]).map(blockRow);
    }
    if (text.includes("practical_scored_by as scored_by")) {
      return state.records.filter(r => r.workshop_id === values[0]).map(recordRow);
    }
    if (text.includes("from kimeu_workshop_records")) {
      // K-Star evidence lookup for one clinician email.
      const [workshopId, email] = values;
      return state.records
        .filter(r => r.workshop_id === workshopId && (r.pt_email ?? "").toLowerCase() === email)
        .map(r => ({ performed: r.k_performed ?? null, stars: r.k_stars ?? null }));
    }
    if (text.includes("from kimeu_clinician_notes")) {
      return state.notes
        .filter(n => n.workshop_id === values[0])
        .map(n => ({ id: n.id, created: n.created, author: n.author, note: n.note, review_id: n.review_id, visibility: n.visibility, pt_email: n.pt_email }));
    }
    throw new Error(`Unexpected SQL: ${text}`);
  };
  sql.begin = async (fn) => {
    state.beginCount += 1;
    return fn(sql);
  };
  return { sql, state };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`);
    return true;
  });
}

test("assigned RD pass writes the course row and audit note atomically (advanced)", async () => {
  const today = todayInAppTimeZone();
  const sessionDate = shift(today, -3);
  const { sql, state } = createFakeSql({
    workshops: [{ workshop_id: "ADV-1", stage: "Advanced" }],
    records: [{
      workshop_id: "ADV-1", person_id: "p1", pt_email: "pt@example.com", pt_name: "Pat Clinician",
      rd: "RD Example", session_date: sessionDate, attended: "Yes",
    }],
  });
  setSql(sql);

  const workspace = await getPracticals(RD, "ADV-1");
  assert.equal(workspace.canSignOff, true);
  assert.equal(workspace.records.length, 1);
  const { recordKey, revision } = workspace.records[0];
  assert.equal(recordKey, hash(["ADV-1", "pt@example.com", sessionDate]));

  const result = await savePractical(RD, "ADV-1", {
    recordKey, revision, result: "Pass", practicalDate: today, notes: "",
  });

  assert.equal(state.beginCount, 1, "sign-off must run inside one advisory-lock transaction");
  const row = state.records[0];
  assert.equal(row.practical_result, "Pass");
  assert.equal(row.practical_date, today);
  assert.equal(row.scored_by, "RD Example");
  assert.equal(row.last_updated_by, "RD Example");
  assert.equal(state.notes.length, 1);
  const note = state.notes[0];
  assert.equal(note.review_id.startsWith(`RD:${recordKey}:`), true);
  assert.equal(note.note_type, "Practical feedback");
  assert.match(note.note, new RegExp(`^Passed — ${today}`));
  assert.equal(note.author, "RD Example");
  assert.equal(note.author_role, "RD");
  assert.equal(note.follow_up, false);
  assert.equal(result.records[0].result, "Pass");
  assert.equal(result.records[0].scoredBy, "RD Example");
  assert.equal(result.records[0].history.length, 1);
});

test("assigned RD fail on a foundations block writes the block row and audit note atomically", async () => {
  const today = todayInAppTimeZone();
  const sessionDate = shift(today, -3);
  const { sql, state } = createFakeSql({
    workshops: [{ workshop_id: "F-1", stage: "Foundations" }],
    blocks: [{
      workshop_id: "F-1", person_id: "p9", block_index: 2, pt_email: "pt@example.com",
      pt_name: "Pat Clinician", rd: "RD Example", session_date: sessionDate, attended: "Yes",
    }],
  });
  setSql(sql);

  const workspace = await getPracticals(RD, "F-1");
  assert.equal(workspace.records.length, 1);
  const { recordKey, revision } = workspace.records[0];

  const result = await savePractical(RD, "F-1", {
    recordKey, revision, result: "Fail", practicalDate: today, notes: "Repeat the technique safely.",
  });

  assert.equal(state.beginCount, 1);
  const block = state.blocks[0];
  assert.equal(block.practical_result, "Fail");
  assert.equal(block.practical_date, today);
  assert.equal(block.last_updated_by, "RD Example");
  assert.equal(state.notes.length, 1);
  assert.match(state.notes[0].note, /^Not passed — /);
  assert.match(state.notes[0].note, /Repeat the technique safely\./);
  assert.equal(state.notes[0].follow_up, true);
  assert.equal(result.records[0].result, "Fail");
});

test("stale revision is rejected with PRACTICAL_CHANGED and writes nothing", async () => {
  const today = todayInAppTimeZone();
  const sessionDate = shift(today, -3);
  const { sql, state } = createFakeSql({
    workshops: [{ workshop_id: "ADV-1", stage: "Advanced" }],
    records: [{
      workshop_id: "ADV-1", person_id: "p1", pt_email: "pt@example.com", pt_name: "Pat",
      rd: "RD Example", session_date: sessionDate, attended: "Yes",
    }],
  });
  setSql(sql);
  const workspace = await getPracticals(RD, "ADV-1");
  const { recordKey } = workspace.records[0];

  await expectCode(savePractical(RD, "ADV-1", {
    recordKey, revision: "stale-revision", result: "Pass", practicalDate: today, notes: "",
  }), "PRACTICAL_CHANGED");
  assert.equal(state.records[0].practical_result, "");
  assert.equal(state.notes.length, 0);
});

test("unassigned RD and non-RD/Admin roles are denied", async () => {
  const today = todayInAppTimeZone();
  const sessionDate = shift(today, -3);
  const { sql, state } = createFakeSql({
    workshops: [{ workshop_id: "ADV-1", stage: "Advanced" }],
    records: [{
      workshop_id: "ADV-1", person_id: "p1", pt_email: "pt@example.com", pt_name: "Pat",
      rd: "Other RD", session_date: sessionDate, attended: "Yes",
    }],
  });
  setSql(sql);

  // RD not named on the record: the record is hidden from their workspace...
  const workspace = await getPracticals(RD, "ADV-1");
  assert.equal(workspace.records.length, 0);
  // ...and a forged recordKey cannot reach it either.
  const recordKey = hash(["ADV-1", "pt@example.com", sessionDate]);
  await expectCode(savePractical(RD, "ADV-1", {
    recordKey, revision: "any", result: "Pass", practicalDate: today, notes: "",
  }), "PRACTICAL_NOT_ASSIGNED");

  // Admin can still sign off any eligible clinician.
  const adminView = await getPracticals(ADMIN, "ADV-1");
  assert.equal(adminView.records.length, 1);

  // SME Assist has no sign-off privilege at all.
  await expectCode(savePractical(SME, "ADV-1", {
    recordKey, revision: "any", result: "Pass", practicalDate: today, notes: "",
  }), "ROLE_NOT_ALLOWED");
  assert.equal(state.records[0].practical_result, "");
});

test("K-Star merge keeps the maximum stars across multiple evidence records", async () => {
  const today = todayInAppTimeZone();
  const sessionOne = shift(today, -10);
  const sessionTwo = shift(today, -3);
  const { sql, state } = createFakeSql({
    workshops: [{ workshop_id: "FW-KB", stage: "Fellowship" }],
    records: [
      { workshop_id: "FW-KB", person_id: "p1", pt_email: "pt@example.com", pt_name: "Pat",
        rd: "RD Example", session_date: sessionOne, attended: "Yes",
        k_performed: true, k_stars: 3 },
      { workshop_id: "FW-KB", person_id: "p1", pt_email: "pt@example.com", pt_name: "Pat",
        rd: "RD Example", session_date: sessionTwo, attended: "Yes",
        k_performed: true, k_stars: 2 },
    ],
  });
  setSql(sql);

  const workspace = await getPracticals(RD, "FW-KB");
  assert.equal(workspace.records.length, 2);
  const target = workspace.records.find(r => r.sessionDate === sessionTwo);
  assert.equal(target.kStarPerformed, true);
  assert.equal(target.kStarStars, 2);
  assert.equal(target.kStarHighestEarned, 3);

  // Submitting a lower result must retain the higher earned level.
  const result = await savePractical(RD, "FW-KB", {
    recordKey: target.recordKey, revision: target.revision,
    result: "Pass", practicalDate: today, notes: "",
    kStarPerformed: true, kStarStars: 1,
  });
  const updated = state.records.find(r => r.session_date === sessionTwo);
  assert.equal(updated.k_performed, true);
  assert.equal(updated.k_stars, 3, "merge retains max stars across all session evidence");
  const saved = result.records.find(r => r.recordKey === target.recordKey);
  assert.equal(saved.kStarStars, 3);
  assert.match(state.notes.at(-1).note, /K-Star submitted: performed=true, stars=1; retained: performed=true, stars=3\./);

  // An unchecked submission likewise cannot erase earned stars.
  const second = await getPracticals(RD, "FW-KB");
  const targetTwo = second.records.find(r => r.sessionDate === sessionTwo);
  const resultTwo = await savePractical(RD, "FW-KB", {
    recordKey: targetTwo.recordKey, revision: targetTwo.revision,
    result: "Pass", practicalDate: today, notes: "",
    kStarPerformed: false, kStarStars: null,
  });
  assert.equal(state.records.find(r => r.session_date === sessionTwo).k_stars, 3);
  assert.equal(resultTwo.records.find(r => r.recordKey === target.recordKey).kStarStars, 3);
});

test("scheduling validates the 14-day window, records a note, and clears", async () => {
  const today = todayInAppTimeZone();
  const sessionDate = shift(today, -3);
  const { sql, state } = createFakeSql({
    workshops: [{ workshop_id: "ADV-1", stage: "Advanced" }],
    records: [{
      workshop_id: "ADV-1", person_id: "p1", pt_email: "pt@example.com", pt_name: "Pat",
      rd: "RD Example", session_date: sessionDate, attended: "Yes",
    }],
  });
  setSql(sql);

  const workspace = await getPracticals(RD, "ADV-1");
  const { recordKey, revision } = workspace.records[0];

  // Beyond session + 14 days: rejected.
  await expectCode(savePracticalSchedule(RD, "ADV-1", {
    recordKey, revision, scheduledDate: shift(sessionDate, 15),
  }), "INVALID_PRACTICAL_SCHEDULE");
  // Before today: rejected.
  await expectCode(savePracticalSchedule(RD, "ADV-1", {
    recordKey, revision, scheduledDate: shift(today, -1),
  }), "INVALID_PRACTICAL_SCHEDULE");
  assert.equal(state.notes.length, 0);

  // Within the window and not in the past: accepted with an audit note.
  const scheduled = shift(today, 2);
  const scheduled_result = await savePracticalSchedule(RD, "ADV-1", { recordKey, revision, scheduledDate: scheduled });
  assert.equal(state.notes.length, 1);
  assert.equal(state.notes[0].note, `Practical scheduled: ${scheduled}.`);
  assert.equal(state.notes[0].review_id.startsWith(`RD:${recordKey}:SCHEDULE:`), true);
  assert.equal(scheduled_result.records[0].scheduledDate, scheduled);

  // Clearing keeps the audit trail and removes the scheduled date.
  const current = scheduled_result.records[0];
  const cleared = await savePracticalSchedule(RD, "ADV-1", {
    recordKey, revision: current.revision, scheduledDate: null,
  });
  assert.equal(state.notes.length, 2);
  assert.equal(state.notes[1].note, "Practical schedule cleared.");
  assert.equal(cleared.records[0].scheduledDate, null);
  assert.equal(cleared.records[0].history.length, 2);
});

test("attendance is required before sign-off", async () => {
  const today = todayInAppTimeZone();
  const sessionDate = shift(today, -3);
  const { sql } = createFakeSql({
    workshops: [{ workshop_id: "ADV-1", stage: "Advanced" }],
    records: [{
      workshop_id: "ADV-1", person_id: "p1", pt_email: "pt@example.com", pt_name: "Pat",
      rd: "RD Example", session_date: sessionDate, attended: "No",
    }],
  });
  setSql(sql);
  const workspace = await getPracticals(RD, "ADV-1");
  const { recordKey, revision } = workspace.records[0];
  await expectCode(savePractical(RD, "ADV-1", {
    recordKey, revision, result: "Pass", practicalDate: today, notes: "",
  }), "ATTENDANCE_REQUIRED");
});

test("unsupported stages report no sign-off capability", async () => {
  const { sql } = createFakeSql({
    workshops: [{ workshop_id: "ADV-1", stage: "Onboarding Webinar" }],
  });
  setSql(sql);
  const workspace = await getPracticals(ADMIN, "ADV-1");
  assert.equal(workspace.canSignOff, false);
  assert.equal(workspace.records.length, 0);
});

process.on("exit", () => {
  rm(directory, { recursive: true, force: true }).catch(() => {});
});
