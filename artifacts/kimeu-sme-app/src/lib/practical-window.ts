/** Calendar-only arithmetic: no browser timezone or DST shifts. */
export function practicalWindow(sessionDate: string, practicalDate: string, today: string) {
  const session = sessionDate.slice(0, 10);
  const start = Date.parse(`${session}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(session) || !Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== session) return null;
  const end = new Date(start + 14 * 86400000).toISOString().slice(0, 10);
  const date = practicalDate || today;
  return { start: session, end, onTime: date >= session && date <= end && date <= today, future: date < session || date > today };
}
