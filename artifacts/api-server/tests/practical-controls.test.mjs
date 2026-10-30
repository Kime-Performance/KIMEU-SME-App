import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const temp = await mkdtemp(join(tmpdir(), "practical-controls-"));
const frontend = new URL("../../kimeu-sme-app/", import.meta.url).pathname;
await build({
  stdin: { contents: `
    import {createElement} from 'react';
    import {renderToStaticMarkup} from 'react-dom/server';
    import {CoursePracticals} from './src/components/course-practicals';
    export const render = (workshopId='FW-KB', selectedEmail='one@example.test') =>
      renderToStaticMarkup(createElement(CoursePracticals,{workshopId, selectedEmail,onDirtyChange:()=>{},onBusyChange:()=>{}}));
  `, resolveDir: frontend, loader: "tsx" },
  outfile: join(temp, "module.mjs"), bundle: true, platform: "node", format: "esm", jsx: "automatic",
  banner: { js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);" },
  alias: { react: resolve(frontend, "node_modules/react"), "react-dom": resolve(frontend, "node_modules/react-dom") },
  plugins: [{ name: "static-practical-state", setup(b) {
    b.onResolve({ filter: /^@workspace\/api-client-react$/ }, () => ({ path: "api", namespace: "fixture" }));
    b.onResolve({ filter: /^@tanstack\/react-query$/ }, () => ({ path: "query", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "query"
      ? "export const useQueryClient=()=>({});"
      : `export const getGetKimeuPracticalsQueryKey=()=>[]; export const getGetKimeuTodayQueryKey=()=>[];
         export const useGetKimeuPracticals=()=>({data:globalThis.__practicalControls,refetch:()=>{}});
         export const useSaveKimeuPractical=()=>({isPending:false});
         export const useSaveKimeuPracticalSchedule=()=>({isPending:false});` }));
  } }],
});
const { render } = await import(pathToFileURL(join(temp, "module.mjs")).href);
const person = { recordKey: "one", revision: "v1", clinicianEmail: "one@example.test", name: "One PT", sessionDate: "2026-01-01",
  attended: true, eligible: true, result: "", practicalDate: "", rd: "RD", scoredBy: "", history: [], kStarPerformed: null, kStarStars: null };
test.beforeEach(() => { globalThis.__practicalControls = { canSignOff: true, records: [person] }; });
test("KB shows explicit RD practical and K-Star entry buttons for selected eligible PT", () => {
  const html = render();
  assert.match(html, /Record RD practical/);
  assert.match(html, /Record K-Star result/);
  assert.match(html, /data-testid="button-assess-one"/);
  assert.match(html, /data-testid="button-k-star-one"/);
});
test("other workshops have RD practical controls but never K-Star entry", () => {
  const html = render("FW-OTHER");
  assert.match(html, /data-testid="button-assess-one"/);
  assert.doesNotMatch(html, /button-k-star/);
});
test("read-only and ineligible PTs do not receive save entry buttons", () => {
  globalThis.__practicalControls.canSignOff = false;
  assert.doesNotMatch(render(), /data-testid="button-(?:assess|k-star)-/);
  globalThis.__practicalControls = { canSignOff: true, records: [{ ...person, eligible: false }] };
  assert.doesNotMatch(render(), /data-testid="button-(?:assess|k-star)-/);
  assert.match(render(), /Not yet eligible/);
});
test("wrong or unenrolled PT cannot see another person's practical buttons", () => {
  const html = render("FW-KB", "another@example.test");
  assert.doesNotMatch(html, /data-testid="button-(?:assess|k-star)-/);
  assert.match(html, /Save this PT/);
  assert.match(html, /attendance to unlock RD sign-off/);
});
test("multiple workshop sessions require an explicit date selection instead of duplicate practical cards", () => {
  globalThis.__practicalControls.records = [
    { ...person, recordKey: "older", sessionDate: "2026-10-10", result: "Pass" },
    { ...person, recordKey: "newer", sessionDate: "2026-10-30", result: "Pass" },
  ];
  const html = render();
  assert.match(html, /data-testid="select-practical-session"/);
  assert.match(html, /2026-10-10/);
  assert.match(html, /2026-10-30/);
  assert.match(html, /not 2 required practicals/);
  assert.doesNotMatch(html, /data-testid="card-practical-/);
  assert.doesNotMatch(html, /data-testid="button-assess-/);
});
test.after(async () => {
  delete globalThis.__practicalControls;
  await rm(temp, { recursive: true, force: true });
});
