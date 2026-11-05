import assert from "node:assert/strict";
import { after, test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const temp = await mkdtemp(join(tmpdir(), "kimeu-cutover-"));
await build({
  stdin: {
    contents: `
      export {findActiveAppUser} from './src/lib/kimeu/access';
      export {getCourses} from './src/lib/kimeu/courses';
      export {readCourseDirectory} from './src/lib/kimeu/course-directory';
      export {getCourseTracking,saveCourseTracking} from './src/lib/kimeu/course-tracking';
      export {getFoundationsAssessment,saveFoundationsAssessment} from './src/lib/kimeu/foundations-assessment';
      export {getSmeAssignments,saveSmeAssignment} from './src/lib/kimeu/sme-assignments';
      export {appendClinicianNote} from './src/lib/kimeu/db/notes';
      export {getReadiness} from './src/lib/kimeu/db/readiness';
      export {setSql} from './src/lib/kimeu/db/client';`,
    resolveDir: new URL("../", import.meta.url).pathname, loader: "ts",
  },
  bundle: true, platform: "node", format: "esm", outfile: join(temp, "module.mjs"),
  plugins: [{ name: "no-live-providers", setup(b) {
    b.onResolve({ filter: /^(postgres|@replit\/connectors-sdk|@clerk\/express)$/ }, ({ path }) => ({ path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
      contents: path === "postgres"
        ? "export default function postgres(){throw new Error('Real DB access prohibited in unit tests')}"
        : path === "@clerk/express"
          ? "export const clerkClient={};export const getAuth=()=>({});"
          : "export class ReplitConnectors{proxy(){throw new Error('Sheets access prohibited in postgres tests')}}",
    }));
  } }],
});
process.env.KIMEU_DATA_SOURCE = "postgres";
const api = await import(pathToFileURL(join(temp, "module.mjs")).href);
const p1 = "00000000-0000-4000-8000-000000000001", p2 = "00000000-0000-4000-8000-000000000002";
const blockId = "00000000-0000-4000-8000-000000000003";
const admin = { email: "admin@kimeperformance.com", nameInSheets: "Fixture Admin", active: true, roles: ["Admin"], workshopIds: [] };
const rd = { email: "rd@kimeperformance.com", nameInSheets: "Fixture RD", active: true, roles: ["RD"], workshopIds: ["F-UE-G", "A-KB"] };
const date = "2026-01-08";
let db;
const captured = [];
const clone = v => JSON.parse(JSON.stringify(v));
function reset() {
  db = {
    roster: [
      { person_id: p1, email: "pt1@fixture.test", name: "Fixture PT One", assigned_rd: rd.email },
      { person_id: p2, email: "pt2@fixture.test", name: "Fixture PT Two", assigned_rd: "other@fixture.test" },
    ],
    courses: [
      { workshop_id: "F-UE-G", workshop_name: "UE Late Stage", stage: "Foundations", region_topic: null, lead_sme: null },
      { workshop_id: "A-KB", workshop_name: "KB Resilience", stage: "Fellowship", region_topic: null, lead_sme: null },
    ],
    staff: [{ email: admin.email, name_in_sheets: admin.nameInSheets, active: true, app_roles: "Admin, RD", workshop_ids: "F-UE-G" }],
    foundations: [{ person_id: p1, exam_result: null, rd: rd.email }, { person_id: p2, exam_result: "", rd: "other@fixture.test" }],
    blocks: [{ key: blockId, person_id: p1, block_index: 1, session_date: null, attended: false, practical_result: "Pass", percent: 0, status: null }],
    records: [], sessions: [], notes: [], noteDueAllowed: true, breakReadback: false,
  };
  api.setSql(sql);
}
async function sql(strings, ...values) {
  const text = strings.join("?");
  captured.push({ text, values });
  if (/pg_advisory_xact_lock/.test(text)) return [];
  if (/has_column_privilege/.test(text)) return /as name/.test(text)
    ? [{ name: "kimeu_clinician_notes.visibility (SELECT)", allowed: true },
       { name: "kimeu_clinician_notes.follow_up_due (INSERT)", allowed: db.noteDueAllowed }]
    : [{ allowed: db.noteDueAllowed }];
  if (/from person p/.test(text)) return clone(db.roster);
  if (/select .*from kimeu_app_users/s.test(text) || /select email, name_in_sheets/.test(text)) {
    return clone(/where lower/.test(text) ? db.staff.filter(s => s.email === values[0]) : db.staff);
  }
  if (/from kimeu_workshops/.test(text)) return clone(db.courses);
  if (/select distinct block_index/.test(text)) return [{ block_index: 1 }];
  if (/from kimeu_foundations_blocks b/.test(text)) return clone(db.blocks);
  if (/select person_id, exam_result, rd/.test(text)) return clone(db.foundations);
  if (/from kimeu_workshop_records/.test(text) && /select/.test(text)) {
    return clone(db.records.filter(r => r.workshop_id === values[0] && r.session_date === values[1]));
  }
  if (/select session_id, session_status/.test(text)) return clone(db.sessions.filter(s => s.session_id === values[0]));
  if (/insert into kimeu_sessions/.test(text)) {
    if (!db.sessions.some(s => s.session_id === values[0])) db.sessions.push({ session_id: values[0], workshop_id: values[1], session_date: values[2], session_status: "Live" });
    return [];
  }
  if (/update kimeu_sessions/.test(text)) {
    const s = db.sessions.find(s => s.session_id === values[1]);
    if (!s || ["Cancelled", "Complete"].includes(s.session_status)) return [];
    s.session_status = "Live"; return [{ session_id: s.session_id }];
  }
  if (/update kimeu_foundations_blocks/.test(text)) {
    const row = db.blocks.find(r => r.key === values[3]);
    if (!row) return [];
    row.session_date = values[0]; row.attended = db.breakReadback ? !values[1] : values[1];
    return [{ block_id: row.key }];
  }
  if (/insert into kimeu_foundations_blocks/.test(text)) {
    db.blocks.push({ key: p2, person_id: values[0], block_index: values[2], session_date: values[3], attended: values[4], practical_result: null, percent: null });
    return [];
  }
  if (/insert into kimeu_workshop_records/.test(text)) {
    db.records.push({ key: values[0], person_id: values[1], workshop_id: values[4], session_date: values[5], attended: values[6], practical_result: null, percent: null, status: null });
    return [];
  }
  if (/update kimeu_workshop_records/.test(text)) {
    const row = db.records.find(r => r.key === values[3]);
    if (!row) return [];
    row.attended = values[0]; return [{ record_id: row.key }];
  }
  if (/update kimeu_foundations_pt/.test(text)) {
    const row = db.foundations.find(r => r.person_id === values[1] && r.exam_result === values[2]);
    if (!row) return [];
    row.exam_result = values[0]; return [{ person_id: row.person_id }];
  }
  if (/update kimeu_app_users/.test(text)) {
    const s = db.staff.find(s => s.email === values[2] && s.app_roles === values[3] && s.workshop_ids === values[4]);
    if (!s) return [];
    s.app_roles = values[0]; s.workshop_ids = values[1]; return [{ email: s.email }];
  }
  if (/insert into kimeu_clinician_notes/.test(text)) {
    if (/follow_up_needed/.test(text)) {
      db.notes.push({ note_id: values[0], note: values[6], visibility: values.at(-1) });
    } else db.notes.push({ note_id: values[0], note: values[6], visibility: "Aaron + author" });
    return [];
  }
  if (/select note_id, note, visibility/.test(text)) return clone(db.notes.filter(n => n.note_id === values[0]));
  throw new Error("Unhandled fixture SQL: " + text);
}
sql.begin = async fn => {
  const before = clone(db);
  try { return await fn(sql); } catch (e) { db = before; throw e; }
};
const mark = (workspace, email, checked) => ({
  sessionDate: date, revision: workspace.revision, kind: "attendance", marks: [{ email, checked }],
});

test("postgres staff, catalog and directory never call Sheets", async () => {
  reset();
  assert.equal((await api.findActiveAppUser(admin.email)).active, true);
  assert.equal((await api.getCourses(admin)).courses.length, 4);
  assert.ok((await api.getCourses(admin)).courses.some(c => c.workshopId === "F-11"));
  assert.equal((await api.readCourseDirectory()).people.length, 2);
  db.staff[0].active = false;
  assert.equal(await api.findActiveAppUser(admin.email), null);
});
test("duplicate staff and PT identities fail closed", async () => {
  reset(); db.staff.push(clone(db.staff[0]));
  await assert.rejects(api.findActiveAppUser(admin.email), e => e.code === "APP_USER_DUPLICATE");
  reset(); db.roster.push(clone(db.roster[0]));
  await assert.rejects(api.readCourseDirectory(), e => e.code === "ROSTER_DUPLICATE");
});
test("readiness identifies postgres and reports optional due-date access without claiming Sheets readiness", async () => {
  reset(); process.env.KIMEU_TRUTH_DATABASE_URL = "postgres://fixture/unused";
  db.noteDueAllowed = false;
  const readiness = await api.getReadiness();
  assert.equal(readiness.trackingMode, "postgres");
  assert.equal(readiness.writeEnabled, true);
  assert.equal(readiness.notePrivacyReady, true);
  assert.ok(readiness.missing[0].includes("Follow-up due dates"));
  delete process.env.KIMEU_TRUTH_DATABASE_URL;
});
test("attendance preserves practical evidence; zero Kajabi does not prevent workshop completion", async () => {
  reset();
  const state = await api.getCourseTracking(admin, "F-UE-G", date);
  const result = await api.saveCourseTracking(admin, "F-UE-G", mark(state, "pt1@fixture.test", true));
  assert.equal(result.savedCount, 1);
  assert.equal(result.people[0].sheetStatus, "Complete");
  assert.equal(db.blocks[0].practical_result, "Pass");
  assert.equal(db.blocks[0].percent, 0);
  assert.equal(db.sessions.length, 1);
});
test("attendance creates only selected enrollment and preserves unrelated evidence on edits", async () => {
  reset();
  let state = await api.getCourseTracking(admin, "A-KB", date);
  state = await api.saveCourseTracking(admin, "A-KB", mark(state, "pt1@fixture.test", true));
  assert.equal(db.records.length, 1);
  db.records[0].practical_result = "Pass"; db.records[0].k_stars = 4;
  await api.saveCourseTracking(admin, "A-KB", mark(state, "pt1@fixture.test", false));
  assert.equal(db.records[0].attended, false);
  assert.equal(db.records[0].practical_result, "Pass");
  assert.equal(db.records[0].k_stars, 4);
});
test("new Foundations enrollment uses canonical course block index", async () => {
  reset();
  const state = await api.getCourseTracking(admin, "F-UE-G", date);
  await api.saveCourseTracking(admin, "F-UE-G", mark(state, "pt2@fixture.test", true));
  assert.equal(db.blocks[1].block_index, 1);
});
test("stale revisions, removed PTs and historical date conflicts cannot overwrite attendance", async () => {
  reset();
  let state = await api.getCourseTracking(admin, "F-UE-G", date);
  await assert.rejects(api.saveCourseTracking(admin, "F-UE-G", { ...mark(state, "pt1@fixture.test", true), revision: "stale" }), e => e.code === "TRACKING_CHANGED");
  db.roster = db.roster.slice(1);
  state = await api.getCourseTracking(admin, "F-UE-G", date);
  await assert.rejects(api.saveCourseTracking(admin, "F-UE-G", mark(state, "pt1@fixture.test", true)), e => e.code === "PT_NOT_AVAILABLE");
  reset(); db.blocks[0].session_date = "2025-01-01";
  state = await api.getCourseTracking(admin, "F-UE-G", date);
  await assert.rejects(api.saveCourseTracking(admin, "F-UE-G", mark(state, "pt1@fixture.test", true)), e => e.code === "FOUNDATIONS_DATE_CONFLICT");
});
test("future sessions and unauthorized roles cannot save attendance", async () => {
  reset();
  await assert.rejects(api.saveCourseTracking(rd, "F-UE-G", { sessionDate: date, revision: "", kind: "attendance", marks: [] }), e => e.code === "ROLE_NOT_ALLOWED");
  const state = await api.getCourseTracking(admin, "F-UE-G", "2099-01-01");
  await assert.rejects(api.saveCourseTracking(admin, "F-UE-G", { sessionDate: "2099-01-01", revision: state.revision, kind: "attendance", marks: [] }), e => e.code === "ATTENDANCE_READ_ONLY");
});
test("closed sessions and duplicate marks reject without partial enrollment", async () => {
  reset();
  let state = await api.getCourseTracking(admin, "F-UE-G", date);
  const input = mark(state, "pt1@fixture.test", true);
  await assert.rejects(api.saveCourseTracking(admin, "F-UE-G", { ...input, marks: [...input.marks, ...input.marks] }), e => e.code === "DUPLICATE_MARK");
  assert.equal(db.sessions.length, 0);
  await api.saveCourseTracking(admin, "F-UE-G", input);
  db.sessions[0].session_status = "Complete";
  state = await api.getCourseTracking(admin, "F-UE-G", date);
  await assert.rejects(api.saveCourseTracking(admin, "F-UE-G", mark(state, "pt1@fixture.test", false)), e => e.code === "ATTENDANCE_READ_ONLY");
  assert.equal(db.blocks[0].attended, true);
});
test("failed attendance confirmation rolls session and marks back together", async () => {
  reset();
  const state = await api.getCourseTracking(admin, "F-UE-G", date);
  db.breakReadback = true;
  await assert.rejects(api.saveCourseTracking(admin, "F-UE-G", mark(state, "pt1@fixture.test", true)), e => e.code === "TRACKING_READBACK_FAILED");
  assert.equal(db.sessions.length, 0); assert.equal(db.blocks[0].attended, false);
});
test("assessment enforces RD assignment and supports null AND empty historical results", async () => {
  reset();
  assert.equal((await api.getFoundationsAssessment(rd)).people.length, 1);
  let state = await api.getFoundationsAssessment(rd);
  await api.saveFoundationsAssessment(rd, { email: state.people[0].email, revision: state.people[0].revision, result: "Pass" });
  assert.equal(db.foundations[0].exam_result, "Pass"); assert.equal(db.notes.length, 1);
  state = await api.getFoundationsAssessment(admin);
  const other = state.people[1];
  await api.saveFoundationsAssessment(admin, { email: other.email, revision: other.revision, result: "Fail" });
  assert.equal(db.foundations[1].exam_result, "Fail");
  await assert.rejects(api.saveFoundationsAssessment(rd, { email: other.email, revision: other.revision, result: "Pass" }), e => e.code === "PT_NOT_ASSIGNED");
});
test("stale assessment revision cannot change result or append audit", async () => {
  reset();
  await assert.rejects(api.saveFoundationsAssessment(admin, { email: "pt1@fixture.test", revision: "stale", result: "Pass" }), e => e.code === "ASSESSMENT_CHANGED");
  assert.equal(db.foundations[0].exam_result, null); assert.equal(db.notes.length, 0);
});
test("SME assignment saves in DB, retains Admin/RD roles and audits", async () => {
  reset();
  const state = await api.getSmeAssignments(admin);
  const result = await api.saveSmeAssignment(admin, { email: admin.email, revision: state.revision, smeRoles: ["SME Assist"], workshopIds: ["F-UE-G"] });
  assert.deepEqual(result.staff[0].roles, ["Admin", "RD", "SME Assist"]);
  assert.equal(db.notes.length, 1);
  assert.ok((await api.findActiveAppUser(admin.email)).roles.includes("SME Assist"));
});
test("assignment writes reject RD callers, mismatched stages and stale state", async () => {
  reset(); const state = await api.getSmeAssignments(admin);
  const input = { email: admin.email, revision: state.revision, smeRoles: ["SME Assist"], workshopIds: ["A-KB"] };
  await assert.rejects(api.saveSmeAssignment(rd, input), e => e.code === "ROLE_NOT_ALLOWED");
  await assert.rejects(api.saveSmeAssignment(admin, input), e => e.code === "SME_ASSIGNMENT_MISMATCH");
  await assert.rejects(api.saveSmeAssignment(admin, { ...input, revision: "stale" }), e => e.code === "STAFF_CHANGED");
});
test("notes persist visibility; missing optional due-date grant never discards the requested date", async () => {
  reset();
  const input = { clinicianEmail: "pt1@fixture.test", workshopId: "A-KB", sessionId: "A-KB|2026-01-08", noteType: "General", note: "Fixture note", followUpNeeded: false, visibility: "Aaron + author" };
  const result = await api.appendClinicianNote(admin, "Admin", input);
  assert.equal(result.visibility, input.visibility);
  db.noteDueAllowed = false;
  await assert.rejects(api.appendClinicianNote(admin, "Admin", { ...input, followUpNeeded: true, followUpDue: new Date("2026-02-01T00:00:00Z") }), e => e.code === "NOTE_DUE_PERMISSION_REQUIRED");
  assert.equal(db.notes.length, 1);
  db.noteDueAllowed = true;
  await api.appendClinicianNote(admin, "Admin", { ...input, followUpNeeded: true, followUpDue: new Date("2026-02-01T00:00:00Z") });
  assert.equal(db.notes.length, 2);
});
after(async () => {
  // Optional fixture-only capture for EXPLAIN (never ANALYZE) checks against the
  // real schema. Contains synthetic values, not credentials or production data.
  if (process.env.KIMEU_CAPTURE_SQL_PATH) await writeFile(process.env.KIMEU_CAPTURE_SQL_PATH, JSON.stringify(captured));
});
