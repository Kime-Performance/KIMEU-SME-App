import assert from "node:assert/strict";
import test from "node:test";
import { canLeadStage, canonicalRole, hasSiteRole, verifiedPrimaryEmail } from "../src/lib/kimeu/site-access-policy.ts";

test("only approved SME, RD, Fellowship Reviewer and Admin roles grant site access", () => {
  for (const role of ["SME Assist", "SME Lead", "Foundations SME", "Elite SME", "RD", "Fellowship Reviewer", "Admin"]) assert.equal(hasSiteRole([role]), true);
  for (const roles of [[], ["CEU Admin"], ["admin"], ["Unknown"]]) assert.equal(hasSiteRole(roles), false);
  assert.equal(hasSiteRole(["Fellowship Reviewer", "RD"]), true);
});
test("SME titles enforce pathway responsibility without breaking legacy assignments", () => {
  assert.equal(canonicalRole("Foundations SME"), "SME Assist");
  assert.equal(canonicalRole("Elite SME"), "SME Lead");
  assert.equal(canLeadStage(["SME Assist"], "Foundations"), true);
  assert.equal(canLeadStage(["Foundations SME"], "Foundations"), true);
  assert.equal(canLeadStage(["SME Assist"], "Fellowship"), false);
  assert.equal(canLeadStage(["SME Lead"], "Fellowship"), true);
  assert.equal(canLeadStage(["SME Lead"], "Foundations"), false);
  assert.equal(canLeadStage(["Admin"], "Foundations"), true);
});

test("email authentication requires the verified primary address, never a secondary fallback", () => {
  const user = { primaryEmailAddressId: "primary", emailAddresses: [
    { id: "primary", emailAddress: "SME@kimeperformance.com", verification: { status: "unverified" } },
    { id: "secondary", emailAddress: "rd@kimeperformance.com", verification: { status: "verified" } },
  ] };
  assert.equal(verifiedPrimaryEmail(user), null);
  user.emailAddresses[0].verification.status = "verified";
  assert.equal(verifiedPrimaryEmail(user), "sme@kimeperformance.com");
  user.primaryEmailAddressId = null;
  assert.equal(verifiedPrimaryEmail(user), null);
});
