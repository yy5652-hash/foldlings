import { describe, expect, it } from 'vitest';
import { FlashFold, flashPool } from './flash-fold.js';
import { Pause } from './pause.js';

describe('Flash Fold', () => {
  it('draws solved campaign puzzles only, falling back to world zero below three unique solves', () => {
    const levels = [{ id: 'a', world: 0 }, { id: 'b', world: 0 }, { id: 'c', world: 1 }, { id: 'd', world: 2 }, { id: 'daily', world: -1 }];
    expect(flashPool(levels, ['c', 'c', 'daily', 'unknown'])).toEqual([0, 1]);
    expect(flashPool(levels, ['b', 'c', 'd'])).toEqual([1, 2, 3]);
  });
  it('has a deterministic seeded shuffle with every puzzle once per bag and no adjacent repeat', () => {
    const draw = (seed: number) => {
      const f = new FlashFold([1, 2, 3, 4], seed);
      const order = [f.current];
      for (let i = 0; i < 19; i++) { f.solve(); order.push(f.current); }
      return order;
    };
    const a = draw(42);
    expect(a).toEqual(draw(42));
    expect(a).not.toEqual(draw(8));
    for (let i = 0; i < a.length; i += 4) expect(new Set(a.slice(i, i + 4)).size).toBe(4);
    for (let i = 1; i < a.length; i++) expect(a[i]).not.toBe(a[i - 1]);
  });
  it('scores each solve and adds five seconds, capping the current clock at ninety', () => {
    const f = new FlashFold([0], 0);
    expect(f.remaining).toBe(60);
    f.tick(2.5); f.solve();
    expect(f.remaining).toBe(62.5);
    for (let i = 0; i < 10; i++) f.solve();
    expect(f.score).toBe(11);
    expect(f.remaining).toBe(90);
    expect(f.current).toBe(0);
  });
  it('expires exactly at zero, refuses late solves and can be cancelled without a score mutation', () => {
    const f = new FlashFold([0], 2);
    f.tick(59.9); expect(f.active).toBe(true);
    f.tick(0.2); expect(f.remaining).toBe(0);
    expect(f.solve()).toBe(false); expect(f.score).toBe(0);
    const cancelled = new FlashFold([0], 2);
    cancelled.solve(); cancelled.cancel(); cancelled.tick(100);
    expect(cancelled.remaining).toBe(65);
    expect(cancelled.solve()).toBe(false);
    expect(cancelled.score).toBe(1);
  });
  it('freezes across pause.ts visibility transitions and ignores invalid deltas', () => {
    const f = new FlashFold([0], 1), pause = new Pause();
    const paused = pause.transition(true, false, 10) === 'pause';
    f.tick(100, paused); expect(f.remaining).toBe(60);
    expect(pause.transition(false, true, 110)).toBe('remind');
    f.tick(1); expect(f.remaining).toBe(59);
    for (const dt of [-1, NaN, Infinity]) f.tick(dt);
    expect(f.remaining).toBe(59);
    expect(() => new FlashFold([], 1)).toThrow(RangeError);
  });
});
