import { getGetKimeuCoursesQueryKey, useGetKimeuCourses } from '@workspace/api-client-react';
import type { CourseSummary } from '@workspace/api-client-react';

export function useCourseCatalog() {
  return useGetKimeuCourses({ query: { queryKey: getGetKimeuCoursesQueryKey(), refetchInterval: 60_000, refetchOnWindowFocus: true } });
}

export function stageLabel(stage: string, workshopId?: string) {
  // Speed is one Advanced page, retaining its Fellowship catalog identity and
  // completion credit rather than creating a second, disconnected workshop.
  if (workshopId === 'FW-SPD') return 'Advanced';
  const s = stage.trim();
  if (!s) return 'Unstaged';
  return s.toLowerCase() === 'fellowship' ? 'Fellowship' : s;
}

export function coursePath(workshopId: string) {
  return `/courses/${encodeURIComponent(workshopId)}`;
}

export function groupCourses(courses: CourseSummary[]) {
  const order = (label: string) => (label === 'Foundations' ? 0 : label === 'Fellowship' ? 1 : label === 'Advanced' ? 2 : 3);
  const map = new Map<string, CourseSummary[]>();
  for (const c of courses) {
    const label = stageLabel(c.stage, c.workshopId);
    map.set(label, [...(map.get(label) ?? []), c]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([label, items]) => ({ label, items: [...items].sort((a, b) => a.name.localeCompare(b.name)) }));
}
