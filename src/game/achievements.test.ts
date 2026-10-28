/** Achievement thresholds and display order. */

import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, earnedIds, newlyEarned, type AchievementStats } from './achievements.js';

const zero: AchievementStats = {
  solves: 0, perfects: 0, worldsDone: 0, flawlessWorlds: 0,
  streak: 0, kinds: 0, zoo: 0, palmRides: 0, waves: 0,
};

const full: AchievementStats = {
  solves: 80, perfects: 80, worldsDone: 8, flawlessWorlds: 8,
  streak: 30, kinds: 8, zoo: 100, palmRides: 10, waves: 10,
};

const ids = [
  'first-fold', 'perfect', 'perfect-10', 'world', 'worlds-3', 'flawless',
  'streak-3', 'streak-7', 'album', 'zoo-25', 'palm', 'wave',
];

describe('achievements', () => {
  it('has twelve unique ids in display order', () => {
    expect(ACHIEVEMENTS.map(({ id }) => id)).toEqual(ids);
    expect(new Set(ACHIEVEMENTS.map(({ id }) => id)).size).toBe(12);
  });

  it('earns nothing from zero stats', () => {
    expect(earnedIds(zero)).toEqual([]);
    expect(newlyEarned(zero, [])).toEqual([]);
  });

  const boundaries: [string, keyof AchievementStats, number][] = [
    ['first-fold', 'solves', 1],
    ['perfect', 'perfects', 1],
    ['perfect-10', 'perfects', 10],
    ['world', 'worldsDone', 1],
    ['worlds-3', 'worldsDone', 3],
    ['flawless', 'flawlessWorlds', 1],
    ['streak-3', 'streak', 3],
    ['streak-7', 'streak', 7],
    ['album', 'kinds', 8],
    ['zoo-25', 'zoo', 25],
    ['palm', 'palmRides', 1],
    ['wave', 'waves', 1],
  ];

  for (const [id, stat, minimum] of boundaries) {
    it(`earns ${id} exactly at its threshold`, () => {
      const below = earnedIds({ ...zero, [stat]: minimum - 1 });
      const at = earnedIds({ ...zero, [stat]: minimum });
      expect(below).not.toContain(id);
      expect(at).toContain(id);
      expect(at.filter((earned) => !below.includes(earned))).toEqual([id]);
    });
  }

  it('excludes already-earned ids and keeps display order', () => {
    const already: readonly string[] = ['wave', 'world', 'perfect', 'perfect', 'unknown'];
    expect(newlyEarned(full, already)).toEqual([
      'first-fold', 'perfect-10', 'worlds-3', 'flawless',
      'streak-3', 'streak-7', 'album', 'zoo-25', 'palm',
    ]);
    expect(newlyEarned({ ...zero, waves: 1 }, ['first-fold'])).toEqual(['wave']);
    expect(newlyEarned(full, ids)).toEqual([]);
  });

  it('earns all twelve from full stats in display order', () => {
    expect(earnedIds(full)).toEqual(ids);
  });
});
