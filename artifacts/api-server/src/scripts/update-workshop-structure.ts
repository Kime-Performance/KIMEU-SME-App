/**
 * Explicit, idempotent maintenance only. App writes to the live master stay blocked.
 * No clinician rows, historic records, IDs or existing formulas are changed.
 * --apply-test provisions the new test-only RD input/formula tab.
 * --apply-master-titles changes approved catalog labels and block labels only.
 */
import { ReplitConnectors } from "@replit/connectors-sdk";

const TEST = "1D-tA9f3NxaJ1ik3FW_Q4nd75kfic8CF45GrEbSjj3kY";
const MASTER = "1cXPmoIV0El9aGjwsac9sszhjFYOpz0C0QFx4GoxSaxM";
const RD_TAB = "03i-RD Onboarding";
const NAMES: Record<string, { name: string; before: string[] }> = {
  "F-12": { name: "1.2 Evaluation Retention", before: ["Workshop 1.2 — Eval"] },
  "F-UE-G": { name: "UE Late Stage", before: ["UE — General"] },
  "F-UE-PO": { name: "UE Early Stage", before: ["UE — Post-op (incl. manual therapy)"] },
  "F-LE-G": { name: "LE Late Stage", before: ["LE — General"] },
  "F-LE-PO": { name: "LE Early Stage", before: ["LE — Post-op (incl. manual therapy)"] },
  "F-SP-G": { name: "Spine Late Stage", before: ["Spine — General"] },
  "F-SP-PO": { name: "Spine Early Stage", before: ["Spine — Post-op (incl. manual therapy)"] },
  "FW-BBI": { name: "KIME HPI Skills", before: ["Building Buy-In", "Building Buy In"] },
};
const c = new ReplitConnectors();
async function request<T>(id: string, path: string, body?: object): Promise<T> {
  const r = await c.proxy("google-sheet", `/v4/spreadsheets/${id}${path}`, { method: body ? "POST" : "GET", ...(body ? { body } : {}) });
  if (!r.ok) throw new Error(`Sheets maintenance failed (${r.status}). No fallback used.`);
  return await r.json() as T;
}
const col = (i: number): string => i < 26 ? String.fromCharCode(65 + i) : col(Math.floor(i / 26) - 1) + col(i % 26);
const range = (tab: string, a1: string) => `'${tab}'!${a1}`;
type Update = { range: string; values: (string | number)[][] };
async function maintenance(id: string, apply: boolean, provision: boolean) {
  const query = new URLSearchParams({ valueRenderOption: "FORMULA" });
  query.append("ranges", range("03a-KIMEU Workshops", "A1:K30"));
  query.append("ranges", range("03c-Foundations Tracker", "A1:AZ3"));
  const values = await request<{ valueRanges: { values?: string[][] }[] }>(id, `/values:batchGet?${query}`);
  const catalog = values.valueRanges[0].values ?? [], foundation = values.valueRanges[1].values ?? [];
  const h = catalog[1], idCol = h.indexOf("Workshop ID"), nameCol = h.indexOf("Workshop Name"), tierCol = h.indexOf("SME Tier");
  if (idCol < 0 || nameCol < 0 || tierCol < 0) throw new Error("Catalog headers do not match.");
  const updates: Update[] = [];
  const expect = (tab: string, a1: string, old: string, next: string) => {
    if (old.startsWith("=")) throw new Error(`Refusing to replace a formula: ${tab} ${a1}`);
    if (old !== next) updates.push({ range: range(tab, a1), values: [[next]] });
  };
  for (const [id, title] of Object.entries(NAMES)) {
    const matches = catalog.map((row, i) => ({ row, i })).filter(r => r.row[idCol] === id);
    if (matches.length !== 1) throw new Error(`Expected one catalog row for ${id}.`);
    const { row, i } = matches[0];
    if (![title.name, ...title.before].includes(row[nameCol])) throw new Error(`Unexpected title for ${id}; director review required.`);
    expect("03a-KIMEU Workshops", `${col(nameCol)}${i + 1}`, row[nameCol], title.name);
    if (id.startsWith("F-")) {
      const blocks = (foundation[0] ?? []).map((v, index) => ({ v, index })).filter(b =>
        b.v === id || b.v.startsWith(`${id} —`) ||
        (b.v.startsWith("=") && b.v.includes(`'03a-KIMEU Workshops'!A${i + 1}&`) && b.v.includes(`'03a-KIMEU Workshops'!B${i + 1}`)));
      if (blocks.length !== 1) throw new Error(`Expected one Foundations block for ${id}.`);
      // Existing block headers reference exact catalog rows; preserve those
      // formulas and let changing the catalog title update the visible label.
      if (!blocks[0].v.startsWith("=")) expect("03c-Foundations Tracker", `${col(blocks[0].index)}1`, blocks[0].v, `${id} — ${title.name}`);
    }
  }
  // The tier is a descriptive catalog label, not a change to staff permissions.
  for (const [i, row] of catalog.entries()) {
    const workshop = row[idCol] ?? "";
    const tier = row[tierCol] ?? "";
    const next = workshop.startsWith("F-") && workshop !== "F-12" ? "SME Assist" : workshop.startsWith("FW-") ? "SME Lead" : "";
    if (next && ["Foundations", "Elite", "Content authority", "SME Assist", "SME Lead"].includes(tier)) {
      expect("03a-KIMEU Workshops", `${col(tierCol)}${i + 1}`, tier, next);
    }
  }
  if (provision) {
    if (id !== TEST) throw new Error("RD tracking schema may only be provisioned on the test copy.");
    const orientation = catalog.filter(row => row[idCol] === "F-11");
    if (!orientation.length) {
      const blank = catalog.findIndex((row, i) => i > 2 && !row.some(v => String(v).trim()));
      if (blank < 0) throw new Error("No unused catalog separator row available; do not overwrite notes.");
      updates.push({ range: range("03a-KIMEU Workshops", `A${blank + 1}:K${blank + 1}`),
        values: [["F-11", "1.1 Orientation", "Foundations", "RD-led onboarding", "", "RD", "—", "", "Yes", "", ""]] });
      catalog[blank] = ["F-11"];
    }
    if (!catalog.some(row => row[idCol] === "F-SURG-OBS")) {
      const blank = catalog.findIndex((row, i) => i > 2 && !row.some(v => String(v).trim()));
      if (blank < 0) throw new Error("No unused catalog row for Surgical Observation; no existing notes will be overwritten.");
      updates.push({ range: range("03a-KIMEU Workshops", `A${blank + 1}:K${blank + 1}`),
        values: [["F-SURG-OBS", "Surgical Observation", "Foundations", "RD attendance confirmation", "", "RD", "—", "", "Yes", "", ""]] });
    }
    const cadaverRows = catalog.map((row, i) => ({ row, i })).filter(r => r.row[idCol] === "EN-CAD");
    if (cadaverRows.length !== 1) throw new Error("Expected the existing Cadaver Lab identity EN-CAD.");
    const cadaver = cadaverRows[0];
    for (const [header, next] of [["Stage", "Foundations"], ["Lead SME", "RD"], ["SME Tier", "—"], ["Counts Toward Milestones", "Yes"]]) {
      const index = h.indexOf(header);
      if (index < 0) throw new Error(`Missing catalog header ${header}`);
      expect("03a-KIMEU Workshops", `${col(index)}${cadaver.i + 1}`, cadaver.row[index] ?? "", next);
    }
  }
  console.log(JSON.stringify({ target: id === MASTER ? "live-master-title-labels-only" : "test-copy", apply, labelCells: updates.map(u => u.range), provisionRdTracking: provision }));
  if (!apply) return;
  if (updates.length) await request(id, "/values:batchUpdate", { valueInputOption: "RAW", data: updates });
  const verifyQuery = new URLSearchParams();
  updates.forEach(update => verifyQuery.append("ranges", update.range));
  verifyQuery.append("ranges", range("03c-Foundations Tracker", "A1:AZ1"));
  const verified = await request<{ valueRanges: { values?: (string | number)[][] }[] }>(id, `/values:batchGet?${verifyQuery}`);
  for (const [index, update] of updates.entries()) {
    const read = verified.valueRanges[index];
    // Empty trailing catalog cells are omitted by Sheets; compare padded rows.
    const got = update.values[0].map((_, i) => String(read.values?.[0]?.[i] ?? ""));
    if (JSON.stringify(got) !== JSON.stringify(update.values[0].map(String))) throw new Error(`Label readback mismatch at ${update.range}`);
  }
  const labels = verified.valueRanges.at(-1)?.values?.[0] ?? [];
  for (const [workshopId, title] of Object.entries(NAMES).filter(([id]) => id.startsWith("F-"))) {
    if (!labels.includes(`${workshopId} — ${title.name}`)) throw new Error(`Calculated label did not refresh for ${workshopId}.`);
  }
  if (!provision) return;
  const meta = await request<{ sheets: { properties: { sheetId: number; title: string; gridProperties: { columnCount: number } } }[] }>(id, "?fields=sheets.properties");
  const existing = meta.sheets.find(s => s.properties.title === RD_TAB);
  if (!existing) await request(id, ":batchUpdate", { requests: [{ addSheet: { properties: { title: RD_TAB, gridProperties: { rowCount: 1000, columnCount: 16, frozenRowCount: 2 } } } }] });
  const rdHeaders = ["Record ID", "PT Email", "Workshop ID", "Week", "Session Date", "Minutes", "Attended", "RD Result", "Signed By", "Signed At", "Notes", "Last Updated By", "Last Updated", "Unit Complete", "Completed Weeks", "Course Status"];
  if (existing) {
    const current = await request<{ values?: string[][] }>(id, `/values/${encodeURIComponent(range(RD_TAB, "A2:P2"))}`);
    if (JSON.stringify(current.values?.[0]) !== JSON.stringify(rdHeaders)) throw new Error("Existing RD tracker headers differ; no schema overwrite.");
  }
  const weekCount = (week: number) => `(COUNTIFS(B3:B,B3:B,C3:C,C3:C,D3:D,${week},N3:N,"Yes")>0)*1`;
  const formulas: Update[] = [
    { range: range(RD_TAB, "A1"), values: [["RD ONBOARDING — individual inputs; completion calculated by sheet formulas"]] },
    { range: range(RD_TAB, "A2:P2"), values: [rdHeaders] },
    { range: range(RD_TAB, "N3"), values: [['=ARRAYFORMULA(IF(B3:B="","",IF((G3:G="Yes")*IF(((C3:C="EN-CAD")+(C3:C="F-SURG-OBS"))>0,1,(H3:H="Pass")*(((C3:C="F-11")+(F3:F>=60))>0)),"Yes","No")))']] },
    { range: range(RD_TAB, "O3"), values: [[`=ARRAYFORMULA(IF(B3:B="","",IF(C3:C="F-12",${[1, 2, 3, 4].map(weekCount).join("+")},${weekCount(1)})))`]] },
    { range: range(RD_TAB, "P3"), values: [['=ARRAYFORMULA(IF(B3:B="","",IF(O3:O=IF(C3:C="F-12",4,1),"Complete","In Progress")))']] },
  ];
  const tracker = meta.sheets.find(s => s.properties.title === "03c-Foundations Tracker")!;
  const existingHeaders = foundation[1] ?? [];
  let next = existingHeaders.length;
  for (const [courseId, header] of [["F-11", "1.1 Orientation Status"], ["F-12", "1.2 Evaluation Retention Status"], ["EN-CAD", "Cadaver Lab Attendance"], ["F-SURG-OBS", "Surgical Observation Attendance"]]) {
    let index = existingHeaders.indexOf(header);
    if (index < 0) { index = next++; existingHeaders[index] = header; }
    formulas.push({ range: range("03c-Foundations Tracker", `${col(index)}2`), values: [[header]] });
    formulas.push({ range: range("03c-Foundations Tracker", `${col(index)}3`), values: [[`=ARRAYFORMULA(IF(A3:A="","",IF(COUNTIFS('${RD_TAB}'!B3:B,A3:A,'${RD_TAB}'!C3:C,"${courseId}",'${RD_TAB}'!P3:P,"Complete")>0,"Complete","In Progress")))`]] });
  }
  if (next > tracker.properties.gridProperties.columnCount) await request(id, ":batchUpdate", { requests: [{ appendDimension: { sheetId: tracker.properties.sheetId, dimension: "COLUMNS", length: next - tracker.properties.gridProperties.columnCount } }] });
  // Only newly allocated status columns and the new RD tab receive formulas.
  await request(id, "/values:batchUpdate", { valueInputOption: "USER_ENTERED", data: formulas });
  const check = new URLSearchParams();
  check.append("ranges", range(RD_TAB, "N3:P3"));
  check.append("ranges", range("03c-Foundations Tracker", `${col(existingHeaders.indexOf("1.1 Orientation Status"))}3:${col(existingHeaders.indexOf("Surgical Observation Attendance"))}3`));
  const rendered = await request<{ valueRanges: { values?: string[][] }[] }>(id, `/values:batchGet?${check}`);
  if (rendered.valueRanges.some(r => r.values?.flat().some(v => /^#(ERROR|REF|VALUE|NAME|N\/A|DIV)/.test(v)))) throw new Error("RD status formula has a sheet error; investigate before enabling saves.");
  console.log(JSON.stringify({ target: "test-copy", rdTrackingReady: true, existingCompletionFormulasUnchanged: true }));
}
const applyTest = process.argv.includes("--apply-test");
const applyMaster = process.argv.includes("--apply-master-titles");
if (applyTest && applyMaster) throw new Error("Run test provisioning and live title maintenance separately.");
await maintenance(applyMaster ? MASTER : TEST, applyTest || applyMaster, !applyMaster);
