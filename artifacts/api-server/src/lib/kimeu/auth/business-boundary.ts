import type { RequestHandler } from "express";
import { AuthRejection } from "./identity";
import { permits } from "./policy";
import { routeGate } from "./route-policy";
import { requestActor, usesSupabaseAuth } from "./request-context";
import { assertBusinessWrite } from "./object-scope";

/**
 * Staged in the real API pipeline; inactive until explicit provider cutover.
 * Existing resource handlers still enforce authoritative workshop/person
 * ownership. No request-supplied person identity is accepted here.
 */
export function createBusinessBoundary(dependencies = { enabled: usesSupabaseAuth, actor: requestActor }): RequestHandler {
return async (req, _res, next) => {
  try {
    if (!dependencies.enabled()) { next(); return; }
    if (!req.path.startsWith("/kimeu")) { next(); return; }
    const rule = routeGate(req.method, req.path);
    if (!rule) throw new AuthRejection(403, "ROUTE_NOT_ALLOWED", "This route is not authorized.");
    const actor = await dependencies.actor(req);
    if (req.method !== "GET") assertBusinessWrite(actor.principal);
    const roles = rule.assignment ? actor.roles : [actor.principal.siteRole];
    if (![rule.capability, ...rule.alternatives].some(capability => permits(roles, capability))) {
      throw new AuthRejection(403, "ROLE_NOT_ALLOWED", "Your role does not allow this action.");
    }
    next();
  } catch (error) { next(error); }
};
}

export const businessBoundary = createBusinessBoundary();
