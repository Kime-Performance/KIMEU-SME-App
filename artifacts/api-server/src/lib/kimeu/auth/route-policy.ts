import type { RequestHandler } from "express";
import { AuthRejection, type Principal } from "./identity";
import { permits, type Capability, type SiteRole } from "./policy";

type Gate = { method: string; path: RegExp; capability: Capability; objectScope: boolean; assignment: boolean };
const gate = (method: string, path: string, capability: Capability, objectScope = false, assignment = false): Gate =>
  ({ method, path: new RegExp(`^${path}$`), capability, objectScope, assignment });

// Paths are relative to /api. Unknown paths and methods ALWAYS fail closed.
export const ROUTE_GATES: readonly Gate[] = [
  gate("GET", "/kimeu/bootstrap", "read"),
  gate("GET", "/kimeu/courses", "read"),
  gate("GET", "/kimeu/upcoming", "read"),
  gate("GET", "/kimeu/today", "read", true),
  gate("GET", "/kimeu/sessions/[^/]+", "read", true),
  gate("GET", "/kimeu/courses/[^/]+/tracking/[^/]+", "read", true),
  gate("GET", "/kimeu/courses/[^/]+/practicals", "read", true),
  gate("GET", "/kimeu/onboarding/[^/]+", "read", true),
  gate("GET", "/kimeu/foundations-assessment", "read", true),
  gate("GET", "/kimeu/fellowship-reviews", "read", true),
  gate("GET", "/kimeu/admin/sme-assignments", "admin"),
  gate("POST", "/kimeu/admin/sme-assignments", "admin"),
  gate("POST", "/auth/invite", "admin"),
  gate("POST", "/auth/sign-out", "read"),
  gate("POST", "/kimeu/sessions", "attendance", false, true),
  gate("POST", "/kimeu/sessions/[^/]+/attendance", "attendance", true, true),
  gate("POST", "/kimeu/sessions/[^/]+/complete", "attendance", true, true),
  gate("POST", "/kimeu/courses/[^/]+/tracking", "attendance", true, true),
  gate("POST", "/kimeu/courses/[^/]+/practical-schedule", "practical", true, true),
  gate("POST", "/kimeu/courses/[^/]+/practicals", "practical", true, true),
  gate("POST", "/kimeu/onboarding/[^/]+", "onboarding", true),
  gate("POST", "/kimeu/foundations-assessment", "assessment", true),
  gate("POST", "/kimeu/fellowship-reviews", "review", true),
  gate("POST", "/kimeu/clinician-notes", "note", true, true),
];

export function routeGate(method: string, path: string): Gate | undefined {
  return ROUTE_GATES.find(g => g.method === method && g.path.test(path));
}

/**
 * Must be wired with server-side object/assignment resolution, including list
 * filtering. The mandatory callback may not merely inspect client-sent IDs.
 */
export function denyByDefault(dependencies: {
  principal(req: Parameters<RequestHandler>[0]): Promise<{ principal: Principal; roles: SiteRole[] }>;
  enforceScope(req: Parameters<RequestHandler>[0], principal: Principal, gate: Gate): Promise<void>;
}): RequestHandler {
  return async (req, _res, next) => {
    try {
      const rule = routeGate(req.method, req.path);
      if (!rule) throw new AuthRejection(403, "ROUTE_NOT_ALLOWED", "This route is not authorized.");
      const { principal, roles } = await dependencies.principal(req);
      if (!permits(roles, rule.capability)) {
        throw new AuthRejection(403, "ROLE_NOT_ALLOWED", "Your role does not allow this action.");
      }
      if (rule.objectScope || rule.assignment) await dependencies.enforceScope(req, principal, rule);
      next();
    } catch (error) { next(error); }
  };
}
