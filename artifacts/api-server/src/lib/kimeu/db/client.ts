import postgres from "postgres";
import { KimeuError } from "../sheets";

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
  // Supabase pooler endpoints present a cert chain node rejects by default
  // (SELF_SIGNED_CERT_IN_CHAIN). sslmode in the URL can override the ssl
  // option, so strip it and let the explicit option govern: encrypt without
  // CA verification. For strict checking use verify-full + Supabase's CA cert.
  const pooledUrl = new URL(url);
  pooledUrl.searchParams.delete("sslmode");
  sqlInstance = postgres(pooledUrl.toString(), { prepare: false, max: 1, ssl: { rejectUnauthorized: false } });
  return sqlInstance;
}

/** Used by tests to inject a mocked query executor. */
export function setSql(instance: Sql | undefined): void {
  sqlInstance = instance;
}
