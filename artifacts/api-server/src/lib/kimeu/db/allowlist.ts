import { KimeuError, NOTE_VISIBILITY_HEADER } from "../sheets";

/**
 * Column whitelists for direct SME App writes to Supabase canonical tables.
 * These mirror the Google Sheets WRITE_ALLOWLIST in sheets.ts; the DB layer
 * enforces them as the API contract even though the canonical tables contain
 * no formula/status columns to protect.
 */
export const WRITE_ALLOWLIST: Record<string, ReadonlySet<string>> = {
  "kimeu_fellowship_reviews": new Set([
    "Review Date", "Reviewed By", "Review Type", "PT Email", "PT Name", "Result", "Score",
    "Workshop ID (Refocus)", "Specific Need", "Notes", "Refocus Strategy",
    "Last Updated By", "Last Updated",
  ]),
  "kimeu_app_users": new Set(["App Role(s)", "Workshop IDs"]),
  "kimeu_rd_onboarding": new Set([
    "Record ID", "PT Email", "Workshop ID", "Week", "Session Date", "Minutes",
    "Attended", "RD Result", "Signed By", "Signed At", "Notes", "Last Updated By", "Last Updated",
  ]),
  "kimeu_workshop_records": new Set([
    "K-Star Test Performed",
    "K-Star Stars Earned",
    "PT Email",
    "PT Name",
    "Workshop ID",
    "Session Date",
    "Attended",
    "Attendance Confirmed By",
    "Practical Date",
    "Practical Result",
    "Practical Scored By (RD)",
    "Last Updated By",
    "Last Updated",
  ]),
  "kimeu_foundations_blocks": new Set([
    "PT Email",
    "Exam Result",
    "Session Date",
    "Attended (SME)",
    "Practical Date",
    "Practical Result",
    "Last Updated By",
    "Last Updated",
  ]),
  "kimeu_sessions": new Set([
    "Session ID",
    "Workshop ID",
    "Session Date",
    "Lead SME",
    "Session Status",
    "Session Notes",
    "Changes for Next Session",
    "Last Updated By",
    "Last Updated",
  ]),
  "kimeu_clinician_notes": new Set([
    "Note ID",
    "Created",
    "PT Email",
    "Note Type",
    "Workshop ID",
    "Session ID",
    "Review ID",
    "Note",
    "Follow-up Needed",
    "Follow-up Due",
    "Follow-up Done",
    "Author",
    "Author Role",
    NOTE_VISIBILITY_HEADER,
  ]),
};

export function assertInputHeader(tableName: string, header: string): void {
  if (!WRITE_ALLOWLIST[tableName]?.has(header)) {
    throw new KimeuError(
      `Writing to ${tableName}.${header} is not allowed by the KIMEU allowlist.`,
      409,
      "DB_WRITE_NOT_ALLOWED",
    );
  }
}
