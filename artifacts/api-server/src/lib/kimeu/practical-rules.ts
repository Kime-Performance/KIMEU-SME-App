export function isAssignedRd(assignment: string, name: string, email: string): boolean {
  const normalize = (value: string) => value.trim().toLowerCase();
  return Boolean(assignment.trim()) &&
    [normalize(name), normalize(email)].filter(Boolean).includes(normalize(assignment));
}

export function validPracticalInput(
  result: string, date: string, notes: string, sessionDate: string, today: string,
): string | null {
  if (!["Pass", "Fail"].includes(result)) return "Choose Pass or Not passed.";
  if (result === "Fail" && !notes.trim()) return "Explain what needs work when the practical is not passed.";
  if (notes.length > 4000) return "Notes must be 4,000 characters or fewer.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(`${date}T12:00:00Z`)) ||
      new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) {
    return "Enter a valid practical date.";
  }
  if (!sessionDate || date < sessionDate) return "The practical date cannot be before the workshop.";
  if (date > today) return "The practical date cannot be in the future.";
  return null;
}

export function validPracticalSchedule(date: string | null, sessionDate: string, today: string): string | null {
  if (date === null) return null; // Clear a plan, never erase its audit history.
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  if (!validDate(date) || !validDate(sessionDate)) return "Enter a valid scheduled practical date.";
  const end = new Date(Date.parse(`${sessionDate}T12:00:00Z`) + 14 * 86400000).toISOString().slice(0, 10);
  if (date < sessionDate || date > end) return `Schedule the practical between ${sessionDate} and ${end} (within two weeks after the workshop).`;
  if (date < today) return "Choose today or a future date for scheduling. Use RD practical completion to record a practical that already happened.";
  return null;
}
