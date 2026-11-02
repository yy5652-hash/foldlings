import { describe, expect, it } from 'vitest';
import { applyFolds, type FoldSpec } from '../fold/paper.js';
import { dailyLevel, LEVELS } from './levels.js';
import { encodeFolds } from './share.js';
import { serialiseSheet, validateSheet } from './resume.js';

const played = LEVELS[0].solution.slice(0, 1);
const sheet = () => ({ id: LEVELS[0].id, played, hinted: true });

describe('sheet resume', () => {
  it('round trips committed folds and hinted through JSON without changing the paper', () => {
    const saved = serialiseSheet(LEVELS[0].id, played, true);
    const restored = validateSheet(JSON.parse(JSON.stringify(saved)));
    expect(restored).toEqual(sheet());
    expect(applyFolds(restored!.played)).toEqual(applyFolds(played));
  });

  it('saves an empty restarted sheet and an undone prefix', () => {
    expect(serialiseSheet(LEVELS[0].id, [], false)).toEqual({ id: LEVELS[0].id, played: [], hinted: false });
    const folds = LEVELS[3].solution;
    expect(validateSheet({ id: LEVELS[3].id, played: folds.slice(0, -1), hinted: true })?.played).toEqual(folds.slice(0, -1));
  });

  it('copies fold values so later changes cannot mutate a saved sheet', () => {
    const folds = played.map((fold) => ({ ...fold }));
    const saved = serialiseSheet(LEVELS[0].id, folds, false)!;
    folds[0].s = folds[0].s === 1 ? -1 : 1;
    folds.length = 0;
    expect(saved.played).toEqual(played);
  });

  it('keeps only today\'s Daily Fold', () => {
    const daily = { id: dailyLevel(20000).id, played: [], hinted: false };
    expect(validateSheet(daily, 20000)).toEqual(daily);
    expect(validateSheet(daily, 20001)).toBeNull();
  });

  it('keeps custom and shared puzzles without requiring a collection entry', () => {
    const custom = { ...sheet(), id: `my-${encodeFolds(LEVELS[0].solution)}` };
    expect(validateSheet(custom)).toEqual(custom);
    expect(validateSheet({ ...custom, id: 'my-invalid' })).toBeNull();
  });

  it('ignores missing, corrupt, stale and free-fold sheets', () => {
    for (const value of [null, undefined, 4, 'bad', {}, [], { ...sheet(), id: 'gone' }, { ...sheet(), id: 'free' },
      { ...sheet(), played: null }, { ...sheet(), hinted: 'true' }, { ...sheet(), played: [null] },
      { ...sheet(), played: [{ f: 'x', k: 0, s: 1 }] }, { ...sheet(), played: [{ f: 'u', k: NaN, s: 1 }] },
      { ...sheet(), played: [{ f: 'u', k: 0, s: 0 }] }, { ...sheet(), played: Array(201).fill(played[0]) }]) {
      expect(() => validateSheet(value)).not.toThrow();
      expect(validateSheet(value)).toBeNull();
    }
  });

  it('rejects a sequence whose next fold cannot be applied', () => {
    const fold: FoldSpec = { f: 'u', k: 0, s: 1 };
    expect(validateSheet({ ...sheet(), played: [fold, fold] })).toBeNull();
  });

  it('accepts a full sequence as data without evaluating a solve', () => {
    const saved = serialiseSheet(LEVELS[0].id, LEVELS[0].solution, true);
    expect(saved?.played).toEqual(LEVELS[0].solution);
    expect(saved?.hinted).toBe(true);
  });
});
