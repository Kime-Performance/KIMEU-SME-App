import { AuthRejection, type Principal } from "./identity";

/**
 * Prepared cutover boundary, not mounted in the current application.
 * Implement this repository only against Oracle's authoritative immutable
 * Auth-ID linkage. Never use a request's person ID, query, name or email.
 */
export interface PersonIdentityRepository {
  personIdsForAuthUser(authUserId: string): Promise<readonly string[]>;
}

export type ReadScope =
  | { kind: "own"; personId: string }
  | { kind: "staff" };

export async function resolveReadScope(
  principal: Principal, repository: PersonIdentityRepository,
): Promise<ReadScope> {
  if (principal.siteRole !== "PT") return { kind: "staff" };
  let ids: readonly string[];
  try {
    ids = await repository.personIdsForAuthUser(principal.authUserId);
  } catch {
    throw new AuthRejection(503, "PERSON_UNAVAILABLE", "Your record is temporarily unavailable.");
  }
  // Even duplicate mapping rows are ambiguous and must be reviewed upstream.
  if (ids.length !== 1 || !ids[0]?.trim()) {
    throw new AuthRejection(403, "ACCOUNT_PENDING", "Your account is pending setup. Contact your administrator.");
  }
  return { kind: "own", personId: ids[0] };
}

function owns(scope: ReadScope, ownerPersonId: string | null): boolean {
  if (!ownerPersonId?.trim()) return false;
  return scope.kind === "staff" || scope.personId === ownerPersonId;
}

/** Use on each detail record after resolving its owner from authoritative data. */
export function assertReadable(scope: ReadScope, ownerPersonId: string | null): void {
  if (!owns(scope, ownerPersonId)) {
    // Same outcome as a missing record; do not disclose another PT's existence.
    throw new AuthRejection(404, "RECORD_NOT_FOUND", "That record is unavailable.");
  }
}

/**
 * Lists and exports share the same ownership filter. Parent metadata must not
 * contain other participants, notes, totals or nested private data. Handlers
 * must project those fields separately; filtering a parent session is not
 * enough. Prefer an owner predicate at the query boundary too.
 */
export function readableRows<T>(
  scope: ReadScope, rows: readonly T[], ownerOf: (row: T) => string | null,
): T[] {
  return rows.filter(row => owns(scope, ownerOf(row)));
}

/** No assignment or higher clinical capability may override the PT write ban. */
export function assertBusinessWrite(principal: Principal): void {
  if (principal.siteRole === "PT") {
    throw new AuthRejection(403, "ROLE_NOT_ALLOWED", "Your account has view-only access.");
  }
}
