import { clerkClient, getAuth } from "@clerk/express";
import type { Request } from "express";
import { requestActor, usesSupabaseAuth } from "./auth/request-context";
import type { RequestActor } from "./auth/actor";
import { permits } from "./auth/policy";
import { routeGate } from "./auth/route-policy";
import { canonicalRole, hasSiteRole, verifiedPrimaryEmail } from "./site-access-policy";
import { isPostgresMode } from "./db/env";
import { findActiveAppUser as postgresUser } from "./db/staff";
import { getBasicReadiness as postgresBasic, getReadiness as postgresReadiness } from "./db/readiness";
import {
  cell,
  getBasicReadiness,
  KimeuError,
  normalizeEmail,
  normalizeChoice,
  readTab,
  headersFor,
  headerIndex,
  testCopyReadiness,
  getSheetIdForAdmin,
} from "./sheets";

export const KIMEU_EMAIL_DOMAIN = "kimeperformance.com";
export const KIMEU_ROLES = [
  "SME Assist",
  "SME Lead",
  "Foundations SME",
  "Elite SME",
  "RD",
  "Fellowship Reviewer",
  "CEU Admin",
  "Admin",
  "PT",
] as const;

export type KimeuRole = (typeof KIMEU_ROLES)[number];
export type AppUser = {
  email: string;
  nameInSheets: string;
  roles: string[];
  workshopIds: string[];
  active: boolean;
  /** Server-created request context; never serialize this to a client. */
  authorization?: { actor: RequestActor; method: string; assignment: boolean; capability: string };
};

export async function signedInEmail(req: Request): Promise<string> {
  if (usesSupabaseAuth()) return (await requestActor(req)).principal.rosterEmail;
  const { userId } = getAuth(req);
  if (!userId) {
    throw new KimeuError("Sign in to continue.", 401, "SIGN_IN_REQUIRED");
  }

  try {
    const user = await clerkClient.users.getUser(userId);
    const email = verifiedPrimaryEmail(user);
    if (!email) {
      throw new KimeuError(
        "Your sign-in account does not have a verified email address.",
        403,
        "EMAIL_REQUIRED",
      );
    }
    return normalizeEmail(email);
  } catch (error) {
    if (error instanceof KimeuError) throw error;
    throw new KimeuError(
      "The signed-in account could not be verified.",
      401,
      "IDENTITY_UNAVAILABLE",
    );
  }
}

