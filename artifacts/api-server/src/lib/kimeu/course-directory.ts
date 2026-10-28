import { ReplitConnectors } from "@replit/connectors-sdk";
import { KimeuError, normalizeEmail } from "./sheets";

// Explicit user-supplied source, separate from the writable KIMEU test copy.
const SOURCE = "1CCBAQrjlACcWDPAS6Z2UIirnn-4tleSEuZhc6wPTufo";
type Directory = { refreshedAt: string; people: Array<{ email: string; name: string; location: string }> };
let cache: { until: number; value: Directory } | undefined;

export async function readCourseDirectory(force = false): Promise<Directory> {
  if (!force && cache && cache.until > Date.now()) return cache.value;
  const response = await new ReplitConnectors().proxy("google-sheet",
    `/v4/spreadsheets/${SOURCE}/values/${encodeURIComponent("'01-PT Roster'!A3:X")}`,
    { method: "GET" });
  if (!response.ok) throw new KimeuError("The KIME PT roster could not be refreshed. No substitute roster was used.", 503, "ROSTER_UNAVAILABLE");
  const result = await response.json() as { values?: string[][] };
  const [headers = [], ...rows] = result.values ?? [];
  const index = (name: string) => {
    const i = headers.findIndex(h => h.trim() === name);
    if (i < 0) throw new KimeuError(`Roster header missing: ${name}.`, 409, "ROSTER_HEADER_MISSING");
    return i;
  };
  const email = index("Email"), name = index("Full Name"), location = index("Location");
  const status = index("Status"), end = index("Termination Date"), department = index("Department");
  const people = rows.filter(r =>
    r[email]?.trim() && r[status]?.trim().toLowerCase() === "active" &&
    !r[end]?.trim() && r[department]?.trim().toLowerCase() === "clinical")
    .map(r => ({ email: normalizeEmail(r[email]), name: r[name]?.trim() || r[email], location: r[location]?.trim() || "" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (new Set(people.map(p => p.email)).size !== people.length) {
    throw new KimeuError("Duplicate active PT email addresses must be resolved in the roster.", 409, "ROSTER_DUPLICATE");
  }
  const value = { refreshedAt: new Date().toISOString(), people };
  cache = { until: Date.now() + 30_000, value };
  return value;
}
