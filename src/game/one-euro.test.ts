import { describe, expect, it } from 'vitest';
import { OneEuro } from './one-euro.js';

describe('One Euro filter', () => {
  it('lags a 0.5 m/s ramp by at most 5 mm at 72 Hz, including startup', () => {
    const filter = new OneEuro();
    filter.reset(0);
    for (let i = 1; i <= 360; i++) {
      const value = i * 0.5 / 72;
      const result = filter.filter(value, 1 / 72);
      expect(value - result).toBeLessThanOrEqual(0.005);
    }
  });

  it('removes at least 60% of stationary 2 mm RMS noise', () => {
    const filter = new OneEuro();
    filter.reset(0);
    let seed = 17;
    let raw = 0;
    let smooth = 0;
    for (let i = 0; i < 7200; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = (seed / 4294967296 - 0.5) * Math.sqrt(12) * 0.002;
      const value = filter.filter(noise, 1 / 72);
      if (i >= 720) { raw += noise * noise; smooth += value * value; }
    }
    expect(Math.sqrt(smooth / raw)).toBeLessThanOrEqual(0.4);
  });

  it('resets both the signal and its velocity and holds on zero dt', () => {
    const filter = new OneEuro();
    filter.filter(3, 0.1);
    filter.reset(1);
    expect(filter.filter(2, 0)).toBe(1);
    expect(filter.filter(1, 0.1)).toBe(1);
  });
});
