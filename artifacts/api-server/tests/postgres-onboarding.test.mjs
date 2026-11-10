import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const temp = await mkdtemp(join(tmpdir(), "pg-onboarding-"));
await build({
  stdin: {
    contents: "export { getOnboarding, saveOnboarding } from './src/lib/kimeu/onboarding'; export { setSql } from './src/lib/kimeu/db/client';",
    resolveDir: new URL("../", import.meta.url).pathname,
    loader: "ts",
  },
  outfile: join(temp, "module.mjs"), bundle: true, platform: "node", format: "esm",
  plugins: [{ name: "isolated-provider", setup(b) {
    b.onResolve({ filter: /^(postgres|@replit\/connectors-sdk|@clerk\/express)$/ }, ({ path }) => ({ path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
      contents: path === "postgres"
        ? "export default function postgres(){ throw new Error('live DB connections are not allowed in tests') }"
        : path === "@clerk/express"
          ? "export const clerkClient={};export const getAuth=()=>({});"
          : "export class ReplitConnectors {proxy(){ throw new Error('sheets transport is disabled in postgres-mode tests') }}",
    }));
  } }],
});
process.env.KIMEU_DATA_SOURCE = "postgres";
const { getOnboarding, saveOnboarding, setSql } = await import(pathToFileURL(join(temp, "module.mjs")).href);

// --- Stateful fake of the canonical tables --------------------------------
const db = {
  roster: [
    { person_id: "p1", roster_email: "pt1@fixture.test", canonical_email: "pt1@fixture.test", full_name: "Assigned PT", identity_state: "linked" },
    { person_id: "p2", roster_email: "pt2@fixture.test", canonical_email: "pt2@fixture.test", full_name: "Other PT", identity_state: "linked" },
    { person_id: "p3", roster_email: "former@fixture.test", canonical_email: "former@fixture.test", full_name: "Former PT", identity_state: "inactive_person" },
  ],
  foundations: [
    { person_id: "p1", rd: "rd@fixture.test" },
    { person_id: "p2", rd: "other-rd@fixture.test" },
  ],
  onboarding: [],
  notes: [],
};
const sqlCalls = [];
async function sql(strings, ...values) {
  const text = strings.join("?");
  sqlCalls.push(text);
  if (/pg_advisory_xact_lock/i.test(text)) return [];
  if (/insert into kimeu_clinician_notes/i.test(text)) {
    // Bound params only; 'General', 'Aaron + author', 'sme_app' are SQL literals.
    const [note_id, person_id, created, pt_email, workshop_id, review_id, note, author, author_role] = values;
    db.notes.push({ note_id, person_id, created, pt_email, note_type: "General", workshop_id, review_id,
      note, author, author_role, visibility: "Aaron + author" });
    return [];
  }
  if (/insert into kimeu_rd_onboarding/i.test(text)) {
    const [record_id, person_id, pt_email, workshop_id, week, session_date, minutes,
      attended, rd_result, signed_by, signed_at, notes, last_updated_by, last_updated] = values;
    const existing = db.onboarding.findIndex(r => r.record_id === record_id);
    const row = { record_id, person_id, pt_email, workshop_id, week, session_date, minutes,
      attended, rd_result, signed_by, signed_at: signed_at ? String(signed_at) : null, notes,
      last_updated_by, last_updated: String(last_updated), completed_weeks: null, course_status: null };
    if (existing >= 0) db.onboarding[existing] = row; else db.onboarding.push(row);
    return [];
  }
  if (/from kimeu_rd_onboarding/i.test(text)) {
    if (/where record_id/i.test(text)) return db.onboarding.filter(r => r.record_id === values[0]);
    return db.onboarding.filter(r => r.workshop_id === values[0]).sort((a, b) => a.week - b.week);
  }
  if (/from v_kimeu_sme_roster/i.test(text)) {
    return db.roster
      .filter(r => r.identity_state === "linked")
      .map(r => ({
        person_id: r.person_id,
        email: r.canonical_email || r.roster_email,
        name: r.full_name,
        assigned_rd: db.foundations.find(f => f.person_id === r.person_id)?.rd ?? null,
      }));
  }
  throw new Error(`Unmocked query: ${text}`);
}
sql.begin = async (fn) => fn(sql);
setSql(sql);

const rd = { email: "rd@fixture.test", nameInSheets: "Fixture RD", roles: ["RD"], workshopIds: [], active: true };
const admin = { email: "admin@fixture.test", nameInSheets: "Fixture Admin", roles: ["Admin"], workshopIds: [], active: true };

test("the RD sees only their assigned active PTs; admins see all", async () => {
  const ws = await getOnboarding(rd, "F-12");
  assert.equal(ws.requiredWeeks, 4);
  assert.deepEqual(ws.people.map(p => p.email), ["pt1@fixture.test"]);
  assert.equal(ws.people[0].units.length, 4);
  const adminWs = await getOnboarding(admin, "F-12");
  assert.deepEqual(adminWs.people.map(p => p.email), ["pt1@fixture.test", "pt2@fixture.test"]);
});

