import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { KimeuError } from "./lib/kimeu/sheets";
import { AuthRejection } from "./lib/kimeu/auth/identity";
import supabaseAuthRouter from "./routes/supabase-auth";
import { businessBoundary } from "./lib/kimeu/auth/business-boundary";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Own-account Supabase probes must verify their bearer with Supabase, not
// first pass it to Clerk. This router does not authenticate business routes.
app.use("/api", supabaseAuthRouter);
// Deterministic staged selection. Supabase requests never fall back to Clerk.
if (process.env.AUTH_PROVIDER !== "supabase") {
  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
  app.use(
    clerkMiddleware((req) => ({
      publishableKey: publishableKeyFromHost(
        getClerkProxyHost(req) ?? "",
        process.env.CLERK_PUBLISHABLE_KEY,
      ),
    })),
  );
}

// Staff records, notes, access decisions and attendance must not be retained by
// browsers or shared intermediary caches on the publicly reachable deployment.
app.use("/api/kimeu", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Pragma", "no-cache");
  next();
});
app.use("/api", businessBoundary, router);
app.use(((error, req, res, _next) => {
  if (error instanceof KimeuError || error instanceof AuthRejection) {
    req.log.warn(
      { code: error.code, status: error.status },
      "KIMEU request rejected",
    );
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  req.log.error(
    { errorName: error instanceof Error ? error.name : "UnknownError" },
    "KIMEU request failed",
  );
  res.status(500).json({
    error: "The KIMEU request could not be completed.",
    code: "INTERNAL_ERROR",
  });
}) as ErrorRequestHandler);

export default app;