export function hasKimeuDomain(email: string): boolean {
  return email.endsWith(`@${KIMEU_EMAIL_DOMAIN}`);
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export async function findActiveAppUser(email: string): Promise<AppUser | null> {
  if (isPostgresMode()) return postgresUser(email);
  const readiness = getBasicReadiness();
  if (!readiness.configured) {
    throw new KimeuError(
      "KIMEU is waiting for an approved spreadsheet configuration and Google Sheets connection.",
      503,
      "SHEET_NOT_CONFIGURED",
    );
  }
  // Revocations must apply on the next request, not after the sheet cache expires.
  const snapshot = await readTab("03h-App Users", { force: true });
  const headers = headersFor(snapshot);
  const emailIndex = headerIndex(headers, "Email");
  const nameIndex = headerIndex(headers, "Name in Sheets");
  const rolesIndex = headerIndex(headers, "App Role(s)");
  const workshopIndex = headerIndex(headers, "Workshop IDs");
  const activeIndex = headerIndex(headers, "Active");
  const rows = snapshot.rows
    .map((values, index) => ({ values, rowNumber: index + 1 }))
    .filter(
      ({ values, rowNumber }) =>
        rowNumber >= snapshot.dataStartRow &&
        normalizeEmail(cell(values, emailIndex)) === email,
    );
  if (rows.length > 1) {
    throw new KimeuError(
      "More than one app-user row matches this email. Ask an administrator to resolve the duplicate.",
      409,
      "APP_USER_DUPLICATE",
    );
  }
  const row = rows[0]?.values;
  if (!row || normalizeChoice(cell(row, activeIndex)) !== "yes") return null;
  return {
    email,
    nameInSheets: cell(row, nameIndex),
    roles: [...new Set(splitList(cell(row, rolesIndex)).map(canonicalRole))].filter((role) =>
      (KIMEU_ROLES as readonly string[]).includes(role),
    ),
    workshopIds: splitList(cell(row, workshopIndex)),
    active: true,
  };
}

export async function requireActiveAppUser(req: Request): Promise<AppUser> {
  if (usesSupabaseAuth()) {
    if (!isPostgresMode()) throw new KimeuError("Supabase authentication requires the approved database.", 503, "DATABASE_REQUIRED");
    const actor = await requestActor(req);
    const rule = routeGate(req.method, req.path);
    if (!rule) throw new KimeuError("This route is not authorized.", 403, "ROUTE_NOT_ALLOWED");
    return {
      email: actor.principal.rosterEmail, nameInSheets: actor.displayName ?? actor.principal.rosterEmail,
      roles: actor.roles, workshopIds: actor.workshopIds, active: true,
      authorization: { actor, method: req.method, assignment: rule.assignment, capability: rule.capability },
    };
  }
  const email = await signedInEmail(req);
  if (!hasKimeuDomain(email)) {
    throw new KimeuError(
      `Sign in with a @${KIMEU_EMAIL_DOMAIN} account.`,
      403,
      "DOMAIN_NOT_ALLOWED",
    );
  }
  const user = await findActiveAppUser(email);
  if (!user) {
    throw new KimeuError(
      "Your KIMEU account is not active in the app-user sheet.",
      403,
      "APP_USER_INACTIVE",
    );
  }
  if (!hasSiteRole(user.roles)) {
    throw new KimeuError(
      "KIMEU is private to approved SMEs, Regional Directors, Fellowship reviewers, and administrators.",
      403,
      "SITE_ROLE_NOT_ALLOWED",
    );
  }
  return user;
}

export function requireRole(user: AppUser, ...roles: KimeuRole[]): void {
  if (user.authorization) {
    // The deny-by-default route boundary already checked this exact method's
    // capability. Reads are admitted for every supported ceiling; legacy
    // role-named repository guards must not turn read-only PT into an RD.
    if (user.authorization.method === "GET") return;
    const actor = user.authorization.actor;
    if (actor.principal.siteRole === "PT") throw new KimeuError("Your account has view-only access.", 403, "ROLE_NOT_ALLOWED");
    const applicable = user.authorization.assignment ? actor.roles : [actor.principal.siteRole];
    const allowed = roles.some(role => role === "Admin" ? applicable.includes("Admin")
      : role === "RD" ? permits(applicable, user.authorization!.capability === "assessment" ? "assessment" : "practical")
      : role === "Fellowship Reviewer" ? permits(applicable, "review")
      : role === "SME Lead" || role === "SME Assist" ? permits(applicable, "attendance")
      : applicable.includes(role as typeof applicable[number]));
    if (!allowed) throw new KimeuError("Your role does not allow this action.", 403, "ROLE_NOT_ALLOWED");
    return;
  }
  if (user.roles.includes("Admin")) return;
  if (!roles.some((role) => user.roles.map(canonicalRole).includes(canonicalRole(role)))) {
    throw new KimeuError(
      "Your KIMEU role does not allow this action.",
      403,
      "ROLE_NOT_ALLOWED",
    );
  }
}

export function requireWorkshopAccess(user: AppUser, workshopId: string): void {
  if (user.authorization && (user.authorization.method === "GET" || !user.authorization.assignment)) return;
  if (user.roles.includes("Admin")) return;
  if (!user.workshopIds.includes(workshopId)) {
    throw new KimeuError(
      "This workshop is not assigned to your KIMEU account.",
      403,
      "WORKSHOP_NOT_ASSIGNED",
    );
  }
}

export async function getBootstrapForRequest(req: Request) {
  if (usesSupabaseAuth()) {
    const user = await requireActiveAppUser(req);
    const { authorization, ...publicUser } = user;
    return { readiness: await postgresReadiness(), user: { ...publicUser,
      siteRole: authorization!.actor.principal.siteRole }, access: "allowed" as const };
  }
  if (isPostgresMode()) {
    const email = await signedInEmail(req);
    if (!hasKimeuDomain(email)) return { readiness: postgresBasic(), user: null, access: "domain_denied" as const };
    const user = await findActiveAppUser(email);
    const readiness = await postgresReadiness();
    if (!user) return { readiness, user: null, access: "inactive" as const };
    if (!hasSiteRole(user.roles)) return { readiness, user: null, access: "role_denied" as const };
    return { readiness, user, access: "allowed" as const };
  }
  const email = await signedInEmail(req);
  if (!hasKimeuDomain(email)) {
    const readiness = await testCopyReadiness();
    return {
      readiness,
      user: null,
      access: "domain_denied" as const,
    };
  }

  const basic = getBasicReadiness();
  if (!basic.configured) {
    return { readiness: await testCopyReadiness(), user: null, access: "not_configured" as const };
  }
  // Authorization depends on the freshly read staff record, not whether every
  // separate workshop/log tab happened to pass its connection/readiness probe.
  const user = await findActiveAppUser(email);
  if (!user) {
    return { readiness: basic, user: null, access: "inactive" as const };
  }
  if (!hasSiteRole(user.roles)) {
    return { readiness: basic, user: null, access: "role_denied" as const };
  }
  const readiness = await testCopyReadiness();
  if (user.roles.includes("Admin")) {
    readiness.sheetId = getSheetIdForAdmin();
  }
  return { readiness, user, access: "allowed" as const };
}
