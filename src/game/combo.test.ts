import { describe, expect, it } from 'vitest';
import { Combo } from './combo.js';

describe('campaign combo', () => {
  it('starts at x1, accepts under par and caps at x5', () => {
    const c = new Combo();
    expect(c.value).toBe(0);
    expect(c.solve(1, 2, false)).toBe(1);
    for (let i = 2; i <= 8; i++) expect(c.solve(2, 2, false)).toBe(Math.min(5, i));
  });
  it('breaks on over par, hints and explicit undo-to-empty, then starts fresh', () => {
    const c = new Combo();
    for (const fail of [() => c.solve(3, 2, false), () => c.solve(1, 2, true), () => c.break()]) {
      c.solve(1, 1, false);
      c.solve(1, 1, false);
      fail();
      expect(c.value).toBe(0);
      expect(c.solve(1, 1, false)).toBe(1);
    }
    expect(new Combo().value).toBe(0);
  });
});
