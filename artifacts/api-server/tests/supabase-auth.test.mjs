import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";

async function load(entry) {
  const b = await build({
    entryPoints: [`src/lib/kimeu/auth/${entry}.ts`],
    absWorkingDir: new URL("..", import.meta.url).pathname,
    bundle: true, platform: "node", format: "esm", write: false,
    plugins: [{ name: "no-auth-network", setup(builder) {
      builder.onResolve({ filter: /^\.\/clients$/ }, () => ({ path: "clients", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
        contents: "export function requestAuthClient(){throw new Error('No network permitted in unit tests')}",
      }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].text).toString("base64")}`);
}
const policy = await load("policy");
const identity = await load("identity");
const routes = await load("route-policy");
const { reconcileAccess } = await load("reconciliation");
const operations = await load("account-operations");
const { createAccessStore } = await load("access-store");

for (const raw of [null, "", " ", "Unknown", "PT, Admin", "Foundations SME", "PT|Admin"]) {
  test(`invalid site role fails closed: ${JSON.stringify(raw)}`, () => assert.equal(policy.siteRole(raw), null));
}
test("site roles are exact, trimmed, case insensitive", () => {
  assert.equal(policy.siteRole(" sme LEAD "), "SME Lead");
  assert.equal(policy.siteRole(" rd "), "RD");
});
test("PT ceiling never inherits staff writes", () => {
  const roles = policy.effectiveRoles("PT", ["Admin", "SME Lead", "RD"]);
  assert.deepEqual(roles, ["PT"]);
  for (const cap of ["attendance", "practical", "onboarding", "assessment", "review", "admin", "note"]) {
    assert.equal(policy.permits(roles, cap), false);
  }
});
test("missing capability assignments fail closed for staff", () => {
  assert.deepEqual(policy.effectiveRoles("Admin", []), []);
  assert.deepEqual(policy.effectiveRoles("RD", ["garbage", "CEU Admin"]), []);
});
test("legacy assignments canonicalize but are not accepted site roles", () => {
  assert.deepEqual(policy.effectiveRoles("SME Lead", ["Elite SME", "Foundations SME"]), ["SME Lead", "SME Assist"]);
});
test("RD keeps sign-offs without SME attendance or admin rights", () => {
  const roles = policy.effectiveRoles("RD", ["RD"]);
  for (const cap of ["practical", "onboarding", "assessment"]) assert.equal(policy.permits(roles, cap), true);
  for (const cap of ["attendance", "admin", "review"]) assert.equal(policy.permits(roles, cap), false);
});
test("stage leadership preserves existing rules", () => {
  assert.equal(policy.mayLead(["SME Assist"], "Advanced"), false);
  assert.equal(policy.mayLead(["SME Lead"], "Advanced"), true);
  assert.equal(policy.mayLead(["SME Lead"], "Foundations"), false);
  assert.equal(policy.mayLead(["SME Assist"], "Foundations"), true);
});
test("PT is self-only and RD scope is org-wide without a region prerequisite", () => {
  const actor = { personId: "actor", region: " West " };
  assert.equal(policy.withinScope("PT", actor, actor), true);
  assert.equal(policy.withinScope("PT", actor, { personId: "other", region: "West" }), false);
  assert.equal(policy.withinScope("RD", actor, { personId: "other", region: "west" }), true);
  assert.equal(policy.withinScope("RD", actor, { personId: "other", region: "East" }), true);
  assert.equal(policy.withinScope("RD", null, actor), true);
  assert.equal(policy.withinScope("PT", null, actor), false);
  assert.equal(policy.withinScope("RD", null, null), false);
});
test("CEU Admin is supported but never gains clinical or user-management rights", () => {
  assert.equal(policy.siteRole(" ceu ADMIN "), "CEU Admin");
  const roles = policy.effectiveRoles("CEU Admin", ["CEU Admin", "Admin", "RD"]);
  assert.deepEqual(roles, ["CEU Admin"]);
  assert.equal(policy.permits(roles, "course-admin"), true);
  for (const cap of ["read", "note", "attendance", "practical", "onboarding", "assessment", "review", "admin"]) {
    assert.equal(policy.permits(roles, cap), false);
  }
  assert.equal(policy.withinScope("CEU Admin", null, { personId: "other" }), false);
  assert.equal(policy.mayLead(roles, "Foundations"), false);
  assert.equal(routes.routeGate("POST", "/auth/invite"), undefined);
});
test("unknown routes, unknown methods and dev-readiness have no gate", () => {
  for (const [method, path] of [["GET", "/new-route"], ["DELETE", "/kimeu/courses"], ["GET", "/kimeu/dev-readiness"]]) {
    assert.equal(routes.routeGate(method, path), undefined);
  }
});
test("every registered business route has an explicit gate", async () => {
  for (const file of ["kimeu", "course-tracking", "onboarding-admin", "fellowship-reviews", "foundations-assessment"]) {
    const text = await readFile(new URL(`../src/routes/${file}.ts`, import.meta.url), "utf8");
    for (const m of text.matchAll(/router\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)) {
      if (m[2] === "/kimeu/dev-readiness") continue; // intentionally removed at cutover
      const path = m[2].replace(/:[^/]+/g, "fixture-id");
      assert.ok(routes.routeGate(m[1].toUpperCase(), path), `${m[1]} ${m[2]}`);
    }
  }
});
test("PT denied on every registered write route", () => {
  for (const gate of routes.ROUTE_GATES.filter(g => g.method !== "GET")) {
    if (gate.path.test("/auth/sign-out")) continue;
    assert.equal(policy.permits(["PT"], gate.capability), false, gate.path.toString());
  }
});
test("deny-by-default middleware does not even resolve identity for unknown routes", async () => {
  const middleware = routes.denyByDefault({
    principal: async () => { throw new Error("Must not resolve"); },
    enforceScope: async () => { throw new Error("Must not scope"); },
  });
  let rejection;
  await middleware({ method: "POST", path: "/new-route" }, {}, e => { rejection = e; });
  assert.equal(rejection?.code, "ROUTE_NOT_ALLOWED");
});
test("object-scoped request cannot skip scope callback", async () => {
  let calls = 0, rejection;
  const middleware = routes.denyByDefault({
    principal: async () => ({ principal: { authUserId: "actor", siteRole: "PT" }, roles: ["PT"] }),
    enforceScope: async () => { calls++; throw new Error("Out of scope"); },
  });
  await middleware({ method: "GET", path: "/kimeu/sessions/test" }, {}, e => { rejection = e; });
  assert.equal(calls, 1); assert.equal(rejection.message, "Out of scope");
});
for (const header of [undefined, "", "Basic abc", "Bearer token extra", "Bearer x,y"]) {
  test(`invalid authorization header: ${JSON.stringify(header)}`, async () => {
    await assert.rejects(identity.verifiedIdentity(header), e => e.status === 401);
  });
}
test("getUser verifies each request with a new client, no token decoding", async () => {
  let factories = 0;
  const factory = () => {
    factories++;
    return { auth: { getUser: async token => ({
      error: null, data: { user: { id: token, email: `${token}@example.test`, email_confirmed_at: "confirmed" } },
    }) } };
  };
  assert.equal((await identity.verifiedIdentity("Bearer alice", factory)).authUserId, "alice");
  assert.equal((await identity.verifiedIdentity("Bearer bob", factory)).authUserId, "bob");
  assert.equal(factories, 2);
});
for (const label of ["expired", "tampered", "wrong-project"]) {
  test(`Auth-server rejection is 401: ${label}`, async () => {
    await assert.rejects(identity.verifiedIdentity(`Bearer ${label}`, () => ({
      auth: { getUser: async () => ({ data: { user: null }, error: { message: label } }) },
    })), e => e.status === 401);
  });
}
test("unconfirmed email rejected before any binding", async () => {
  await assert.rejects(identity.verifiedIdentity("Bearer token", () => ({
    auth: { getUser: async () => ({ data: { user: { id: "id", email: "test@example.test" } }, error: null }) },
  })), e => e.status === 403 && e.code === "EMAIL_REQUIRED");
});
test("Auth outage is explicit and never grants access", async () => {
  await assert.rejects(identity.verifiedIdentity("Bearer token", () => { throw new Error("network"); }), e => e.status === 503);
});
const actor = { authUserId: "actor", verifiedEmail: "verified@example.test", accessToken: "session-jwt" };
const row = { auth_user_id: "actor", email: "old@example.test", kimeu_sme: "RD" };
test("already bound user resolves by auth ID after Auth email changes", async () => {
  const result = await identity.resolvePrincipal(actor, {
    ownRoles: async identity => { assert.equal(identity.authUserId, "actor"); return [row]; },
  }, () => {});
  assert.deepEqual(result, { authUserId: "actor", siteRole: "RD" });
});
test("unbound account fails pending setup without any write or email fallback", async () => {
  let alerts = 0;
  await assert.rejects(identity.resolvePrincipal(actor, {
    ownRoles: async () => [],
  }, () => { alerts++; }), e => e.status === 403 && e.code === "ACCOUNT_PENDING");
  assert.equal(alerts, 1);
});
test("role read uses only own-row SELECT with the verified user's session JWT", async () => {
  const calls = [];
  const store = createAccessStore(token => {
    calls.push(["jwt", token]);
    return { from: table => {
      calls.push(["from", table]);
      return { select: columns => {
        calls.push(["select", columns]);
        return { eq: async (column, id) => {
          calls.push(["eq", column, id]);
          return { data: [{ kimeu_sme: "RD" }], error: null };
        } };
      } };
    } };
  });
  assert.equal((await identity.resolvePrincipal(actor, store, () => {})).siteRole, "RD");
  assert.deepEqual(calls, [
    ["jwt", "session-jwt"], ["from", "user_access"],
    ["select", "kimeu_sme"], ["eq", "auth_user_id", "actor"],
  ]);
});
test("role lookup errors and ambiguous own rows fail closed", async () => {
  await assert.rejects(identity.resolvePrincipal(actor, {
    ownRoles: async () => { throw new Error("network"); },
  }, () => {}), e => e.code === "ROLE_UNAVAILABLE");
  await assert.rejects(identity.resolvePrincipal(actor, {
    ownRoles: async () => [row, row],
  }, () => {}), e => e.code === "ACCOUNT_PENDING");
});
test("role blanking revokes on next request, no role cache", async () => {
  let role = "RD";
  const store = { ownRoles: async () => [{ ...row, kimeu_sme: role }] };
  await identity.resolvePrincipal(actor, store, () => {});
  role = "";
  await assert.rejects(identity.resolvePrincipal(actor, store, () => {}), e => e.status === 403);
});
test("cutover flag unset/off cannot enable candidate authentication", () => {
  const before = process.env.AUTH_PROVIDER;
  try {
    for (const value of ["", "clerk", "false"]) {
      process.env.AUTH_PROVIDER = value;
      assert.throws(identity.requireSupabaseProvider, e => e.status === 503);
    }
    process.env.AUTH_PROVIDER = "supabase";
    assert.doesNotThrow(identity.requireSupabaseProvider);
  } finally {
    if (before === undefined) delete process.env.AUTH_PROVIDER; else process.env.AUTH_PROVIDER = before;
  }
});
test("reconciliation flags missing identities and missing administrator retention without mutations", () => {
  const staff = [{ email: null, name_in_sheets: "Unknown", active: true, app_roles: "Admin", workshop_ids: "" }];
  const before = JSON.stringify(staff);
  const report = reconcileAccess(staff, []);
  assert.equal(report.enforcementApproved, false);
  assert.equal(report.summary.activeWithEffectiveAdmin, 0);
  assert.ok(report.accounts[0].issues.includes("MISSING_STAFF_EMAIL"));
  assert.equal(JSON.stringify(staff), before);
});
test("app exposes no invitation operation; Oracle owns invitations", () => {
  assert.equal(operations.inviteApprovedUser, undefined);
  assert.equal(routes.routeGate("POST", "/auth/invite"), undefined);
});
test("password-reset response is identical on provider success, rejection, and outage", async () => {
  for (const state of ["known", "unknown", "outage"]) {
    const response = await operations.requestPasswordReset("approved@example.test", {
      failure: () => {},
      redirect: () => "https://example.test/accept",
      client: () => ({ auth: { resetPasswordForEmail: async () => {
        if (state === "outage") throw new Error("Network failed");
        return { error: state === "unknown" ? { message: "No account" } : null };
      } } }),
    });
    assert.equal(response, operations.RESET_RESPONSE);
  }
});
