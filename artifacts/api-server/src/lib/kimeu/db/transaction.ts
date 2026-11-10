import { getSql, getTransactionSql, type Sql } from "./client";
import { KimeuError } from "../sheets";

// Stable 32-bit key for KIMEU writer serialization.
const ADVISORY_LOCK_KEY = 22474487185;

/**
 * Run a mutation with the cross-instance Postgres advisory lock held.
 * The lock is transaction-scoped (pg_advisory_xact_lock) so it is released
 * on commit/rollback even if the process crashes. This replaces the
 * process-local write lock used by the sheets path.
 */
export async function withKimeuLock<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  try {
    const result = getTransactionSql().begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`;
      return await fn(tx as unknown as Sql);
    }) as Promise<T>;
    return await result;
  } catch (error) {
    if (error instanceof KimeuError) throw error;
    throw new KimeuError(
      error instanceof Error ? error.message : "Database transaction failed",
      503,
      "DB_TRANSACTION_FAILED",
    );
  }
}

/** Run a read-only query outside a transaction. */
export async function withRead<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  try {
    return await fn(getSql());
  } catch (error) {
    if (error instanceof KimeuError) throw error;
    throw new KimeuError(
      error instanceof Error ? error.message : "Database query failed",
      503,
      "DB_READ_FAILED",
    );
  }
}
