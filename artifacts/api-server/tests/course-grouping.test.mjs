import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = await mkdtemp(join(tmpdir(), "kimeu-course-grouping-"));
await build({
  entryPoints: [new URL("../../kimeu-sme-app/src/lib/courses.ts", import.meta.url).pathname],
  outfile: join(dir, "courses.mjs"), platform: "node", bundle: true, format: "esm",
  plugins: [{ name: "unused-api-hooks", setup(b) {
    b.onResolve({ filter: /^@workspace\/api-client-react$/ }, () => ({ path: "hooks", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
      contents: "export const getGetKimeuCoursesQueryKey=()=>[];export const useGetKimeuCourses=()=>{throw Error('Network hooks are not part of grouping tests')}",
    }));
  } }],
});
const { groupCourses, coursePath, stageLabel } = await import(pathToFileURL(join(dir, "courses.mjs")).href);
test("Speed appears once under Advanced without changing its existing course identity", () => {
  const courses = [
    { workshopId: "F-UE-G", name: "UE Late Stage", stage: "Foundations" },
    { workshopId: "FW-SPD", name: "Speed", stage: "Fellowship" },
    { workshopId: "FW-BBI", name: "KIME HPI Skills", stage: "Fellowship" },
  ];
  const groups = groupCourses(courses);
  assert.deepEqual(groups.map(g => g.label), ["Foundations", "Fellowship", "Advanced"]);
  assert.deepEqual(groups.find(g => g.label === "Advanced").items.map(c => c.name), ["Speed"]);
  assert.equal(groups.flatMap(g => g.items).filter(c => c.workshopId === "FW-SPD").length, 1);
  assert.equal(stageLabel("Fellowship", "FW-SPD"), "Advanced");
  assert.equal(coursePath("FW-SPD"), "/courses/FW-SPD");
  assert.equal(courses[1].stage, "Fellowship", "display grouping must not change sheet completion semantics");
});
test.after(() => rm(dir, { recursive: true, force: true }));
