export const MASTER_SHEET_ID = "1cXPmoIV0El9aGjwsac9sszhjFYOpz0C0QFx4GoxSaxM";

// Live tracking is an explicit opt-in, never an accidental spreadsheet-ID swap.
export function resolveSheetConfiguration(id = "", liveWriteApproval = "") {
  const sheetId = id.trim();
  const isMaster = sheetId === MASTER_SHEET_ID;
  const missing: string[] = [];
  if (!sheetId) missing.push("KIMEU_SHEET_ID");
  if (isMaster && liveWriteApproval !== "true") {
    missing.push("Live Master tracking requires explicit KIMEU_ENABLE_LIVE_WRITES=true approval.");
  }
  const configured = Boolean(sheetId && missing.length === 0);
  return {
    sheetId, configured, missing,
    trackingMode: configured ? (isMaster ? "live" as const : "test" as const) : "unconfigured" as const,
  };
}