test("saves a week sign-off with readback; re-saving the same week upserts in place", async () => {
  const ws = await getOnboarding(rd, "F-12");
  const person = ws.people[0];
  const res = await saveOnboarding(rd, "F-12", { email: person.email, revision: person.revision,
    week: 1, date: "2026-10-05", attended: true, result: "Pass", notes: "" });
  assert.equal(db.onboarding.length, 1);
  assert.equal(db.onboarding[0].record_id, "F-12:pt1@fixture.test:W1");
  assert.equal(db.onboarding[0].minutes, 60);
  assert.equal(db.notes.length, 1);
  const unit = res.people[0].units.find(u => u.week === 1);
  assert.equal(unit.date, "2026-10-05");
  assert.equal(unit.attended, true);
  assert.equal(unit.result, "Pass");

  const ws2 = await getOnboarding(rd, "F-12");
  await saveOnboarding(rd, "F-12", { email: person.email, revision: ws2.people[0].revision,
    week: 1, date: "2026-10-05", attended: true, result: "Fail", notes: "Needs work on case review." });
  assert.equal(db.onboarding.length, 1); // upsert by record_id, not a duplicate row
  assert.equal(db.onboarding[0].rd_result, "Fail");
  assert.equal(db.notes.length, 2); // every save still appends its audit note
});

test("F-12 weeks must fall in distinct chronological calendar weeks", async () => {
  const ws = await getOnboarding(rd, "F-12");
  const person = ws.people[0];
  await saveOnboarding(rd, "F-12", { email: person.email, revision: person.revision,
    week: 1, date: "2026-10-05", attended: true, result: "Pass", notes: "" });
  const ws2 = await getOnboarding(rd, "F-12");
  await assert.rejects(
    () => saveOnboarding(rd, "F-12", { email: person.email, revision: ws2.people[0].revision,
      week: 2, date: "2026-10-07", attended: true, result: "Pass", notes: "" }),
    err => err.code === "WEEKS_MUST_BE_DISTINCT",
  );
  // Out-of-order week dates are rejected too.
  await assert.rejects(
    () => saveOnboarding(rd, "F-12", { email: person.email, revision: ws2.people[0].revision,
      week: 2, date: "2026-09-28", attended: true, result: "Pass", notes: "" }),
    err => err.code === "WEEKS_MUST_BE_DISTINCT",
  );
  // A later, distinct calendar week succeeds.
  await saveOnboarding(rd, "F-12", { email: person.email, revision: ws2.people[0].revision,
    week: 2, date: "2026-10-19", attended: true, result: "Pass", notes: "" });
  assert.equal(db.onboarding.length, 2);
});

test("attendance-only courses reject a practical result (EN-CAD)", async () => {
  const ws = await getOnboarding(rd, "EN-CAD");
  assert.equal(ws.requiredWeeks, 1);
  const person = ws.people[0];
  await assert.rejects(
    () => saveOnboarding(rd, "EN-CAD", { email: person.email, revision: person.revision,
      week: 1, date: "2026-10-05", attended: true, result: "Pass", notes: "" }),
    err => err.code === "ATTENDANCE_ONLY",
  );
  // Attendance-only sign-off without a result is accepted.
  await saveOnboarding(rd, "EN-CAD", { email: person.email, revision: person.revision,
    week: 1, date: "2026-10-05", attended: true, result: "", notes: "" });
  assert.equal(db.onboarding.some(r => r.record_id === "EN-CAD:pt1@fixture.test:W1"), true);
});

test("users without the RD role are blocked", async () => {
  const outsider = { email: "sme@fixture.test", nameInSheets: "Fixture SME", roles: ["SME Lead"], workshopIds: [], active: true };
  await assert.rejects(() => getOnboarding(outsider, "F-12"), err => err.code === "ROLE_NOT_ALLOWED");
  await assert.rejects(
    () => saveOnboarding(outsider, "F-12", { email: "pt1@fixture.test", revision: "x",
      week: 1, date: "2026-10-05", attended: true, result: "Pass", notes: "" }),
    err => err.code === "ROLE_NOT_ALLOWED",
  );
});

test("a PT not assigned to the RD cannot be signed off", async () => {
  await assert.rejects(
    () => saveOnboarding(rd, "F-12", { email: "pt2@fixture.test", revision: "x",
      week: 1, date: "2026-10-05", attended: true, result: "Pass", notes: "" }),
    err => err.code === "PT_NOT_ASSIGNED",
  );
});

test("a stale revision is rejected with ONBOARDING_CHANGED", async () => {
  const ws = await getOnboarding(rd, "F-12");
  const person = ws.people[0];
  await assert.rejects(
    () => saveOnboarding(rd, "F-12", { email: person.email, revision: "bogus",
      week: 3, date: "2026-10-26", attended: true, result: "Pass", notes: "" }),
    err => err.code === "ONBOARDING_CHANGED",
  );
});

test("unknown onboarding courses are rejected", async () => {
  await assert.rejects(() => getOnboarding(rd, "NOPE-1"), err => err.code === "ONBOARDING_NOT_FOUND");
});
