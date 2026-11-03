import { describe, expect, it } from 'vitest';
import { islandProgress } from './island-progress.js';
import { LEVELS, PER_WORLD, WORLDS } from './levels.js';

describe('island progress', () => {
  it('starts each explicit unlocked world at its first level, with no lit terraces', () => {
    for (let w = 0; w < WORLDS.length; w++) {
      expect(islandProgress(w, [], [0, 1])).toEqual({
        solved: 0, litFraction: 0, unlocked: w < 2, nextLevelIndex: w * PER_WORLD,
      });
    }
  });

  it('finds the first hole rather than using solved count as a level offset', () => {
    const first = 3 * PER_WORLD;
    const solved = [LEVELS[first].id, LEVELS[first + 2].id, LEVELS[first + 8].id];
    expect(islandProgress(3, solved, [3])).toEqual({
      solved: 3, litFraction: 0.3, unlocked: true, nextLevelIndex: first + 1,
    });
  });

  it('counts unique campaign IDs only, within the requested world', () => {
    const ids = [LEVELS[0].id, LEVELS[0].id, LEVELS[10].id, 'daily-42', 'free', 'my-code', 'unknown'];
    expect(islandProgress(0, ids, []).solved).toBe(1);
    expect(islandProgress(1, ids, []).solved).toBe(1);
    expect(islandProgress(2, ids, []).solved).toBe(0);
    expect(ids).toHaveLength(7);
  });

  it('returns the first level for a completed world and saturates at one', () => {
    const ids = LEVELS.map(l => l.id);
    for (let w = 0; w < WORLDS.length; w++) {
      expect(islandProgress(w, [...ids, ...ids], [w])).toEqual({
        solved: 10, litFraction: 1, unlocked: true, nextLevelIndex: w * PER_WORLD,
      });
    }
  });

  it('keeps unlocks independent of solves and of completed-world history', () => {
    const ids = LEVELS.slice(20, 30).map(l => l.id);
    expect(islandProgress(2, ids, [0, 1]).unlocked).toBe(false);
    expect(islandProgress(7, [], [7]).unlocked).toBe(true);
  });

  it('rejects daily, custom and invalid world indices', () => {
    for (const w of [-3, -2, -1, 8, 0.5, NaN, Infinity]) {
      expect(() => islandProgress(w, [], [])).toThrow(RangeError);
    }
  });
});
