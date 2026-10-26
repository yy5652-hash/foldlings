/**
 * Stars and unlocks. Three stars is a perfect solve: par folds, no hint.
 * Two allows one spare fold; any solve earns one.
 */

export interface Result {
  folds: number;
  par: number;
  hinted: boolean;
  stars: 1 | 2 | 3;
  perfect: boolean;
}

export interface Best {
  stars: number;
  folds: number;
}

export function scoreSolve(folds: number, par: number, hinted: boolean): Result {
  const perfect = folds <= par && !hinted;
  const stars = perfect ? 3 : folds <= par + 1 ? 2 : 1;
  return { folds, par, hinted, stars, perfect };
}

/** Keeps the most stars and, separately, the fewest folds ever used. */
export function mergeBest(prev: Best | undefined, r: Result): Best {
  if (!prev) return { stars: r.stars, folds: r.folds };
  return { stars: Math.max(prev.stars, r.stars), folds: Math.min(prev.folds, r.folds) };
}

export function totalStars(best: Record<string, Best>): number {
  let n = 0;
  for (const b of Object.values(best)) n += b.stars;
  return n;
}

/** Stars needed to open each world; the first two are open from the start. */
export const UNLOCK = [0, 0, 6, 14, 24, 34, 46, 58];

export function worldOpen(world: number, stars: number): boolean {
  return stars >= (UNLOCK[world] ?? Infinity);
}
