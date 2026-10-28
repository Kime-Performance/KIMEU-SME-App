import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const directory = await mkdtemp(join(tmpdir(), "kimeu-access-"));
await build({
  entryPoints: [new URL("../src/lib/kimeu/access.ts", import.meta.url).pathname],
  outfile: join(directory, "access.mjs"), bundle: true, platform: "node", format: "esm",
  plugins: [{ name: "isolated-identity-and-sheet", setup(b) {
    b.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: "clerk", namespace: "fixture" }));
    b.onResolve({ filter: /^@replit\/connectors-sdk$/ }, () => ({ path: "sheets", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
      contents: path === "clerk"
        ? "export const clerkClient={users:{getUser:async()=>globalThis.__siteIdentity}}; export function getAuth(req){return {userId:req.fixtureUid}};"
        : "export class ReplitConnectors {async proxy(){return Response.json({values:globalThis.__siteUsers})}}",
    }));
  } }],
});
const original = process.env.KIMEU_SHEET_ID;
process.env.KIMEU_SHEET_ID = "isolated-access-test";
const { requireActiveAppUser, getBootstrapForRequest } = await import(pathToFileURL(join(directory, "access.mjs")).href);
const req = { fixtureUid: "fixture-user" };
const reset = () => {
  globalThis.__siteIdentity = {
    primaryEmailAddressId: "primary",
    emailAddresses: [{ id: "primary", emailAddress: "fixture@kimeperformance.com", verification: { status: "verified" } }],
  };
  globalThis.__siteUsers = [
    [], ["Email", "Name in Sheets", "App Role(s)", "Workshop IDs", "Active"],
    ["fixture@kimeperformance.com", "Fixture SME", "Foundations SME", "F-TEST", "Yes"],
  ];
};
test("valid SME/RD/Admin can authenticate; fresh sheet reads enforce immediate revocation", async () => {
  for (const role of ["Foundations SME", "Elite SME", "RD", "Admin"]) {
    reset();
    globalThis.__siteUsers[2][2] = role;
    const canonical = role === "Foundations SME" ? "SME Assist" : role === "Elite SME" ? "SME Lead" : role;
    assert.deepEqual((await requireActiveAppUser(req)).roles, [canonical]);
    globalThis.__siteUsers[2][4] = "No";
    await assert.rejects(requireActiveAppUser(req), { code: "APP_USER_INACTIVE" });
  }
});
test("a corporate address does not grant access without an approved site role and active row", async () => {
  for (const role of ["", "CEU Admin", "Fellowship Reviewer"]) {
    reset();
    globalThis.__siteUsers[2][2] = role;
    await assert.rejects(requireActiveAppUser(req), { code: "SITE_ROLE_NOT_ALLOWED" });
  }
  reset();
  globalThis.__siteUsers.pop();
  await assert.rejects(requireActiveAppUser(req), { code: "APP_USER_INACTIVE" });
});
test("anonymous, unverified and external-domain identities cannot access data", async () => {
  reset();
  await assert.rejects(requireActiveAppUser({}), { code: "SIGN_IN_REQUIRED" });
  globalThis.__siteIdentity.emailAddresses[0].verification.status = "unverified";
  await assert.rejects(requireActiveAppUser(req), { code: "EMAIL_REQUIRED" });
  reset();
  globalThis.__siteIdentity.emailAddresses[0].emailAddress = "fixture@example.test";
  await assert.rejects(requireActiveAppUser(req), { code: "DOMAIN_NOT_ALLOWED" });
});
test("unrelated sheet readiness failures do not revoke a freshly approved user's workspace", async () => {
  reset();
  // The transport supplies only staff headers, so the other log-tab readiness
  // probes fail their schema checks. Staff approval itself is still fresh.
  const bootstrap = await getBootstrapForRequest(req);
  assert.equal(bootstrap.readiness.configured, false);
  assert.equal(bootstrap.access, "allowed");
  assert.ok(bootstrap.user.roles.includes("SME Assist"));
  globalThis.__siteUsers[2][4] = "No";
  const revoked = await getBootstrapForRequest(req);
  assert.equal(revoked.access, "inactive");
  assert.equal(revoked.user, null);
});
test.after(async () => {
  if (original === undefined) delete process.env.KIMEU_SHEET_ID;
  else process.env.KIMEU_SHEET_ID = original;
  delete globalThis.__siteIdentity;
  delete globalThis.__siteUsers;
  await rm(directory, { recursive: true, force: true });
});
