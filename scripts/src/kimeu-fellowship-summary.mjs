export const fellowshipSummaryHeaders = [
  "Fellowship Review Score", "Fellowship Review Notes", "Fellowship Reviewed By",
  "Fellowship Review Date", "Fellowship Review Updated At",
];

// Same date can have several attempts. Server-owned Last Updated, then row,
// break ties so an older attempt cannot hide a later pass or failed review.
export function fellowshipLatestFormula(row, sourceColumn) {
  if (!Number.isInteger(row) || row < 4 || !["G", "H", "T", "C", "B", "W"].includes(sourceColumn)) {
    throw new Error("Invalid Fellowship Summary formula target.");
  }
  const tab = "'03d-Fellowship Review Log'";
  const value = `${tab}!$${sourceColumn}$4:$${sourceColumn}`;
  return `=IF($B${row}="","",IFERROR(INDEX(SORT(FILTER({${tab}!$B$4:$B,IF(${value}="","",${value}),${tab}!$W$4:$W,ROW(${tab}!$B$4:$B)},${tab}!$E$4:$E=$B${row},${tab}!$G$4:$G<>""),1,FALSE,3,FALSE,4,FALSE),1,2),""))`;
}
