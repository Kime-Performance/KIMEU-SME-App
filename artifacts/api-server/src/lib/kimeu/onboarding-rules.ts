import { KimeuError } from "./sheets";
import { validateTrackingDate } from "./course-tracking";
import { isRdAttendanceOnly } from "./courses";

export function onboardingWeeks(courseId: string) {
  if (courseId === "F-11" || isRdAttendanceOnly(courseId)) return 1;
  if (courseId === "F-12") return 4;
  throw new KimeuError("Unknown RD onboarding course.", 404, "ONBOARDING_NOT_FOUND");
}
export function validateOnboardingUnit(input: { week: number; date: string; attended: boolean; result: string; notes: string }, courseId: string, today: string, others: { week: number; date: string }[]) {
  const weeks = onboardingWeeks(courseId);
  if (!Number.isInteger(input.week) || input.week < 1 || input.week > weeks) throw new KimeuError("Choose a valid week.", 400, "INVALID_WEEK");
  validateTrackingDate(input.date);
  if (input.date > today) throw new KimeuError("A workshop cannot be signed off in the future.", 400, "FUTURE_SIGNOFF");
  if (!["", "Pass", "Fail"].includes(input.result)) throw new KimeuError("Choose a valid RD result.", 400, "INVALID_RESULT");
  if (isRdAttendanceOnly(courseId) && input.result !== "") throw new KimeuError("This requirement records attendance only, without a practical result.", 400, "ATTENDANCE_ONLY");
  if (input.result === "Pass" && !input.attended) throw new KimeuError("Confirm attendance before RD sign-off.", 400, "ATTENDANCE_REQUIRED");
  if (input.result === "Fail" && !input.notes.trim()) throw new KimeuError("Feedback is required when not passed.", 400, "FEEDBACK_REQUIRED");
  if (input.notes.length > 4000) throw new KimeuError("Keep notes within 4,000 characters.", 400, "NOTES_TOO_LONG");
  if (weeks === 4) {
    const weekBucket = (date: string) => {
      const d = new Date(`${date}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
      return d.toISOString().slice(0, 10);
    };
    for (const other of others.filter(o => o.week !== input.week && o.date)) {
      if (weekBucket(other.date) === weekBucket(input.date) ||
          (other.week < input.week && other.date >= input.date) ||
          (other.week > input.week && other.date <= input.date)) {
        throw new KimeuError("Record the four workshops in chronological, separate calendar weeks.", 400, "WEEKS_MUST_BE_DISTINCT");
      }
    }
  }
}
