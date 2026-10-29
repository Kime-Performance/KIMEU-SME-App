// Formula-only rollout helpers. No credentials, network calls, or clinician data.
// Existing Kajabi inputs, historical attendance, and Summary A:J stay untouched.
import { foundationWorkshopCompletion } from "./kimeu-foundations-completion.mjs";
export const rdHeaders = [
  "Record ID", "PT Email", "Workshop ID", "Week", "Session Date", "Minutes",
  "Attended", "RD Result", "Signed By", "Signed At", "Notes", "Last Updated By",
  "Last Updated", "Unit Complete", "Completed Weeks", "Course Status",
];
export const foundationHeaders = [
  "1.1 Orientation Status", "1.2 Evaluation Retention Status", "Evaluation Retention Completed Weeks",
  "Cadaver Lab Attendance", "Surgical Observation Attendance",
];
export const summaryHeaders = [...foundationHeaders];
const rd = "'03i-RD Onboarding'";
const foundations = "'03c-Foundations Tracker'";

export function rdArrayFormulas() {
  return [
    `=ARRAYFORMULA(IF(B3:B="","",IF((G3:G="Yes")*ISNUMBER(E3:E)*(E3:E<=TODAY())*IF(((C3:C="EN-CAD")+(C3:C="F-SURG-OBS"))>0,1,(H3:H="Pass")*(((C3:C="F-11")+(F3:F>=60))>0)),"Yes","No")))`,
    `=ARRAYFORMULA(IF(B3:B="","",IF(C3:C="F-12",(COUNTIFS(B3:B,B3:B,C3:C,C3:C,D3:D,1,N3:N,"Yes")>0)*1+(COUNTIFS(B3:B,B3:B,C3:C,C3:C,D3:D,2,N3:N,"Yes")>0)*1+(COUNTIFS(B3:B,B3:B,C3:C,C3:C,D3:D,3,N3:N,"Yes")>0)*1+(COUNTIFS(B3:B,B3:B,C3:C,C3:C,D3:D,4,N3:N,"Yes")>0)*1,(COUNTIFS(B3:B,B3:B,C3:C,C3:C,D3:D,1,N3:N,"Yes")>0)*1)))`,
    `=ARRAYFORMULA(IF(B3:B="","",IF(O3:O=IF(C3:C="F-12",4,1),"Complete","In Progress")))`,
  ];
}

function courseStatus(row, id, legacyColumn) {
  const count = `COUNTIFS(${rd}!$B$3:$B,$A${row},${rd}!$C$3:$C,"${id}")`;
  const complete = `COUNTIFS(${rd}!$B$3:$B,$A${row},${rd}!$C$3:$C,"${id}",${rd}!$P$3:$P,"Complete")`;
  const fallback = legacyColumn
    ? `IF(REGEXMATCH(LOWER(TO_TEXT(${legacyColumn}${row})),"^(true|yes|complete|✓)$"),"Complete","Not Started")`
    : `"Not Started"`;
  return `=IF($A${row}="","",IF(${count}>0,IF(${complete}>0,"Complete","In Progress"),${fallback}))`;
}

export function foundationRollups(row) {
  return [
    courseStatus(row, "F-11"),
    courseStatus(row, "F-12"),
    `=IF($A${row}="","",MAXIFS(${rd}!$O$3:$O,${rd}!$B$3:$B,$A${row},${rd}!$C$3:$C,"F-12"))`,
    courseStatus(row, "EN-CAD", "AW"),
    courseStatus(row, "F-SURG-OBS", "AX"),
  ];
}

export function evaluationCompletion(row, oldFormula) {
  if (typeof oldFormula !== "string" || !oldFormula.startsWith("=")) {
    throw new Error(`Existing Evaluation Retention formula missing at O${row}; review before rollout.`);
  }
  // Old formulas must exist, but their superseded Kajabi workshop gate must
  // not be reintroduced when an onboarding rollout is run again.
  return foundationWorkshopCompletion(row, 10);
}

export function summaryRollups(row) {
  return ["AY", "AZ", "BA", "BB", "BC"].map((column, i) =>
    `=IF($B${row}="","",IFERROR(INDEX(${foundations}!$${column}$4:$${column},MATCH($B${row},${foundations}!$A$4:$A,0)),${i === 2 ? "0" : '"Not Started"'}))`);
}
