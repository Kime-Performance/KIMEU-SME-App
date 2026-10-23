import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { KimeuError } from "./lib/kimeu/sheets";
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
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use(((error, req, res, _next) => {
  if (error instanceof KimeuError) {
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
