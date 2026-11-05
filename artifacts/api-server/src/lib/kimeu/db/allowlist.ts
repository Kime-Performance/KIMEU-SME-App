import { KimeuError } from "../sheets";

/**
 * Column whitelists for direct SME App writes to Supabase canonical tables.
 * These mirror the Google Sheets WRITE_ALLOWLIST in sheets.ts; the DB layer
 * enforces them as the API contract even though the canonical tables contain
 * no formula/status columns to protect.
 */
export const WRITE_ALLOWLIST: Record<string, ReadonlySet<string>> = {
  "kimeu_fellowship_reviews": new Set([
    "review_date", "reviewed_by", "review_type", "pt_email", "pt_name", "result", "score",
    "workshop_id_refocus", "specific_need", "notes", "refocus_strategy",
    "last_updated_by", "last_updated",
  ]),
  "kimeu_app_users": new Set(["app_roles", "workshop_ids"]),
  "kimeu_foundations_pt": new Set(["exam_result"]),
  "kimeu_rd_onboarding": new Set([
    "record_id", "pt_email", "workshop_id", "week", "session_date", "minutes",
    "attended", "rd_result", "signed_by", "signed_at", "notes", "last_updated_by", "last_updated",
  ]),
  "kimeu_workshop_records": new Set([
    "k_star_test_performed",
    "k_star_stars_earned",
    "pt_email",
    "pt_name",
    "workshop_id",
    "session_date",
    "attended",
    "attendance_confirmed_by",
    "practical_date",
    "practical_result",
    "practical_scored_by",
    "last_updated_by",
    "last_updated",
  ]),
  "kimeu_foundations_blocks": new Set([
    "pt_email",
    "exam_result",
    "session_date",
    "attended_sme",
    "practical_date",
    "practical_result",
    "last_updated_by",
    "last_updated",
  ]),
  "kimeu_sessions": new Set([
    "session_id",
    "workshop_id",
    "session_date",
    "lead_sme",
    "session_status",
    "session_notes",
    "changes_for_next_session",
    "last_updated_by",
    "last_updated",
  ]),
  "kimeu_clinician_notes": new Set([
    "note_id",
    "created",
    "pt_email",
    "note_type",
    "workshop_id",
    "session_id",
    "review_id",
    "note",
    "follow_up_needed",
    "follow_up_due",
    "follow_up_done",
    "author",
    "author_role",
    "visibility",
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
