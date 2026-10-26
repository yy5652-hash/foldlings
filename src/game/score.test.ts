import { describe, expect, it } from 'vitest';
import { mergeBest, scoreSolve, totalStars, UNLOCK, worldOpen } from './score.js';

describe('stars', () => {
  it('gives three for par with no hint, two for one spare fold, one otherwise', () => {
    expect(scoreSolve(2, 2, false)).toMatchObject({ stars: 3, perfect: true });
    expect(scoreSolve(2, 2, true)).toMatchObject({ stars: 2, perfect: false });
    expect(scoreSolve(3, 2, false)).toMatchObject({ stars: 2, perfect: false });
    expect(scoreSolve(5, 2, false)).toMatchObject({ stars: 1, perfect: false });
  });

  it('keeps the best stars and the fewest folds across tries', () => {
    const a = mergeBest(undefined, scoreSolve(4, 2, false));
    const b = mergeBest(a, scoreSolve(2, 2, true));
    expect(b).toEqual({ stars: 2, folds: 2 });
    expect(mergeBest(b, scoreSolve(6, 2, false))).toEqual({ stars: 2, folds: 2 });
  });

  it('opens worlds as stars add up', () => {
    expect(totalStars({ a: { stars: 3, folds: 1 }, b: { stars: 2, folds: 2 } })).toBe(5);
    expect(worldOpen(0, 0)).toBe(true);
    expect(worldOpen(1, 0)).toBe(true);
    expect(worldOpen(2, UNLOCK[2] - 1)).toBe(false);
    expect(worldOpen(2, UNLOCK[2])).toBe(true);
    expect(worldOpen(8, 999)).toBe(false);
  });
});
