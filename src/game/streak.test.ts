import { describe, expect, it } from 'vitest';
import { streak } from './streak.js';

describe('daily streak saves', () => {
  it('counts solved days only, forgiving one missed day', () => {
    expect(streak([10, 11, 13, 14, 15], 15)).toEqual({ count: 5, saved: 1 });
  });

  it('breaks at a second missed day within seven days', () => {
    expect(streak([10, 12, 14, 15], 15)).toEqual({ count: 2, saved: 0 });
    expect(streak([10, 13], 13)).toEqual({ count: 1, saved: 0 });
  });

  it('allows another save exactly seven calendar days later', () => {
    expect(streak([10, 12, 13, 14, 15, 16, 17, 19], 19)).toEqual({ count: 8, saved: 2 });
    expect(streak([10, 12, 13, 14, 15, 16, 18], 18)).toEqual({ count: 1, saved: 0 });
  });

  it('keeps yesterday and a saved missed yesterday alive, then expires', () => {
    expect(streak([10], 11)).toEqual({ count: 1, saved: 0 });
    expect(streak([10], 12)).toEqual({ count: 1, saved: 1 });
    expect(streak([10], 13)).toEqual({ count: 0, saved: 0 });
    expect(streak([10, 12], 14)).toEqual({ count: 0, saved: 0 });
  });

  it('ignores duplicate, future and invalid days, and handles an empty save', () => {
    expect(streak([12, 10, 10, 11, 99, NaN, 11.5], 12)).toEqual({ count: 3, saved: 0 });
    expect(streak([], 12)).toEqual({ count: 0, saved: 0 });
  });
});
