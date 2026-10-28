import assert from "node:assert/strict";
import test from "node:test";
import { hasSiteRole, verifiedPrimaryEmail } from "../src/lib/kimeu/site-access-policy.ts";

test("only SME, RD and Admin roles grant site access", () => {
  for (const role of ["Foundations SME", "Elite SME", "RD", "Admin"]) assert.equal(hasSiteRole([role]), true);
  for (const roles of [[], ["CEU Admin"], ["Fellowship Reviewer"], ["admin"], ["Unknown"]]) assert.equal(hasSiteRole(roles), false);
  assert.equal(hasSiteRole(["Fellowship Reviewer", "RD"]), true);
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
