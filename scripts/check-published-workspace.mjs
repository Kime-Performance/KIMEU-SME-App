/**
 * Non-mutating, signed-out smoke check. This deliberately does not create Clerk
 * users or write attendance. Owner sign-in and password recovery need a separate
 * acceptance check in the published production Clerk environment.
 *
 * node scripts/check-published-workspace.mjs https://<verified-published-host>
 */
const target = process.argv[2];
if (!target) {
  console.error("Provide the published app URL. For local checks only, use http://127.0.0.1:80.");
  process.exit(1);
}
const url = new URL(target);
if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
  throw new Error("Use only the app origin, without credentials, path, query or fragment.");
}
if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
  throw new Error("Use HTTPS, except for a local preview check.");
}
async function get(path) {
  return fetch(new URL(path, url), { redirect: "manual", signal: AbortSignal.timeout(20_000) });
}
for (const path of ["/sign-in", "/sign-up", "/courses/EN-CAD", "/courses/F-SURG-OBS"]) {
  const response = await get(path);
  const html = await response.text();
  if (response.status !== 200 || !html.includes('id="root"')) {
    throw new Error(`${path}: frontend route failed (${response.status}). Check static rewrites/hosting privacy.`);
  }
  console.log(`PASS frontend route ${path}`);
}
const health = await get("/api/healthz");
if (!health.ok) throw new Error(`API health check failed (${health.status}).`);
console.log("PASS API startup/health route");
for (const path of ["/api/kimeu/courses", "/api/kimeu/admin/sme-assignments", "/api/kimeu/onboarding/EN-CAD", "/api/kimeu/onboarding/F-SURG-OBS"]) {
  const response = await get(path);
  if (![401, 403].includes(response.status)) throw new Error(`${path}: expected signed-out denial, got ${response.status}.`);
  if (!response.headers.get("cache-control")?.includes("no-store")) throw new Error(`${path}: private response caching is not disabled.`);
  console.log(`PASS signed-out access blocked, no-store ${path}`);
}
console.log("No user accounts or sheet records were changed. These checks do not verify production invitation, sign-in, password recovery or signed-in permissions.");
