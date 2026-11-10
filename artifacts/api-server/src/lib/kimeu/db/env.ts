/**
 * Data-source routing for the KIMEU business layer.
 * All existing sheet behavior stays untouched unless KIMEU_DATA_SOURCE
 * is explicitly set to "postgres". This lets the app run against the live
 * Google Sheets path while the Postgres layer is reviewed and the
 * per-table cutover runbook is executed.
 */
export function kimeuDataSource(): "postgres" | "sheets" {
  const value = process.env.KIMEU_DATA_SOURCE?.trim().toLowerCase();
  if (value && value !== "postgres" && value !== "sheets") {
    throw new Error("KIMEU_DATA_SOURCE must be either postgres or sheets; refusing an implicit data-source fallback.");
  }
  return value === "postgres" ? "postgres" : "sheets";
}

export function isPostgresMode(): boolean {
  return kimeuDataSource() === "postgres";
}
