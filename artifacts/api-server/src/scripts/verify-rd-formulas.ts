import { ReplitConnectors } from "@replit/connectors-sdk";
const id = "1D-tA9f3NxaJ1ik3FW_Q4nd75kfic8CF45GrEbSjj3kY";
const c = new ReplitConnectors();
async function api<T = unknown>(path: string, body?: object): Promise<T> {
  const r = await c.proxy("google-sheet", `/v4/spreadsheets/${id}${path}`, { method: body ? "POST" : "GET", ...(body ? { body } : {}) });
  if (!r.ok) throw new Error(`Formula verification failed (${r.status})`);
  return await r.json() as T;
}
const title = `_RD Formula Check ${Date.now()}`;
let sheetId: number | undefined;
try {
  const source = await api<{ values: string[][] }>(`/values/${encodeURIComponent("'03i-RD Onboarding'!N3:P3")}?valueRenderOption=FORMULA`);
  const created = await api<{ replies: { addSheet: { properties: { sheetId: number } } }[] }>(":batchUpdate", { requests: [{ addSheet: { properties: { title, gridProperties: { rowCount: 1000, columnCount: 16 } } } }] });
  sheetId = created.replies[0].addSheet.properties.sheetId;
  const units = [
    ["fixture-orientation", "fixture-orientation@example.invalid", "F-11", 1, "2026-01-01", 0, "Yes", "Pass"],
    ...[1, 2, 3, 4].map(w => [`fixture-full-${w}`, "fixture-full@example.invalid", "F-12", w, `2026-01-${String(w * 7).padStart(2, "0")}`, 60, "Yes", "Pass"]),
    ...[1, 2, 3].map(w => [`fixture-partial-${w}`, "fixture-partial@example.invalid", "F-12", w, `2026-01-${String(w * 7).padStart(2, "0")}`, 60, "Yes", "Pass"]),
    ["fixture-cadaver", "fixture-cadaver@example.invalid", "EN-CAD", 1, "2026-01-01", 0, "Yes", ""],
    ["fixture-surgical", "fixture-surgical@example.invalid", "F-SURG-OBS", 1, "2026-01-01", 0, "Yes", ""],
    ["fixture-absent", "fixture-absent@example.invalid", "F-SURG-OBS", 1, "2026-01-01", 0, "No", ""],
  ];
  await api("/values:batchUpdate", { valueInputOption: "USER_ENTERED", data: [
    { range: `'${title}'!A3:H13`, values: units },
    { range: `'${title}'!N3:P3`, values: source.values },
  ] });
  const check = await api<{ values: (string | number)[][] }>(`/values/${encodeURIComponent(`'${title}'!N3:P13`)}`);
  const expected = [[1, "Complete"], ...Array.from({ length: 4 }, () => [4, "Complete"]), ...Array.from({ length: 3 }, () => [3, "In Progress"]), [1, "Complete"], [1, "Complete"], [0, "In Progress"]];
  const got = check.values.map((r: unknown[]) => [Number(r[1]), r[2]]);
  if (JSON.stringify(got) !== JSON.stringify(expected)) throw new Error(`Completion formula mismatch: ${JSON.stringify(got)}`);
  await api("/values:batchUpdate", { valueInputOption: "RAW", data: [{ range: `'${title}'!F7`, values: [[30]] }] });
  const reduced = await api<{ values?: (string | number)[][] }>(`/values/${encodeURIComponent(`'${title}'!N7:P7`)}`);
  if (JSON.stringify(reduced.values?.[0]?.map(String)) !== JSON.stringify(["No", "3", "In Progress"])) throw new Error("A session under one hour incorrectly counted toward completion.");
  console.log(JSON.stringify({ orientationPass: true, fourWeeksPass: true, threeWeeksIncomplete: true, underOneHourIncomplete: true, cadaverAttendanceOnly: true, surgicalAttendanceOnly: true, absentNotComplete: true, realPtRowsChanged: false }));
} finally {
  if (sheetId !== undefined) await api(":batchUpdate", { requests: [{ deleteSheet: { sheetId } }] });
}
