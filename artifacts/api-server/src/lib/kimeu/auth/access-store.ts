import { getSql } from "../db/client";
import type { AccessRow, AccessStore } from "./identity";

/** Only the approved access columns; never service-role credentials for SQL. */
export const accessStore: AccessStore = {
  async byAuthId(id) {
    return getSql()<AccessRow[]>`
      select auth_user_id, email, kimeu_sme from public.user_access
      where auth_user_id = ${id}::uuid
    `;
  },
  async bindUnclaimed(id, email) {
    // Single compare-and-set statement; normalized email + auth ID uniqueness
    // must be enforced by the owner's prerequisite migration.
    return getSql()<AccessRow[]>`
      update public.user_access set auth_user_id = ${id}::uuid
      where lower(trim(email)) = ${email} and auth_user_id is null
      returning auth_user_id, email, kimeu_sme
    `;
  },
};
