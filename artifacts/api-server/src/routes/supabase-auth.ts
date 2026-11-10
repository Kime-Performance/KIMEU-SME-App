import { Router, type Request } from "express";
import {
  GetSupabaseSessionResponse,
  RequestSupabaseRecoveryBody,
  RequestSupabaseRecoveryResponse,
} from "@workspace/api-zod";
import { resolveRequestActor, type RequestActor } from "../lib/kimeu/auth/actor";
import { staffStore } from "../lib/kimeu/auth/staff-store";
import { requestPasswordReset, RESET_RESPONSE } from "../lib/kimeu/auth/account-operations";
import { createRecoveryLimit } from "../lib/kimeu/auth/recovery-limit";

type Dependencies = {
  actor(req: Request): Promise<RequestActor>;
  recovery(email: string, req: Request): Promise<string>;
  recoveryEnabled(): boolean;
  allowRecovery(address: string, email: string): boolean;
};

const productionDependencies: Dependencies = {
  actor: req => resolveRequestActor(req.get("authorization"), {
    staff: staffStore,
    log: event => req.log.warn({ event }, "Supabase access check"),
  }),
  recovery: (email, req) => requestPasswordReset(email, {
    failure: event => req.log.warn({ event }, "Supabase recovery delivery"),
  }),
  // Do not deliver account emails before the owner-approved cutover. In
  // particular, merely saving anon keys must never enable a recovery flow.
  recoveryEnabled: () => process.env.AUTH_PROVIDER === "supabase",
  allowRecovery: createRecoveryLimit(),
};

/**
 * Separate own-account endpoints, not a fallback authentication provider.
 * Existing business routes continue to use their current login until cutover.
 * Dependency injection lets HTTP tests exercise every rejection without
 * creating accounts, sending mail or mutating clinical data.
 */
export function createSupabaseAuthRouter(dependencies: Dependencies = productionDependencies) {
  const router = Router();
  router.use("/auth/supabase", (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Pragma", "no-cache");
    next();
  });
  router.get("/auth/supabase/session", async (req, res): Promise<void> => {
    const actor = await dependencies.actor(req);
    // Explicit projection: no bearer token, auth-provider email, other staff
    // data, SQL row, or Auth user object may enter this response.
    res.json(GetSupabaseSessionResponse.parse({
      provider: "supabase",
      email: actor.principal.rosterEmail,
      siteRole: actor.principal.siteRole,
      roles: actor.roles,
      personId: actor.personId,
      workshopIds: actor.workshopIds,
    }));
  });
  router.post("/auth/supabase/recovery", async (req, res): Promise<void> => {
    const parsed = RequestSupabaseRecoveryBody.safeParse(req.body);
    // Do not trust forwarded headers: Express's trusted-proxy configuration
    // determines req.ip. A shared proxy address conservatively shares a budget.
    const address = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const email = parsed.success ? parsed.data.email.trim().toLowerCase() : "";
    if (dependencies.allowRecovery(address, email) && parsed.success &&
        email && dependencies.recoveryEnabled()) {
      try {
        await dependencies.recovery(email, req);
      } catch {
        // Even unexpected adapter failures must not enumerate accounts.
        req.log?.warn({ event: "RESET_DELIVERY_FAILED" }, "Supabase recovery delivery");
      }
    }
    res.status(202).json(RequestSupabaseRecoveryResponse.parse({ message: RESET_RESPONSE }));
  });
  return router;
}

export default createSupabaseAuthRouter();
