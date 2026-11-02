import { describe, expect, it } from 'vitest';
import { classifyView, fitPanel, projectionAngles, type ViewAngles } from './fov.js';

const glasses = { left: 37, right: 37, up: 25, down: 43 };
const quest = { left: 55, right: 55, up: 48, down: 48 };
const rad = Math.PI / 180;

function projection(v: ViewAngles) {
  const l = Math.tan(v.left * rad), r = Math.tan(v.right * rad);
  const u = Math.tan(v.up * rad), d = Math.tan(v.down * rad);
  const m = new Float32Array(16);
  m[0] = 2 / (l + r);
  m[5] = 2 / (u + d);
  m[8] = (r - l) / (r + l);
  m[9] = (u - d) / (u + d);
  return m;
}

describe('view angles', () => {
  it('extracts asymmetric XR projection angles in column-major order', () => {
    for (const profile of [glasses, quest, { left: 42, right: 51, up: 31, down: 47 }]) {
      const actual = projectionAngles(projection(profile));
      for (const key of ['left', 'right', 'up', 'down'] as const) expect(actual[key]).toBeCloseTo(profile[key], 4);
    }
  });

  it('classifies glasses, Quest and the exact thresholds', () => {
    expect(classifyView(glasses)).toBe('narrow');
    expect(classifyView(quest)).toBe('wide');
    expect(classifyView({ left: 45, right: 45, up: 30, down: 43 })).toBe('wide');
    expect(classifyView({ ...quest, right: 44 })).toBe('narrow');
    expect(classifyView({ ...quest, up: 29 })).toBe('narrow');
  });
});

describe('panel fitting', () => {
  it('keeps small Quest panels unchanged', () => {
    expect(fitPanel(0.5, 0.36, 0.52, quest)).toEqual({ scale: 1, pitch: 0 });
  });

  it('lowers a small glasses menu without shrinking it', () => {
    expect(fitPanel(0.414, 0.222, 0.45, glasses)).toEqual({ scale: 1, pitch: 5 });
  });

  it('lowers tall panels and scales oversized panels inside the 90% view', () => {
    for (const profile of [glasses, quest]) for (const [w, h, d] of [[0.34, 0.55, 0.45], [1.4, 1.2, 0.45], [0.38, 0.12, 0.45]]) {
      const fit = fitPanel(w, h, d, profile);
      expect(fit.scale).toBeGreaterThan(0);
      expect(fit.scale).toBeLessThanOrEqual(1);
      const v = Math.atan(h * fit.scale / (2 * d)) / rad;
      expect(v - fit.pitch).toBeLessThanOrEqual(profile.up * 0.9 + 1e-8);
      expect(v + fit.pitch).toBeLessThanOrEqual(profile.down * 0.9 + 1e-8);
      const near = d * Math.cos(fit.pitch * rad) - h * fit.scale / 2 * Math.sin(fit.pitch * rad);
      expect(Math.atan(w * fit.scale / (2 * near)) / rad).toBeLessThanOrEqual(Math.min(profile.left, profile.right) * 0.9 + 1e-8);
    }
    expect(fitPanel(0.34, 0.55, 0.45, glasses).pitch).toBeGreaterThan(0);
  });
});
