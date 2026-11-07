import { requestAuthClient } from "./clients";
import type { AccessStore } from "./identity";

/** Anon API key + the verified user's JWT. Own-row RLS is authoritative. */
export function createAccessStore(clientFactory = requestAuthClient): AccessStore {
  return {
    async ownRoles(identity) {
      const { data, error } = await clientFactory(identity.accessToken)
        .from("user_access")
        .select("kimeu_sme")
        .eq("auth_user_id", identity.authUserId);
      if (error) throw new Error("Account role lookup unavailable.");
      if (!Array.isArray(data)) throw new Error("Invalid account role response.");
      return data;
    },
  };
}

export const accessStore = createAccessStore();
