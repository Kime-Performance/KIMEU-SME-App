import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const directory = await mkdtemp(join(tmpdir(), "sme-auth-scope-"));
await build({
  stdin: { resolveDir: new URL("..", import.meta.url).pathname, loader: "ts", contents: `
    export {setSql} from "./src/lib/kimeu/db/client";
    export {getCourseTracking} from "./src/lib/kimeu/db/course-tracking";
    export {getOnboarding} from "./src/lib/kimeu/db/onboarding";
    export {getPracticals} from "./src/lib/kimeu/db/practicals";
    export {getFoundationsAssessment} from "./src/lib/kimeu/db/foundations-assessment";
    export {getFellowshipReviews} from "./src/lib/kimeu/db/fellowship-reviews";
    export {getSessionDetail,getToday} from "./src/lib/kimeu/db/sessions";
    export {createBusinessBoundary} from "./src/lib/kimeu/auth/business-boundary";
    export {ownPersonId} from "./src/lib/kimeu/auth/data-scope";
    export {appendAudit} from "./src/lib/kimeu/db/audit";
  ` },
  bundle: true, platform: "node", format: "esm", outfile: join(directory, "fixture.mjs"),
  plugins: [{ name: "forbid-live-io", setup(b) {
    b.onResolve({ filter: /^(postgres|@clerk\/express|@replit\/connectors-sdk)$/ }, ({ path }) => ({ path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
      contents: path === "postgres"
        ? "export default function(){throw new Error('Live SQL forbidden')}"
        : path === "@clerk/express" ? "export const clerkClient={};export const getAuth=()=>({});"
        : "export class ReplitConnectors {proxy(){throw new Error('Live Sheets forbidden')}}",
    }));
  } }],
});
process.env.KIMEU_DATA_SOURCE = "postgres";
const api = await import(pathToFileURL(join(directory, "fixture.mjs")).href);
const ownId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const date = "2026-01-01";
const person = id => ({
  person_id: id, personId: id, email: id === ownId ? "own@fixture.test" : "OTHER-PRIVATE@fixture.test",
  name: id === ownId ? "Own Person" : "OTHER-PRIVATE-NAME",
  full_name: id === ownId ? "Own Person" : "OTHER-PRIVATE-NAME", assigned_rd: "different-rd",
});
const identities = [person(ownId), person(otherId)];
const calls = [];
let excludeOwn = false;
const scoped = (text, values) => {
  // A fake result is narrowed only if the actual query has an owner predicate,
  // not merely because the test happens to know which participant is logged in.
  if (values.includes(ownId) && /person_id\s*=\s*\?::uuid/i.test(text)) {
    return excludeOwn ? [] : [identities[0]];
  }
  return identities;
};
async function sql(strings, ...values) {
  const text = strings.join("?");
  calls.push({ text, values });
  assert.doesNotMatch(text, /\b(insert|update|delete|truncate)\b/i, "read flows must not write");
  if (/from kimeu_workshops/i.test(text)) return [{
    workshop_id: "FW-UE", workshop_name: "UE Workshop", name: "UE Workshop", stage: "Foundations",
  }];
  if (/from kimeu_sessions/i.test(text)) return [{
    session_id: "own-session", workshop_id: "FW-UE", workshop_name: "UE Workshop",
    stage: "Foundations", session_date: date, session_status: "Live",
    session_notes: "OTHER-PRIVATE-GROUP-NOTE", changes_for_next_session: "OTHER-PRIVATE-GROUP-PLAN",
  }];
  if (/from person p/i.test(text)) return scoped(text, values);
  if (/from kimeu_foundations_blocks/i.test(text)) return scoped(text, values).map(p => ({
    ...p, key: p.person_id, block_index: 1, pt_email: p.email, pt_name: p.name,
    session_date: date, attended: true, practical_result: "Pass", practical_date: date,
    computed_status: "Complete", practical_status: "Pass", percent: 100,
  }));
  if (/from kimeu_foundations_pt/i.test(text)) return scoped(text, values).map(p => ({
    ...p, exam_result: "Pass", rd: "different-rd",
  }));
  if (/from kimeu_rd_onboarding/i.test(text)) return scoped(text, values).map(p => ({
    ...p, record_id: p.person_id, pt_email: p.email, workshop_id: "F-11", week: 1,
    session_date: date, minutes: 60, attended: true, rd_result: "Pass",
    notes: "OTHER-PRIVATE-STAFF-NOTE", completed_weeks: 1,
  }));
  if (/from kimeu_fellowship_reviews/i.test(text)) {
    const rows = values.includes(ownId) && /select lower\(email\) from person/i.test(text)
      ? [identities[0]] : identities;
    return rows.map(p => ({ review_id: p.person_id, pt_email: p.email, pt_name: p.name,
      review_date: date, result: "Pass", notes: "OTHER-PRIVATE-REVIEW-NOTE",
      specific_need: "OTHER-PRIVATE-STAFF-PLAN" }));
  }
  if (/from kimeu_clinician_notes/i.test(text)) {
    assert.ok(values.includes(ownId) || values.includes(null), "Notes need a scoped denial or staff predicate");
    assert.match(text, /and\s*\(\?::uuid is null\)/i);
    return [];
  }
  throw new Error(`Unexpected SQL in test: ${text}`);
}
sql.begin = action => action(sql);
sql.end = async () => {};
api.setSql(sql);
const user = (siteRole = "PT", roles = [siteRole]) => ({
  email: "not-the-person-record@fixture.test", nameInSheets: "Staff Actor", active: true,
  roles, workshopIds: [],
  authorization: { method: "GET", assignment: false, capability: "read", actor: {
    principal: { siteRole, authUserId: "auth-id", rosterEmail: "sync@fixture.test" },
    roles, personId: siteRole === "PT" ? ownId : null, workshopIds: [],
  } },
});

