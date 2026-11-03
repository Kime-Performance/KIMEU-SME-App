import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const temp = await mkdtemp(join(tmpdir(), "pg-fellowship-review-"));
await build({
  stdin: {
    contents: "export { getFellowshipReviews, saveFellowshipReview } from './src/lib/kimeu/fellowship-reviews'; export { setSql } from './src/lib/kimeu/db/client';",
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
const { getFellowshipReviews, saveFellowshipReview, setSql } = await import(pathToFileURL(join(temp, "module.mjs")).href);

// --- Stateful fake of the canonical tables --------------------------------
const db = {
  persons: [
    { person_id: "p1", email: "pt@fixture.test", full_name: "Fixture PT", active: true },
    { person_id: "p2", email: "former@fixture.test", full_name: "Former PT", active: true },
  ],
  providers: [
    { person_id: "p1", status: "active" },
    { person_id: "p2", status: "terminated" },
  ],
  workshops: [
    { workshop_id: "FW-TEST", workshop_name: "Fixture Fellowship", stage: "Fellowship", deleted_at: null },
    { workshop_id: "F-TEST", workshop_name: "Fixture Foundations", stage: "Foundations", deleted_at: null },
  ],
  reviews: [],
  notes: [],
};
const sqlCalls = [];
async function sql(strings, ...values) {
  const text = strings.join("?");
  sqlCalls.push(text);
  if (/pg_advisory_xact_lock/i.test(text)) return [];
  if (/insert into kimeu_fellowship_reviews/i.test(text)) {
    // Bound params only; 'Fellowship Exam' and 'sme_app' are SQL literals.
    const [review_id, person_id, review_date, reviewed_by, pt_email, pt_name,
      result, score, workshop_id_refocus, specific_need, notes, last_updated_by, last_updated] = values;
    db.reviews.push({ review_id, person_id, review_date, reviewed_by, review_type: "Fellowship Exam",
      pt_email, pt_name, result, score, workshop_id_refocus, specific_need, notes, last_updated_by,
      last_updated: String(last_updated), status: null });
    return [];
  }
  if (/insert into kimeu_clinician_notes/i.test(text)) {
    // Bound params only; 'General', 'Aaron + author', 'sme_app' are SQL literals.
    const [note_id, person_id, created, pt_email, review_id, note, author, author_role] = values;
    db.notes.push({ note_id, person_id, created, pt_email, note_type: "General", review_id, note,
      author, author_role, visibility: "Aaron + author" });
    return [];
  }
  if (/from kimeu_clinician_notes/i.test(text)) {
    // Idempotency gate and readback both look the audit note up by review_id
    // (note_id is a uuid primary key generated at insert time).
    return db.notes.filter(n => n.review_id === values[0]);
  }
  if (/from kimeu_fellowship_reviews/i.test(text)) {
    if (/where review_id/i.test(text)) return db.reviews.filter(r => r.review_id === values[0]);
    return [...db.reviews].sort((a, b) => (b.review_date ?? "").localeCompare(a.review_date ?? ""));
  }
  if (/from kimeu_workshops/i.test(text)) {
    return db.workshops
      .filter(w => !w.deleted_at && w.stage.toLowerCase() === "fellowship")
      .map(w => ({ workshop_id: w.workshop_id, name: w.workshop_name }));
  }
  if (/from person p/i.test(text)) {
    return db.persons
      .filter(p => p.active && p.email && db.providers.some(pr => pr.person_id === p.person_id && pr.status === "active"))
      .map(p => ({ person_id: p.person_id, email: p.email, name: p.full_name }));
  }
  throw new Error(`Unmocked query: ${text}`);
}
sql.begin = async (fn) => fn(sql);
setSql(sql);

const reviewer = { email: "rev@fixture.test", nameInSheets: "Fixture Reviewer", roles: ["Fellowship Reviewer"], workshopIds: [], active: true };

async function validDraft() {
  const ws = await getFellowshipReviews(reviewer);
  const person = ws.people.find(p => p.email === "pt@fixture.test");
  return { requestId: randomUUID(), email: person.email, reviewDate: "2026-10-30",
    result: "Pass", score: 90, notes: "Strong fellowship exam.", workshopId: null, revision: person.revision };
}

test("reads the roster from the person spine and excludes non-active providers", async () => {
  const ws = await getFellowshipReviews(reviewer);
  assert.deepEqual(ws.people.map(p => p.email), ["pt@fixture.test"]);
  assert.ok(ws.people[0].revision);
  assert.deepEqual(ws.workshops.map(w => w.workshop_id), ["FW-TEST"]);
});

test("saves a review, appends the audit note, and confirms readback", async () => {
  const before = db.reviews.length;
  const draft = await validDraft();
  const res = await saveFellowshipReview(reviewer, draft);
  assert.equal(db.reviews.length, before + 1);
  assert.equal(db.notes.length, before + 1);
  assert.equal(db.notes[0].review_id, `FELLOWSHIP:${draft.requestId}`);
  assert.match(db.notes[0].note_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "note_id is a generated uuid, not the request marker");
  const saved = res.reviews.find(r => r.email === "pt@fixture.test");
  assert.equal(saved.result, "Pass");
  assert.equal(saved.score, 90);
  assert.equal(saved.reviewedBy, "Fixture Reviewer");
});

test("a duplicate requestId returns safely without double-writing", async () => {
  const draft = await validDraft();
  await saveFellowshipReview(reviewer, draft);
  const before = db.reviews.length;
  const res = await saveFellowshipReview(reviewer, draft); // retry after a lost response
  assert.equal(db.reviews.length, before); // no extra row
  assert.equal(db.notes.length, before); // no extra audit row
  assert.ok(res.people.some(p => p.email === "pt@fixture.test"));
});

test("the same requestId with a different payload throws REVIEW_REQUEST_CONFLICT", async () => {
  const before = db.reviews.length;
  const draft = await validDraft();
  await saveFellowshipReview(reviewer, draft);
  await assert.rejects(
    () => saveFellowshipReview(reviewer, { ...draft, score: 55, result: "Refocus", notes: "Needs refocus plan." }),
    err => err.code === "REVIEW_REQUEST_CONFLICT",
  );
  assert.equal(db.reviews.length, before + 1); // first save stuck; conflict did not add
  assert.equal(db.notes.length, before + 1);
});

test("users without the Fellowship Reviewer role are blocked", async () => {
  const outsider = { ...reviewer, email: "sme@fixture.test", roles: ["SME Lead"] };
  await assert.rejects(() => getFellowshipReviews(outsider), err => err.code === "ROLE_NOT_ALLOWED");
  await assert.rejects(() => saveFellowshipReview(outsider, { requestId: randomUUID(), email: "pt@fixture.test",
    reviewDate: "2026-10-30", result: "Pass", score: 90, notes: "n", workshopId: null, revision: "x" }),
    err => err.code === "ROLE_NOT_ALLOWED");
});

test("invalid scores and future review dates are rejected", async () => {
  const draft = await validDraft();
  const before = db.reviews.length;
  await assert.rejects(() => saveFellowshipReview(reviewer, { ...draft, requestId: randomUUID(), score: 101 }),
    err => err.code === "INVALID_REVIEW");
  await assert.rejects(() => saveFellowshipReview(reviewer, { ...draft, requestId: randomUUID(), score: -1 }),
    err => err.code === "INVALID_REVIEW");
  await assert.rejects(() => saveFellowshipReview(reviewer, { ...draft, requestId: randomUUID(), reviewDate: "2999-01-01" }),
    err => err.code === "INVALID_REVIEW_DATE");
  assert.equal(db.reviews.length, before);
});

test("a stale revision is rejected with REVIEW_CHANGED", async () => {
  const draft = await validDraft();
  const before = db.reviews.length;
  await assert.rejects(() => saveFellowshipReview(reviewer, { ...draft, requestId: randomUUID(), revision: "bogus" }),
    err => err.code === "REVIEW_CHANGED");
  assert.equal(db.reviews.length, before);
});

test("a refocus workshop on a passing review is rejected", async () => {
  const draft = await validDraft();
  const before = db.reviews.length;
  await assert.rejects(() => saveFellowshipReview(reviewer, { ...draft, requestId: randomUUID(), workshopId: "FW-TEST" }),
    err => err.code === "INVALID_REVIEW");
  assert.equal(db.reviews.length, before);
});
