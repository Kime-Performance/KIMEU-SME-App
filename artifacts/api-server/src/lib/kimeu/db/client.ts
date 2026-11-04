import postgres from "postgres";
import { KimeuError } from "../sheets";
import { truthDatabaseConnectionOptions } from "./connection-options";

export type Sql = ReturnType<typeof postgres>;

let sqlInstance: Sql | undefined;

/**
 * Resolve the Postgres-js client for the SME App data layer.
 * Uses KIMEU_TRUTH_DATABASE_URL with prepare:false so it works against the
 * Supabase pooler in transaction mode (port 6543) with the sme_app DB role.
 * The truth connection var is REQUIRED with no fallback to the app's own
 * DATABASE_URL — sharing DATABASE_URL would let a misconfigured deployment
 * point truth reads/writes at the app's own database.
 * Lazy-initializes so sheets-mode processes never require the var.
 */
export function getSql(): Sql {
  if (sqlInstance) return sqlInstance;
  const url = process.env.KIMEU_TRUTH_DATABASE_URL;
  if (!url) {
    throw new KimeuError(
      "KIMEU_TRUTH_DATABASE_URL is required when KIMEU_DATA_SOURCE=postgres.",
      503,
      "DB_NOT_CONFIGURED",
    );
  }
  const { connectionString, options } = truthDatabaseConnectionOptions(
    url,
    process.env.KIMEU_TRUTH_DATABASE_CA_CERT,
  );
  sqlInstance = postgres(connectionString, options);
  return sqlInstance;
}

/** Used by tests to inject a mocked query executor. */
export function setSql(instance: Sql | undefined): void {
  sqlInstance = instance;
}
