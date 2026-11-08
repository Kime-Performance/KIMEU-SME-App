import { createHash, randomUUID } from "node:crypto";
import type { FoundationsAssessmentInput } from "@workspace/api-zod";
import { requireRole, type AppUser } from "../access";
import type { Sql } from "./client";
import { withKimeuLock, withRead } from "./transaction";
import { readRoster } from "./directory";
import { appendAudit } from "./audit";
import { isAssignedRd } from "../practical-rules";
import { ownPersonId } from "../auth/data-scope";
import { KimeuError, normalizeEmail } from "../sheets";

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
async function load(sql: Sql, user: AppUser) {
  if (!user.active) throw new KimeuError("Your staff access is inactive.", 403, "APP_USER_INACTIVE");
  requireRole(user, "RD");
  const personId = ownPersonId(user);
  const roster = await readRoster(sql, personId);
  const rows = await sql<{ person_id: string; exam_result: string | null; rd: string | null }[]>`
    select person_id, exam_result, rd from kimeu_foundations_pt where deleted_at is null
      and (${personId}::uuid is null or person_id = ${personId}::uuid)
  `;
  const people = roster.flatMap(p => {
    const matches = rows.filter(r => r.person_id === p.personId);
    if (matches.length > 1) throw new KimeuError("Duplicate Foundations identities require review.", 409, "ASSESSMENT_DUPLICATE");
    const row = matches[0];
    if (!row || (!user.authorization && !user.roles.includes("Admin") && !isAssignedRd(row.rd ?? "", user.nameInSheets, user.email))) return [];
    return [{ personId: p.personId, email: p.email, name: p.name, location: p.location,
      result: row.exam_result ?? "", rawResult: row.exam_result,
      revision: hash([p.personId, p.email, row.rd, row.exam_result]) }];
  });
  return { people };
}
const publicState = (state: Awaited<ReturnType<typeof load>>) => ({
  people: state.people.map(({ personId: _id, rawResult: _raw, ...p }) => p),
});
export async function getFoundationsAssessment(user: AppUser) {
  return withRead(async sql => publicState(await load(sql, user)));
}
export async function saveFoundationsAssessment(user: AppUser, input: FoundationsAssessmentInput) {
  requireRole(user, "RD");
  if (!["Pass", "Fail"].includes(input.result)) throw new KimeuError("Choose Pass or Fail.", 400, "ASSESSMENT_INVALID_RESULT");
  if (!user.nameInSheets.trim()) throw new KimeuError("Your staff display name is required.", 409, "AUTHOR_REQUIRED");
  return withKimeuLock(async sql => {
    const state = await load(sql, user);
    const person = state.people.find(p => p.email === normalizeEmail(input.email));
    if (!person) throw new KimeuError("This PT needs an existing Foundations record and assignment to you.", 403, "PT_NOT_ASSIGNED");
    if (person.revision !== input.revision) throw new KimeuError("This assessment changed. Reload first.", 409, "ASSESSMENT_CHANGED");
    const changed = await sql<{ person_id: string }[]>`
      update kimeu_foundations_pt set exam_result = ${input.result}
      where person_id = ${person.personId}::uuid and deleted_at is null
        and exam_result is not distinct from ${person.rawResult}::text
      returning person_id
    `;
    if (changed.length !== 1) throw new KimeuError("The assessment changed or is not writable.", 409, "ASSESSMENT_CHANGED");
    await appendAudit(sql, user, { personId: person.personId, email: person.email,
      workshopId: "Foundations Assessment", reviewId: `Foundations assessment:${randomUUID()}`,
      note: { previousResult: person.result, result: input.result } });
    const result = publicState(await load(sql, user));
    if (result.people.find(p => p.email === person.email)?.result !== input.result) {
      throw new KimeuError("Assessment readback failed; the transaction was rolled back.", 503, "ASSESSMENT_READBACK_FAILED");
    }
    return result;
  });
}
