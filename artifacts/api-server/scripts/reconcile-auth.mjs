// READ ONLY. Does not bind accounts, invite users, or update roles.
// Run: node artifacts/api-server/scripts/reconcile-auth.mjs
import { build } from "esbuild";
import postgres from "postgres";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const server = fileURLToPath(new URL("..", import.meta.url));
const root = path.resolve(server, "../..");
async function load(relative) {
  const result = await build({
    entryPoints: [path.join(server, relative)], bundle: true, platform: "node",
    format: "esm", write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const { truthDatabaseConnectionOptions } = await load("src/lib/kimeu/db/connection-options.ts");
const { reconcileAccess } = await load("src/lib/kimeu/auth/reconciliation.ts");
const { connectionString, options } = truthDatabaseConnectionOptions(
  process.env.KIMEU_TRUTH_DATABASE_URL, process.env.KIMEU_TRUTH_DATABASE_CA_CERT,
);
const sql = postgres(connectionString, options);
try {
  // Await sequentially: this pooler requires nonoverlapping ordinary reads.
  const staff = await sql`
    select email, name_in_sheets, active, app_roles, workshop_ids
    from public.kimeu_app_users where deleted_at is null
  `;
  const access = await sql`
    select email, auth_user_id, kimeu_sme from public.user_access
  `;
  const report = { generatedAt: new Date().toISOString(), ...reconcileAccess(staff, access) };
  const dir = path.join(root, "generated-artifacts", "auth-review");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "sme-account-reconciliation.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  const safe = value => String(value ?? "—").replace(/[|\r\n]/g, " ");
  const md = [
    "# SME authentication reconciliation — owner review required",
    "",
    `Generated: ${report.generatedAt}. Read-only database inspection; no bindings, roles or sessions changed.`,
    "",
    "**Not an enforcement approval.** The report compares staff to the synchronized database field, not the source sheet. Auth IDs are binding state, not proof of an Auth account's existence, confirmation, or current login availability.",
    "",
    ...Object.entries(report.summary).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Staff outcomes",
    "| Staff | Email | Active | Assigned roles | Site role | Effective roles | Binding | Issues |",
    "|---|---|---|---|---|---|---|---|",
    ...report.accounts.map(a => `| ${safe(a.name)} | ${safe(a.email)} | ${a.active === true} | ${safe(a.assignedRoles.join(", "))} | ${safe(a.siteRole)} | ${safe(a.effectiveRoles.join(", "))} | ${a.authUserId ? "Bound" : "Unbound"} | ${safe(a.issues.join(", "))} |`),
    "",
    "## Database role census",
    ...report.databaseRoleCensus.map(c => `- ${safe(c.value)}: ${c.count}`),
    "",
    "## Review before cutover",
    "- Confirm every retained staff role and workshop assignment, especially administrators.",
    "- Resolve missing staff emails; no name-based or fuzzy identity binding.",
    "- Confirm source-sheet role values and import behavior.",
    "- Confirm Auth-account readiness separately; first-login binding runs only after verified authentication.",
    "- Confirm RD-to-PT region mapping: providers.region does not exist in the inspected schema.",
    "- Confirm stable auth-user-to-person/staff linkage for object checks; email changes must not transfer access.",
    "- Complete public/client authentication configuration and isolated authorization tests before activation.",
  ].join("\n");
  await writeFile(path.join(dir, "sme-account-reconciliation.md"), md, { mode: 0o600 });
  console.log(JSON.stringify({ ...report.summary, report: "generated-artifacts/auth-review/sme-account-reconciliation.md", enforcementApproved: false }));
} catch (error) {
  // Never print connection strings, database errors containing row data, or keys.
  console.error(JSON.stringify({ code: error.code ?? "RECONCILIATION_FAILED", message: "Read-only reconciliation could not complete." }));
  process.exitCode = 1;
} finally { await sql.end({ timeout: 2 }); }
