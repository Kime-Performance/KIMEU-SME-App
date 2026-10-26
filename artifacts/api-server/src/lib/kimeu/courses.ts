import type { AppUser } from "./access";
import { cell, dataRows, headerIndex, headersFor, readTab } from "./sheets";

export async function getCourses(user: AppUser) {
  const snapshot = await readTab("03a-KIMEU Workshops");
  const headers = headersFor(snapshot);
  const idColumn = headerIndex(headers, "Workshop ID");
  const nameColumn = headerIndex(headers, "Workshop Name");
  const stageColumn = headerIndex(headers, "Stage");
  const topicColumn = headerIndex(headers, "Region / Topic");
  const leadColumn = headerIndex(headers, "Lead SME");
  const admin = user.roles.includes("Admin");
  const courses = dataRows(snapshot).flatMap((row) => {
    const workshopId = cell(row.values, idColumn);
    const name = cell(row.values, nameColumn);
    if (!workshopId || !name || (!admin && !user.workshopIds.includes(workshopId))) return [];
    return [{
      workshopId, name, stage: cell(row.values, stageColumn),
      topic: cell(row.values, topicColumn) || null,
      leadSme: cell(row.values, leadColumn) || null,
    }];
  });
  return { courses };
}
