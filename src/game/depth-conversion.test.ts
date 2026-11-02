import { describe, expect, it } from 'vitest';
import { biasedDepth } from './depth-conversion.js';

describe('depth bias', () => {
  it.each([0.01, 0.1])('moves finite depth back exactly 3 cm with near %s', (near) => {
    const far = 10;
    for (const metres of [near, 0.4, 1, 5]) {
      const raw = far * (metres - near) / (metres * (far - near));
      const biased = biasedDepth(raw, near, far);
      const eye = near * far / (far - biased * (far - near));
      expect(eye).toBeCloseTo(metres + 0.03, 9);
      expect(biased).toBeGreaterThan(raw);
    }
  });

  it('handles an infinite far plane', () => {
    for (const metres of [0.01, 0.4, 1, 100]) {
      const raw = 1 - 0.01 / metres;
      const biased = biasedDepth(raw, 0.01, Infinity);
      expect(0.01 / (1 - biased)).toBeCloseTo(metres + 0.03, 7);
    }
  });

  it('preserves missing data and clamps beyond a finite far plane', () => {
    expect(biasedDepth(1, 0.01, 10)).toBe(1);
    expect(biasedDepth(1, 0.01, Infinity)).toBe(1);
    expect(biasedDepth(0.999999, 0.01, 10)).toBe(1);
    expect(biasedDepth(0.6, 0.01, 10, 0)).toBeCloseTo(0.6, 12);
  });
});
