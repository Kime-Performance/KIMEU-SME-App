import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const result = await build({
  entryPoints: ["../kimeu-sme-app/src/auth/provider.ts"],
  absWorkingDir: new URL("..", import.meta.url).pathname,
  bundle: true, platform: "node", format: "esm", write: false,
  define: { "import.meta.env.VITE_AUTH_PROVIDER": "undefined" },
});
const policy = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

test("frontend provider has one explicit branch and rejects typos rather than falling back", () => {
  for (const raw of [undefined, null, "", "clerk"]) {
    assert.deepEqual(policy.selectAuthProvider(raw), { ok: true, provider: "clerk" });
  }
  assert.deepEqual(policy.selectAuthProvider("supabase"), { ok: true, provider: "supabase" });
  for (const raw of ["Supabase", "supabase ", "auto", "unknown"]) {
    assert.equal(policy.selectAuthProvider(raw).ok, false);
  }
});

test("PT write controls cannot be resurrected by an accidental assignment", () => {
  assert.equal(policy.isReadOnlyPt(["Admin"], { siteRole: "PT" }), true);
  assert.equal(policy.isSiteAdmin({ siteRole: "CEU Admin", roles: ["Admin"] }), false);
  assert.equal(policy.isSiteAdmin({ siteRole: "Admin", roles: ["Fellowship Reviewer"] }), true);
});

test("all supported site roles can see read-only own/staff result surfaces", () => {
  for (const siteRole of ["PT", "RD", "SME Assist", "SME Lead", "Fellowship Reviewer", "CEU Admin", "Admin"]) {
    assert.equal(policy.foundationsAccess({ siteRole, roles: [] }).read, true);
    assert.equal(policy.fellowshipAccess({ siteRole, roles: [] }).read, true);
  }
});

test("assessment and review UI use the explicit ceiling matrix, never a linear role rank", () => {
  for (const siteRole of ["Admin", "RD", "SME Lead", "Fellowship Reviewer"]) {
    assert.equal(policy.foundationsAccess({ siteRole, roles: [] }).write, true);
  }
  for (const siteRole of ["PT", "SME Assist", "CEU Admin"]) {
    assert.equal(policy.foundationsAccess({ siteRole, roles: ["Admin"] }).write, false);
    assert.equal(policy.fellowshipAccess({ siteRole, roles: ["Fellowship Reviewer"] }).write, false);
  }
  assert.equal(policy.fellowshipAccess({ siteRole: "RD", roles: [] }).write, false);
  assert.equal(policy.fellowshipAccess({ siteRole: "SME Lead", roles: [] }).write, false);
});

test("UI recognizes only exact authorization failures as access revocation", () => {
  assert.equal(policy.isAuthRejection({ status: 401 }), true);
  assert.equal(policy.isAuthRejection({ status: 403 }), true);
  assert.equal(policy.isAuthRejection({ status: 503 }), false);
  assert.equal(policy.isAuthRejection(new Error("Network failure")), false);
});
