import { createHash } from "node:crypto";
import type { FellowshipReviewInput } from "@workspace/api-zod";
import { requireRole, type AppUser } from "../access";
import { KimeuError, normalizeEmail, todayInAppTimeZone } from "../sheets";
import type { Sql } from "./client";
import { withKimeuLock, withRead } from "./transaction";
import { assertInputHeader } from "./allowlist";

const REVIEWS_TABLE = "kimeu_fellowship_reviews";
const NOTES_TABLE = "kimeu_clinician_notes";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Sheet-header -> canonical column contract. Every header written below is
// asserted against the allowlist before any statement is built.
const REVIEW_HEADERS = [
  "Review Date", "Reviewed By", "Review Type", "PT Email", "PT Name", "Result", "Score",
  "Workshop ID (Refocus)", "Specific Need", "Notes", "Last Updated By", "Last Updated",
] as const;
const NOTE_HEADERS = [
  "Note ID", "Created", "PT Email", "Note Type", "Review ID", "Note",
  "Author", "Author Role", "Visibility",
] as const;

type RosterRow = { person_id: string; email: string; name: string };
type ReviewRow = {
  review_id: string; pt_email: string | null; pt_name: string | null; review_date: string | null;
  reviewed_by: string | null; review_type: string | null; result: string | null;
  score: number | string | null; workshop_id_refocus: string | null; specific_need: string | null;
  notes: string | null; status: string | null; last_updated: string | null;
};
type WorkshopRow = { workshop_id: string; name: string };

function authorize(user: AppUser) {
  if (!user.active) throw new KimeuError("Your staff access is inactive.", 403, "APP_USER_INACTIVE");
  requireRole(user, "Fellowship Reviewer");
}

async function loadWorkspace(q: Sql, user: AppUser) {
  authorize(user);
  // Active clinical PTs come from the person spine; person_email_alias feeds
  // person.email upstream, and providers gates to active clinicians.
  const roster = await q<RosterRow[]>`
    select p.person_id, p.email, p.full_name as name
    from person p
    where p.active
      and p.email is not null
      and exists (
        select 1 from providers pr
        where pr.person_id = p.person_id and pr.status = 'active'
      )
    order by p.full_name
  `;
  const reviewRows = await q<ReviewRow[]>`
    select review_id, pt_email, pt_name,
           to_char(review_date, 'YYYY-MM-DD') as review_date,
           reviewed_by, review_type, result, score, workshop_id_refocus,
           specific_need, notes, status, last_updated::text as last_updated
    from kimeu_fellowship_reviews
    where deleted_at is null
    order by review_date desc nulls last, last_updated desc nulls last
  `;
  const workshopRows = await q<WorkshopRow[]>`
    select workshop_id, workshop_name as name
    from kimeu_workshops
    where lower(stage) = 'fellowship' and deleted_at is null
    order by workshop_id
  `;
  const people = roster.map(row => {
    const person = { personId: row.person_id, email: normalizeEmail(row.email), name: row.name, location: "" };
    const own = reviewRows
      .filter(r => normalizeEmail(r.pt_email ?? "") === person.email)
      .map(r => [r.review_id, r.review_date, r.reviewed_by, r.review_type, r.pt_email, r.pt_name,
        r.result, r.score, r.workshop_id_refocus, r.specific_need, r.notes]);
    return { ...person, revision: hash([person, own]) };
  });
  const reviews = reviewRows.map(r => ({
    id: r.review_id,
    email: normalizeEmail(r.pt_email ?? ""), name: r.pt_name ?? "",
    reviewDate: r.review_date ?? "", reviewedBy: r.reviewed_by ?? "",
    reviewType: r.review_type ?? "", result: r.result ?? "",
    score: r.score === null || r.score === undefined || `${r.score}`.trim() === "" || !Number.isFinite(Number(r.score))
      ? null : Number(r.score),
    notes: r.notes ?? "", specificNeed: r.specific_need ?? "",
    workshopId: r.workshop_id_refocus || null,
    status: r.status ?? "", updatedAt: r.last_updated ?? "",
  }));
  return { today: todayInAppTimeZone(), people, reviews, workshops: workshopRows };
}

export async function getFellowshipReviews(user: AppUser) {
  return withRead(q => loadWorkspace(q, user));
}