function assertPrivate(result) {
  assert.doesNotMatch(JSON.stringify(result), /OTHER-PRIVATE/);
}

test("PT actual tracking query narrows roster and records and disables attendance", async () => {
  calls.length = 0;
  const result = await api.getCourseTracking(user(), "FW-UE", date);
  assert.equal(result.people.length, 1);
  assert.equal(result.people[0].email, "own@fixture.test");
  assert.equal(result.canSaveAttendance, false);
  assertPrivate(result);
  assert.ok(calls.filter(c => /from person p|from kimeu_foundations_blocks/i.test(c.text))
    .every(c => c.values.includes(ownId)));
});

test("PT actual practical, assessment, onboarding and review readers expose only own records", async () => {
  const practical = await api.getPracticals(user(), "FW-UE");
  assert.equal(practical.records.length, 1);
  assert.equal(practical.canSignOff, false);
  assert.deepEqual(practical.records[0].history, []);
  const assessment = await api.getFoundationsAssessment(user());
  assert.equal(assessment.people.length, 1);
  const onboarding = await api.getOnboarding(user(), "F-11");
  assert.equal(onboarding.people.length, 1);
  assert.equal(onboarding.canSignOff, false);
  const reviews = await api.getFellowshipReviews(user());
  assert.equal(reviews.people.length, 1);
  assert.equal(reviews.reviews.length, 1);
  for (const result of [practical, assessment, onboarding, reviews]) assertPrivate(result);
});

test("PT session detail filters nested roster, recalculates counts, redacts group notes", async () => {
  const result = await api.getSessionDetail("own-session", false, user());
  assert.equal(result.roster.length, 1);
  assert.equal(result.session.rosterCount, 1);
  assert.equal(result.session.presentCount, 1);
  assert.equal(result.sessionNotes, "");
  assert.equal(result.changesForNextSession, "");
  // internalSession is never sent by the API; the public fields must be safe.
  const { internalSession, internalRoster, ...publicResult } = result;
  assertPrivate(publicResult);
});

test("PT detail for an unenrolled session is indistinguishable from a missing record", async () => {
  excludeOwn = true;
  try {
    await assert.rejects(api.getSessionDetail("other-session", false, user()),
      e => e.status === 404 && e.code === "RECORD_NOT_FOUND");
    const today = await api.getToday(user());
    assert.deepEqual(today.sessions, []);
    assert.equal(today.dueCount, 0);
  } finally { excludeOwn = false; }
});

