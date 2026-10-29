// Mirror the live sheet's repeated five-column workshop blocks, including
// Evaluation Retention before the six clinical workshops. No real PT data.
export const clinicalFoundations = [
  ["F-UE-G", "UE Late Stage"], ["F-UE-PO", "UE Early Stage"],
  ["F-LE-G", "LE Late Stage"], ["F-LE-PO", "LE Early Stage"],
  ["F-SP-G", "Spine Late Stage"], ["F-SP-PO", "Spine Early Stage"],
];
export function foundationsFixture(attended = "No") {
  const titles = Array(48).fill("");
  const headers = ["PT Email", "PT Name", "RD", "Start Date", "Kajabi Course %",
    "Course Complete", "Exam Score", "Exam Result", "Workshops Complete", "Foundations Status"];
  const blocks = [["F-12", "1.2 Evaluation Retention"], ...clinicalFoundations];
  for (const [i, [id, name]] of blocks.entries()) {
    titles[10 + i * 5] = `${id} — ${name}`;
    headers.push("Session Date", "Attended (SME)", "Practical Date", "Practical Result", "Complete");
  }
  headers.push("SME / Aaron Notes", "Last Updated By", "Last Updated");
  const rows = ["one", "two"].map((id) => {
    const row = Array(48).fill("");
    row[0] = `${id}@example.test`; row[1] = `Fixture ${id}`; row[2] = "Fixture RD";
    row[8] = "=sheet-owned-count"; row[9] = "=sheet-owned-pathway-status";
    for (let i = 0; i < blocks.length; i++) {
      const start = 10 + i * 5;
      row[start] = "2026-01-01"; row[start + 1] = attended; row[start + 4] = "=sheet-owned-completion";
    }
    return row;
  });
  return [titles, headers, [], ...rows];
}
