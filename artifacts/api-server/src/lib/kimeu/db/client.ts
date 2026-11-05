import postgres from "postgres";
import { KimeuError } from "../sheets";
import { truthDatabaseConnectionOptions } from "./connection-options";

export type Sql = ReturnType<typeof postgres>;

let sqlInstance: Sql | undefined;
let transactionSqlInstance: Sql | undefined;

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
  sqlInstance = createSql(0);
  return sqlInstance;
}

/**
 * Transactions exclusively reserve their own single connection. postgres-js
 * requires a nonzero pipeline limit to invoke BEGIN's reservation callback.
 * Keep this pool separate so ordinary reads never overlap its statements.
 * All transaction statements in the data layer are awaited sequentially.
 */
export function getTransactionSql(): Sql {
  if (transactionSqlInstance) return transactionSqlInstance;
  transactionSqlInstance = createSql(1);
  return transactionSqlInstance;
}

function createSql(maxPipeline: number): Sql {
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
  // max_pipeline is supported by the runtime but omitted from its public types.
  const clientOptions = { ...options, max_pipeline: maxPipeline };
  return postgres(connectionString, clientOptions);
}

/** Used by tests to inject a mocked query executor. */
export function setSql(instance: Sql | undefined): void {
  sqlInstance = instance;
  transactionSqlInstance = instance;
}