test("RD reads and sign-off availability are org-wide without staff assignments or a region", async () => {
  const rd = user("RD", []);
  const practical = await api.getPracticals(rd, "FW-UE");
  assert.equal(practical.records.length, 2);
  assert.equal(practical.canSignOff, true);
  const onboarding = await api.getOnboarding(rd, "F-11");
  assert.equal(onboarding.people.length, 2);
  assert.equal(onboarding.canSignOff, true);
  const assessment = await api.getFoundationsAssessment(rd);
  assert.equal(assessment.people.length, 2);
});

test("PT person identity cannot be expanded by an accidental Admin assignment", () => {
  assert.equal(api.ownPersonId(user("PT", ["Admin"])), ownId);
  const broken = user();
  broken.authorization.actor.personId = null;
  assert.throws(() => api.ownPersonId(broken), e => e.code === "ACCOUNT_PENDING");
});

async function decision(method, path, siteRole, roles = [], enabled = true) {
  let resolved = 0;
  const boundary = api.createBusinessBoundary({
    enabled: () => enabled,
    actor: async () => { resolved++; return user(siteRole, roles).authorization.actor; },
  });
  let outcome;
  await boundary({ method, path }, {}, error => { outcome = error; });
  return { outcome, resolved };
}

test("mounted business boundary preserves Clerk default and denies unknown Supabase routes before identity IO", async () => {
  assert.equal((await decision("GET", "/kimeu/dev-readiness", "Admin", [], false)).resolved, 0);
  const unknown = await decision("GET", "/kimeu/export", "PT");
  assert.equal(unknown.resolved, 0);
  assert.equal(unknown.outcome.code, "ROUTE_NOT_ALLOWED");
});

test("business boundary absolutely denies PT writes, including forged Admin assignments", async () => {
  for (const path of ["/kimeu/sessions", "/kimeu/onboarding/F-11", "/kimeu/foundations-assessment",
    "/kimeu/courses/FW-UE/tracking", "/kimeu/courses/FW-UE/practicals", "/kimeu/admin/sme-assignments"]) {
    assert.equal((await decision("POST", path, "PT", ["Admin"])).outcome?.status, 403);
  }
});

test("business route gates distinguish ceilings from assignments and preserve CEU/RD restrictions", async () => {
  assert.equal((await decision("POST", "/kimeu/onboarding/F-11", "RD")).outcome, undefined);
  assert.equal((await decision("POST", "/kimeu/foundations-assessment", "Fellowship Reviewer")).outcome, undefined);
  assert.equal((await decision("POST", "/kimeu/sessions", "Admin", ["Fellowship Reviewer"])).outcome?.status, 403);
  assert.equal((await decision("POST", "/kimeu/admin/sme-assignments", "Admin", ["Fellowship Reviewer"])).outcome, undefined);
  assert.equal((await decision("POST", "/kimeu/courses/FW-UE/tracking", "CEU Admin", ["CEU Admin"])).outcome, undefined);
  assert.equal((await decision("POST", "/kimeu/courses/FW-UE/practicals", "CEU Admin", ["CEU Admin"])).outcome?.status, 403);
  assert.equal((await decision("GET", "/kimeu/admin/sme-assignments", "CEU Admin", ["Admin"])).outcome?.status, 403);
});

test("Admin ceiling with narrower assignments is recorded accurately in the audit", async () => {
  let recorded;
  const auditSql = async (strings, ...values) => {
    assert.match(strings.join("?"), /insert into kimeu_clinician_notes/);
    recorded = values;
    return [];
  };
  await api.appendAudit(auditSql, user("Admin", ["Fellowship Reviewer"]), {
    workshopId: "Staff access", reviewId: "fixture-audit", note: { roles: ["SME Assist"] },
  });
  assert.equal(recorded.at(-1), "Admin");
  assert.doesNotMatch(JSON.stringify(recorded), /access_token|Bearer|auth-id/);
});

test.after(() => rm(directory, { recursive: true, force: true }));
