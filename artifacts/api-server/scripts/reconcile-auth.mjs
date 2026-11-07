// Retired by the owner's 2026-11-07 Global Rule 3 amendment.
// Oracle supplies cross-account reconciliation. The app reads only its user's
// own role with that user's verified JWT through own-row RLS.
console.error("Reconciliation is supplied by Oracle. This command no longer queries user_access. Await the updated owner-reviewed package.");
process.exitCode = 1;
