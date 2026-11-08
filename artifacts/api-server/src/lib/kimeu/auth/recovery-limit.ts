import { createHash } from "node:crypto";

/**
 * Bounded, per-process abuse protection, in addition to Supabase's delivery
 * limits. Not a distributed quota. No raw emails or addresses are retained.
 * Reserve both budgets before attempting delivery; failed sends also count.
 */
export function createRecoveryLimit(now = Date.now) {
  const windowMs = 15 * 60 * 1000;
  const entries = new Map<string, { until: number; count: number }>();
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  return (address: string, email: string): boolean => {
    const time = now();
    for (const [key, entry] of entries) if (entry.until <= time) entries.delete(key);
    const keys: Array<[string, number]> = [
      ["global", 100],
      [`address:${hash(address)}`, 10],
      [`email:${hash(email.trim().toLowerCase())}`, 3],
    ];
    // Refuse excess cardinality rather than evicting a live abuse budget.
    if (entries.size + keys.filter(([key]) => !entries.has(key)).length > 4096) return false;
    if (keys.some(([key, limit]) => (entries.get(key)?.count ?? 0) >= limit)) return false;
    for (const [key] of keys) {
      const entry = entries.get(key) ?? { until: time + windowMs, count: 0 };
      entry.count += 1;
      entries.set(key, entry);
    }
    return true;
  };
}
