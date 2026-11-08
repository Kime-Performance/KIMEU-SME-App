import type { AppUser } from "../access";
import { KimeuError } from "../sheets";
import { permits, type Capability } from "./policy";

/** Only the verified app-user person linkage may narrow participant queries. */
export function ownPersonId(user: AppUser): string | null {
  if (user.authorization?.actor.principal.siteRole !== "PT") return null;
  const id = user.authorization.actor.personId;
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new KimeuError("Your account is pending setup.", 403, "ACCOUNT_PENDING");
  }
  return id;
}

export function maySignOff(user: AppUser, capability: Capability): boolean {
  return user.authorization
    ? permits([user.authorization.actor.principal.siteRole], capability)
    : user.roles.includes("Admin") || user.roles.includes("RD");
}

export function unrestrictedCourseRead(user: AppUser): boolean {
  return !!user.authorization && user.authorization.method === "GET";
}
