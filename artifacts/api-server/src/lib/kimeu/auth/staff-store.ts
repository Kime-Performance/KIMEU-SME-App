import { withRead } from "../db/transaction";
import type { StaffIdentity, StaffStore } from "./actor";

/** Existing restricted server DB credential; never Supabase Auth admin keys. */
export const staffStore: StaffStore = {
  async byRosterEmail(email) {
    return withRead(sql => sql<StaffIdentity[]>`
      select person_id, active, app_roles, workshop_ids, name_in_sheets
      from public.kimeu_app_users
      where lower(trim(email::text)) = ${email} and deleted_at is null
    `);
  },
};
