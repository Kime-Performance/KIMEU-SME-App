# KIMEU SME publishing handoff

## Prepared application configuration

- Web artifact is mounted at `/`, serves `artifacts/kimeu-sme-app/dist/public`, and rewrites frontend routes to `index.html`.
- API artifact is mounted at `/api`, builds the Express bundle, starts with `NODE_ENV=production`, and checks `/api/healthz`.
- The authentication proxy is beneath the API path, so the existing router includes it. Managed Clerk resolves keys from the request host and Replit supplies the production environment when published; do not copy development keys into production.
- `VITE_CLERK_PROXY_URL` is intentionally absent in preview and automatically supplied by the publishing system. Do not set it manually or hardcode the proxy URL.
- Signed-out users cannot read staff data. Verified corporate email, active approved sheet entry and a site-access role are required on the server. API responses beneath `/api/kimeu` are private and `no-store`.
- Development-only mockup tooling has no production service configured.
- Publishing has NOT been performed. No published URL exists until publishing succeeds.

## Owner actions in managed Clerk

The owner must use the authorized Clerk dashboard for the **Production** environment. These provider settings cannot be configured by changing app code, and have not been verified here.

1. Enable email/password sign-in, including the account verification and password-recovery experience.
2. Restrict registration to invited users. The app hides ordinary public registration, but provider-level Restricted/invitation-only registration must also be set.
3. Invite/create the owner's production administrator account using the exact email of the existing approved Admin sheet entry. Use the provider's password-setup flow; never share a default or administrator password.
4. Invite approved SMEs/RDs to production as needed. Their verified primary email must match an active approved staff entry. Email domain alone does not grant access.

Development and production Clerk identities, sessions and passwords are separate. The preview administrator account is not proof that a production account exists. Do not change the app's sheet-based role storage or create a separate metadata-based Admin role.

## Publishing visibility and sheet destination

- In Publishing, choose **Public** hosting so Christine and Kajabi users can reach the sign-in page without Replit collaborator access. Keep the app's own authentication and approved-staff authorization enabled.
- This hosting selection is an owner action and has not been applied by this preparation.
- Keep the shared `KIMEU_SHEET_ID` pointed at the existing test copy. Publishing alone does not enable live-master input writes.
- The requested Cadaver Lab/Surgical Observation integration into the live Foundations and Summary tabs, and the separate Clinician Development app's reader changes, are not completed by this publishing preparation. Confirm completion/grandfathering policy and verify the integration separately before live workshop use.
- Google Calendar remains a read-only occurrence reference; attendance comes from the app.

## Acceptance after publishing

Retrieve the actual published URL from Publishing, not the `.replit.dev` preview address. Check in a separate browser:

1. Signed-out visitors see sign-in, not PT information. `/sign-up` without an invitation shows the invitation-only message.
2. Accept the owner's production invitation, set the password and sign in. Confirm Admin Settings works.
3. An authenticated but unapproved account cannot enter. An approved SME/RD receives only its allowed course/PT access.
4. Test production invitation acceptance, password recovery, sign-out, and a permitted save/readback using an agreed test PT in the test-copy sheet.
5. Confirm removing staff approval prevents further API access.

Run this additional **read-only signed-out check**:

```sh
node scripts/check-published-workspace.mjs https://<actual-published-host>
```

It tests frontend deep links, API health, signed-out denials and private-response cache headers; it does not test production Clerk account operations or authorize live writes.

## Christine / Kajabi

Send the published URL after the acceptance checks. Suggested label: **Open KIMEU SME Workspace**.

Christine can add it as an external link opening in a new tab without a Replit account or SME account. She only needs separately approved app access if she must enter the workspace to test it. Do not send administrator credentials, invitation tokens or an access-bypass URL, and do not embed the private workspace in a Kajabi iframe.
