import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(new URL("../package.json", import.meta.url));
const express = require("express");
const built = await build({
  stdin: {
    contents: `
      export {createSupabaseAuthRouter} from "./src/routes/supabase-auth";
      export {AuthRejection} from "./src/lib/kimeu/auth/identity";
      export {createRecoveryLimit} from "./src/lib/kimeu/auth/recovery-limit";
    `,
    resolveDir: new URL("..", import.meta.url).pathname,
    loader: "ts",
  },
  bundle: true, platform: "node", format: "cjs", write: false,
  external: ["express"],
  plugins: [{ name: "no-production-io", setup(builder) {
    builder.onResolve({ filter: /\/auth\/(actor|staff-store)$/ }, args => ({
      path: args.path.endsWith("actor") ? "actor" : "staff", namespace: "fixture",
    }));
    builder.onResolve({ filter: /^\.\/clients$/ }, () => ({ path: "client", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
      contents: args.path === "actor"
        ? "export function resolveRequestActor(){throw new Error('Production identity IO forbidden in HTTP tests')}"
        : args.path === "staff" ? "export const staffStore={}"
        : "export function requestAuthClient(){throw new Error('Auth network forbidden in HTTP tests')}",
    }));
  } }],
});
const module = { exports: {} };
new Function("require", "module", "exports", built.outputFiles[0].text)(require, module, module.exports);
const { createSupabaseAuthRouter, AuthRejection, createRecoveryLimit } = module.exports;
const acknowledgement = { message: "If that account exists, we've emailed a reset link." };
const actor = {
  principal: { authUserId: "internal-auth-id", siteRole: "RD", rosterEmail: "roster@example.test" },
  roles: ["RD"], personId: "own-person", workshopIds: ["FW-UE"],
  accessToken: "MUST_NOT_LEAK", unrelated: { sensitive: true },
};

async function withHttp(overrides, action) {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use(createSupabaseAuthRouter({
    actor: async req => { calls.push(req.get("authorization")); return actor; },
    recovery: async email => { calls.push(email); return acknowledgement.message; },
    recoveryEnabled: () => true,
    allowRecovery: () => true,
    ...overrides,
  }));
  app.use((error, _req, res, _next) => {
    res.status(error instanceof AuthRejection ? error.status : 500).json({
      error: error.message, code: error.code,
    });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await action(base, calls);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test("HTTP session endpoint projects only own account and disables caching", async () => {
  await withHttp({}, async (base, calls) => {
    const response = await fetch(`${base}/auth/supabase/session`, {
      headers: { Authorization: "Bearer request-token" },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.equal(response.headers.get("pragma"), "no-cache");
    assert.deepEqual(await response.json(), {
      provider: "supabase", email: "roster@example.test",
      siteRole: "RD", roles: ["RD"], personId: "own-person", workshopIds: ["FW-UE"],
    });
    assert.deepEqual(calls, ["Bearer request-token"]);
  });
});

test("HTTP session identity is re-resolved, never cached across requests", async () => {
  let attempts = 0;
  await withHttp({ actor: async () => {
    if (++attempts === 2) throw new AuthRejection(401, "SIGN_IN_REQUIRED", "Sign in to continue.");
    return actor;
  } }, async base => {
    assert.equal((await fetch(`${base}/auth/supabase/session`)).status, 200);
    assert.equal((await fetch(`${base}/auth/supabase/session`)).status, 401);
  });
  assert.equal(attempts, 2);
});

for (const [status, code] of [[401, "SIGN_IN_REQUIRED"], [403, "ACCOUNT_PENDING"], [503, "ASSIGNMENTS_UNAVAILABLE"]]) {
  test(`HTTP session preserves ${status} ${code} without returning identity`, async () => {
    await withHttp({ actor: async () => { throw new AuthRejection(status, code, "Request denied."); } },
      async base => {
        const response = await fetch(`${base}/auth/supabase/session`);
        assert.equal(response.status, status);
        assert.deepEqual(await response.json(), { error: "Request denied.", code });
      });
  });
}

test("recovery normalizes email and ignores caller redirect input", async () => {
  await withHttp({}, async (base, calls) => {
    const response = await fetch(`${base}/auth/supabase/recovery`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "  PERSON@Example.Test  ", redirectTo: "https://evil.test" }),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), acknowledgement);
    // Zod strips unknown fields; adapter receives only the normalized email.
    assert.deepEqual(calls, ["person@example.test"]);
  });
});

for (const [label, overrides, body] of [
  ["disabled before cutover", { recoveryEnabled: () => false }, { email: "someone@example.test" }],
  ["rate limited", { allowRecovery: () => false }, { email: "someone@example.test" }],
  ["invalid body", {}, { email: 123 }],
  ["empty email", {}, { email: "" }],
  ["overlong email", {}, { email: "x".repeat(255) }],
]) {
  test(`recovery ${label} acknowledges without sending mail`, async () => {
    await withHttp(overrides, async (base, calls) => {
      const response = await fetch(`${base}/auth/supabase/recovery`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      assert.equal(response.status, 202);
      assert.match(response.headers.get("cache-control"), /no-store/);
      assert.deepEqual(await response.json(), acknowledgement);
      assert.deepEqual(calls, []);
    });
  });
}

test("unexpected recovery failure still returns the identical acknowledgement", async () => {
  await withHttp({ recovery: async () => { throw new Error("Provider detail must not leak"); } }, async base => {
    const response = await fetch(`${base}/auth/supabase/recovery`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "someone@example.test" }),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), acknowledgement);
  });
});

test("there is no public signup, invite or identity-binding route", async () => {
  await withHttp({}, async base => {
    for (const path of ["signup", "invite", "bind"]) {
      assert.equal((await fetch(`${base}/auth/supabase/${path}`, { method: "POST" })).status, 404);
    }
  });
});

test("recovery budgets normalize accounts, expire, and include source/global limits", () => {
  let now = 0;
  const allow = createRecoveryLimit(() => now);
  for (let i = 0; i < 3; i++) assert.equal(allow("ip", "NAME@example.test"), true);
  assert.equal(allow("another-ip", " name@EXAMPLE.test "), false);
  for (let i = 0; i < 7; i++) assert.equal(allow("ip", `other-${i}@example.test`), true);
  assert.equal(allow("ip", "another@example.test"), false);
  now += 15 * 60 * 1000;
  assert.equal(allow("ip", "name@example.test"), true);
  const globalLimit = createRecoveryLimit(() => now);
  for (let i = 0; i < 100; i++) assert.equal(globalLimit(`ip-${i}`, `email-${i}`), true);
  assert.equal(globalLimit("ip-101", "email-101"), false);
});
