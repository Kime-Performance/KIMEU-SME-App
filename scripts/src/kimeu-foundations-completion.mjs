// Workshop checkmarks are independent of the separate Kajabi assessment.
const starts = [10, 15, 20, 25, 30, 35, 40];
function column(index) {
  let result = "";
  for (index++; index > 0; index = Math.floor((index - 1) / 26)) {
    result = String.fromCharCode(65 + (index - 1) % 26) + result;
  }
  return result;
}
export function foundationWorkshopCompletion(row, start) {
  if (!Number.isInteger(row) || row < 3 || !starts.includes(start)) throw new Error("Invalid Foundations workshop formula target.");
  const attended = `${column(start + 1)}${row}`;
  const practical = `${column(start + 3)}${row}`;
  const legacy = `IF(AND(${attended}="Yes",${practical}="Pass"),"✓",IF(OR(${practical}="Fail",${practical}="Retake"),"Redo",""))`;
  if (start !== 10) return `=IF($A${row}="","",${legacy})`;
  const rd = "'03i-RD Onboarding'";
  // Where weekly records exist, require the existing four-week RD result,
  // rather than letting a historical single-session pass bypass those weeks.
  return `=IF($A${row}="","",IF(COUNTIFS(${rd}!$B$3:$B,$A${row},${rd}!$C$3:$C,"F-12")>0,IF($AZ${row}="Complete","✓",IF(COUNTIFS(${rd}!$B$3:$B,$A${row},${rd}!$C$3:$C,"F-12",${rd}!$H$3:$H,"Fail")>0,"Redo","")),${legacy}))`;
}
