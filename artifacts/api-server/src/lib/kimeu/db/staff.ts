import type { AppUser } from "../access";
import { withRead } from "./transaction";
import { canonicalRole } from "../site-access-policy";
import { KimeuError, normalizeEmail } from "../sheets";

export const splitList = (value: string | null) =>
  [...new Set((value ?? "").split(",").map(v => v.trim()).filter(Boolean))];

export async function findActiveAppUser(email: string): Promise<AppUser | null> {
  return withRead(async sql => {
    const rows = await sql<{
      email: string; name_in_sheets: string | null; active: boolean | null;
      app_roles: string | null; workshop_ids: string | null;
    }[]>`
      select email, name_in_sheets, active, app_roles, workshop_ids from kimeu_app_users
      where lower(email::text) = ${normalizeEmail(email)} and deleted_at is null
    `;
    if (rows.length > 1) throw new KimeuError("Duplicate staff identities need administrator review.", 409, "APP_USER_DUPLICATE");
    const row = rows[0];
    if (!row || row.active !== true) return null;
    return {
      email: normalizeEmail(row.email), nameInSheets: row.name_in_sheets ?? "",
      active: true, roles: [...new Set(splitList(row.app_roles).map(canonicalRole))],
      workshopIds: splitList(row.workshop_ids),
    };
  });
}
