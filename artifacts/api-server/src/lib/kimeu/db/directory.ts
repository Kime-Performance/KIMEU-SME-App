import type { Sql } from "./client";
import { withRead } from "./transaction";
import { KimeuError, normalizeEmail } from "../sheets";

export async function readRoster(sql: Sql, personId: string | null = null) {
  const rows = await sql<{ person_id: string; email: string; name: string; assigned_rd: string | null }[]>`
    select p.person_id, p.email, p.full_name as name, fp.rd as assigned_rd
    from person p
    left join kimeu_foundations_pt fp on fp.person_id = p.person_id and fp.deleted_at is null
    where p.active and p.email is not null
      and (${personId}::uuid is null or p.person_id = ${personId}::uuid)
      and exists (select 1 from providers pr
        where pr.person_id = p.person_id and pr.status = 'active' and pr.kimeu_roster)
    order by p.full_name, p.person_id
  `;
  const people = rows.map(r => ({
    personId: r.person_id, email: normalizeEmail(r.email), name: r.name || r.email,
    location: "", assignedRd: r.assigned_rd ?? "",
  }));
  if (new Set(people.map(p => p.email)).size !== people.length ||
      new Set(people.map(p => p.personId)).size !== people.length) {
    throw new KimeuError("Duplicate active PT identities require director review.", 409, "ROSTER_DUPLICATE");
  }
  return people;
}

export async function readCourseDirectory() {
  return withRead(async sql => ({
    refreshedAt: new Date().toISOString(),
    people: (await readRoster(sql)).map(({ email, name, location }) => ({ email, name, location })),
  }));
}
