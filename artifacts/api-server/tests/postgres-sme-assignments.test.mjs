import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const temp = await mkdtemp(join(tmpdir(), "pg-sme-assign-"));
await build({
  stdin: {
    contents: "export { getSmeAssignments } from './src/lib/kimeu/sme-assignments'; export { setSql } from './src/lib/kimeu/db/client';",
    resolveDir: new URL("../", import.meta.url).pathname,
    loader: "ts",
  },
  outfile: join(temp, "module.mjs"), bundle: true, platform: "node", format: "esm",
  plugins: [{ name: "isolated-provider", setup(b) {
    b.onResolve({ filter: /^(postgres|@replit\/connectors-sdk|@clerk\/express)$/ }, ({ path }) => ({ path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
      contents: path === "postgres"
        ? "export default function postgres(){ throw new Error('live DB connections are not allowed in tests') }"
        : path === "@clerk/express"
          ? "export const clerkClient={};export const getAuth=()=>({});"
          : "export class ReplitConnectors {proxy(){ throw new Error('sheets transport is disabled in postgres-mode tests') }}",
    }));
  } }],
});
process.env.KIMEU_DATA_SOURCE = "postgres";
process.env.DATABASE_URL = "postgres://test";
const { getSmeAssignments, setSql } = await import(pathToFileURL(join(temp, "module.mjs")).href);

const db = {
  appUsers: [
    { email: "admin@kimeperformance.com", name_in_sheets: "Admin", active: true, app_roles: "Admin", workshop_ids: "" },
    { email: "sme@kimeperformance.com", name_in_sheets: "SME", active: true, app_roles: "SME Assist,SME Lead", workshop_ids: "F-01,F-02" },
  ],
  workshops: [
    { "Workshop ID": "F-01", "Workshop Name": "Foundations 1", "Stage": "Foundations" },
    { "Workshop ID": "F-02", "Workshop Name": "Foundations 2", "Stage": "Foundations" },
  ],
};

async function sql(strings, ...values) {
  const text = strings.join("?");
  if (/pg_advisory_xact_lock/i.test(text)) return [];
  if (/from kimeu_app_users/i.test(text)) return db.appUsers;
  if (/from kimeu_workshops/i.test(text)) return db.workshops;
  throw new Error(`Unmocked query: ${text}`);
}
sql.begin = async (fn) => fn(sql);
setSql(sql);

const admin = { email: "admin@kimeperformance.com", nameInSheets: "Admin", roles: ["Admin"], workshopIds: [], active: true };

test("SME assignment read returns staff and courses from canonical tables", async () => {
  const res = await getSmeAssignments(admin);
  assert.equal(res.staff.length, 2);
  const sme = res.staff.find((s) => s.email === "sme@kimeperformance.com");
  assert.ok(sme);
  assert.deepEqual(sme.roles, ["SME Assist", "SME Lead"]);
  assert.deepEqual(sme.workshopIds, ["F-01", "F-02"]);
  assert.equal(res.courses.length, 2);
  assert.ok(res.revision);
});

test("only admins may read SME assignments", async () => {
  const sme = { ...admin, roles: ["SME Assist"] };
  await assert.rejects(() => getSmeAssignments(sme), err => err.code === "ROLE_NOT_ALLOWED");
});
