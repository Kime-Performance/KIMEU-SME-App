import postgres from "postgres";
import { KimeuError } from "../sheets";

export type Sql = ReturnType<typeof postgres>;

let sqlInstance: Sql | undefined;

/**
 * Resolve the Postgres-js client for the SME App data layer.
 * Uses DATABASE_URL with prepare:false so it works against the Supabase
 * pooler in transaction mode (port 6543) with the sme_app DB role.
 * Lazy-initializes so sheets-mode processes never require DATABASE_URL.
 */
export function getSql(): Sql {
  if (sqlInstance) return sqlInstance;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new KimeuError(
      "DATABASE_URL is required when KIMEU_DATA_SOURCE=postgres.",
      503,
      "DB_NOT_CONFIGURED",
    );
  }
  sqlInstance = postgres(url, { prepare: false, max: 1 });
  return sqlInstance;
}

/** Used by tests to inject a mocked query executor. */
export function setSql(instance: Sql | undefined): void {
  sqlInstance = instance;
}
