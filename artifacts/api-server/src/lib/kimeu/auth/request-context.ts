import type { Request } from "express";
import { AuthRejection } from "./identity";
import { resolveRequestActor, type RequestActor } from "./actor";
import { staffStore } from "./staff-store";

const actors = new WeakMap<Request, Promise<RequestActor>>();

/** Explicit provider selection, never a fallback on authentication failure. */
export function usesSupabaseAuth(): boolean {
  const provider = process.env.AUTH_PROVIDER;
  if (provider && provider !== "clerk" && provider !== "supabase") {
    throw new AuthRejection(503, "AUTH_NOT_CONFIGURED", "Sign-in is temporarily unavailable.");
  }
  return provider === "supabase";
}

/** Deduplicate within ONE request only; the next request re-verifies remotely. */
export function requestActor(req: Request): Promise<RequestActor> {
  let actor = actors.get(req);
  if (!actor) {
    actor = resolveRequestActor(req.get("authorization"), {
      staff: staffStore,
      log: event => req.log.warn({ event }, "KIMEU access decision"),
    });
    actors.set(req, actor);
  }
  return actor;
}