export async function saveFellowshipReview(user: AppUser, input: FellowshipReviewInput) {
  authorize(user);
  if (!user.nameInSheets.trim()) throw new KimeuError("Your Name in Sheets is required.", 409, "AUTHOR_REQUIRED");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId)) {
    throw new KimeuError("A valid save request ID is required.", 400, "INVALID_REVIEW");
  }
  const email = normalizeEmail(input.email), notes = input.notes.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reviewDate) ||
      !Number.isFinite(Date.parse(input.reviewDate)) ||
      new Date(input.reviewDate).toISOString().slice(0, 10) !== input.reviewDate ||
      input.reviewDate > todayInAppTimeZone()) {
    throw new KimeuError("Choose a valid review date that is not in the future.", 400, "INVALID_REVIEW_DATE");
  }
  if (!["Pass", "Refocus"].includes(input.result) || !Number.isFinite(input.score) ||
      input.score < 0 || input.score > 100 || notes.length > 4000 ||
      (input.result === "Refocus" && notes.length < 5)) {
    throw new KimeuError("Record Pass or Fail / Refocus, a score from 0 to 100, and meaningful notes for a failed review.", 400, "INVALID_REVIEW");
  }
  if (input.result === "Pass" && input.workshopId) {
    throw new KimeuError("A refocus workshop applies only to failed reviews.", 400, "INVALID_REVIEW");
  }
  const payload = { email, reviewDate: input.reviewDate, result: input.result, score: input.score, notes, workshopId: input.workshopId };
  const fingerprint = hash(payload), auditId = `FELLOWSHIP:${input.requestId}`;
  return withKimeuLock(async (tx) => {
    // Idempotency gate: a matching audit note means this request already saved.
    const oldAudit = (await tx<{ note_id: string; note: string | null }[]>`
      select note_id, note from kimeu_clinician_notes
      where note_id = ${auditId} and deleted_at is null
      limit 1
    `)[0];
    if (oldAudit) {
      let old: { fingerprint?: string; authorEmail?: string } = {};
      try { old = JSON.parse(oldAudit.note ?? ""); } catch { /* Fail closed below. */ }
      if (old.fingerprint !== fingerprint || old.authorEmail !== user.email) {
        throw new KimeuError("This save ID was already used for a different review.", 409, "REVIEW_REQUEST_CONFLICT");
      }
      return loadWorkspace(tx, user); // Safe retry after a lost response; never insert twice.
    }
    const state = await loadWorkspace(tx, user);
    const person = state.people.find(p => p.email === email);
    if (!person) throw new KimeuError("Select an available active PT from the master roster.", 409, "PT_UNAVAILABLE");
    if (person.revision !== input.revision) {
      throw new KimeuError("This PT's review history changed. Reload the latest record before saving; your draft has not been saved.", 409, "REVIEW_CHANGED");
    }
    if (input.workshopId && !state.workshops.some(w => w.workshop_id === input.workshopId)) {
      throw new KimeuError("Select a Fellowship workshop from the current catalog.", 400, "INVALID_REFOCUS_WORKSHOP");
    }
    for (const header of REVIEW_HEADERS) assertInputHeader(REVIEWS_TABLE, header);
    for (const header of NOTE_HEADERS) assertInputHeader(NOTES_TABLE, header);
    const at = new Date();
    const reviewId = `FR-${input.reviewDate}-${email}-${input.requestId.slice(0, 8)}`;
    await tx`
      insert into kimeu_fellowship_reviews (
        review_id, person_id, review_date, reviewed_by, review_type, pt_email, pt_name,
        result, score, workshop_id_refocus, specific_need, notes,
        last_updated_by, last_updated, source, synced_at
      ) values (
        ${reviewId}, ${person.personId}, ${input.reviewDate}, ${user.nameInSheets}, 'Fellowship Exam',
        ${email}, ${person.name}, ${input.result}, ${input.score},
        ${input.workshopId ?? null}, ${input.result === "Refocus" ? notes : null}, ${notes},
        ${user.email}, ${at}, 'sme_app', ${at}
      )
    `;
    await tx`
      insert into kimeu_clinician_notes (
        note_id, person_id, created, pt_email, note_type, review_id, note,
        author, author_role, visibility, source, synced_at
      ) values (
        ${auditId}, ${person.personId}, ${at}, ${email}, 'General',
        ${`Fellowship exam:${input.requestId}`},
        ${JSON.stringify({ ...payload, fingerprint, authorEmail: user.email, reviewId })},
        ${user.nameInSheets}, ${user.roles.includes("Admin") ? "Admin" : "Fellowship Reviewer"},
        'Aaron + author', 'sme_app', ${at}
      )
    `;
    // Readback: both rows must reflect the write before reporting success.
    const back = (await tx<ReviewRow[]>`
      select review_id, pt_email, pt_name,
             to_char(review_date, 'YYYY-MM-DD') as review_date,
             reviewed_by, review_type, result, score, workshop_id_refocus,
             specific_need, notes, status, last_updated::text as last_updated
      from kimeu_fellowship_reviews
      where review_id = ${reviewId} and deleted_at is null
    `)[0];
    const fieldsOk = back &&
      back.review_date === input.reviewDate &&
      back.reviewed_by === user.nameInSheets &&
      back.review_type === "Fellowship Exam" &&
      normalizeEmail(back.pt_email ?? "") === email &&
      back.result === input.result &&
      Number(back.score) === input.score &&
      (back.workshop_id_refocus || null) === (input.workshopId ?? null) &&
      (back.specific_need ?? null) === (input.result === "Refocus" ? notes : null) &&
      (back.notes ?? "") === notes &&
      Boolean(back.last_updated);
    if (!fieldsOk) {
      throw new KimeuError("The review was submitted but readback could not confirm every field. Retry the same draft safely.", 503, "REVIEW_UNCONFIRMED");
    }
    const auditBack = (await tx<{ note_id: string }[]>`
      select note_id from kimeu_clinician_notes
      where note_id = ${auditId} and deleted_at is null
    `)[0];
    if (!auditBack) {
      throw new KimeuError("The review audit could not be confirmed. Retry the same draft safely.", 503, "REVIEW_UNCONFIRMED");
    }
    return loadWorkspace(tx, user);
  });
}
