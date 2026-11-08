import { randomUUID } from "node:crypto";
import type { AppUser } from "../access";
import type { Sql } from "./client";

export async function appendAudit(sql: Sql, user: AppUser, input: {
  personId?: string | null; email?: string | null; workshopId: string;
  reviewId: string; note: unknown;
}) {
  const authorRole = user.authorization?.actor.principal.siteRole ??
    (user.roles.includes("Admin") ? "Admin" : "RD");
  await sql`
    insert into kimeu_clinician_notes
      (note_id, person_id, created, pt_email, note_type, workshop_id, review_id,
       note, author, author_role, visibility, source)
    values (${randomUUID()}, ${input.personId ?? null}, now(), ${input.email ?? null},
      'General', ${input.workshopId}, ${input.reviewId}, ${JSON.stringify(input.note)},
      ${user.nameInSheets}, ${authorRole}, 'Aaron + author', 'sme_app')
  `;
}
