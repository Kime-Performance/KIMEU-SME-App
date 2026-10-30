import { KimeuError } from "./sheets";

export const K_STAR_WORKSHOP = "FW-KB";
export const K_STAR_PERFORMED = "K-Star Test Performed";
export const K_STAR_STARS = "K-Star Stars Earned";
export type KStarEvidence = { performed: boolean | null; stars: number | null };

export function kStarColumns(headers: string[]) {
  const unique = (name: string, expected: number) => {
    const matches = headers.flatMap((h, i) => h.trim() === name ? [i] : []);
    if (matches.length !== 1 || matches[0] !== expected) {
      throw new KimeuError(`Expected ${name} in its existing sheet column. No K-Star data was written.`, 409, "K_STAR_HEADER_CHANGED");
    }
    return matches[0];
  };
  return { performed: unique(K_STAR_PERFORMED, 30), stars: unique(K_STAR_STARS, 31) };
}

export function readKStar(performed: string, stars: string): KStarEvidence {
  const flag = performed.trim().toUpperCase();
  const value = stars.trim() ? Number(stars.trim()) : NaN;
  const valid = Number.isInteger(value) && value >= 0 && value <= 4 ? value : null;
  return { performed: flag === "TRUE" ? true : flag === "FALSE" ? false : null,
    stars: flag === "TRUE" ? valid : null };
}

export function validateKStar(workshopId: string, performed: unknown, stars: unknown) {
  if (performed === undefined && stars === undefined) return false;
  if (workshopId !== K_STAR_WORKSHOP) throw new KimeuError("K-Star recognition is only available for KB Resilience.", 400, "K_STAR_WRONG_WORKSHOP");
  if (typeof performed !== "boolean" ||
      (performed && (typeof stars !== "number" || !Number.isInteger(stars) || stars < 0 || stars > 4)) ||
      (!performed && stars !== null && stars !== undefined)) {
    throw new KimeuError("A performed K-Star test requires a whole-number result from 0 to 4; an unchecked test cannot include a level.", 400, "K_STAR_INVALID");
  }
  return true;
}

export function mergeKStar(evidence: KStarEvidence[], performed: boolean, stars: number | null): KStarEvidence {
  const valid = evidence.filter(e => e.performed === true && e.stars !== null);
  const levels = valid.map(e => e.stars!);
  if (performed && stars !== null) levels.push(stars);
  // Preserve the strongest evidence, including a previous zero-star attempt.
  if (levels.length) return { performed: true, stars: Math.max(...levels) };
  if (performed || evidence.some(e => e.performed === true)) return { performed: true, stars };
  return { performed: false, stars: null };
}
