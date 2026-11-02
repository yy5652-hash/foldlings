import { describe, expect, it } from 'vitest';
import { PinchPull } from './pinch-pull.js';

const hit = { minX: 0, maxX: 1, minY: -1, maxY: 1 };
describe('pinch pull', () => {
  it('commits once on release beyond halfway and clamps progress', () => {
    const pull = new PinchPull(0.08, hit);
    pull.update(true, 0.5, 0, 0, 0.01);
    pull.update(true, -2, 0, 0.1, 0.01);
    expect(pull.progress).toBe(1);
    expect(pull.commit).toBe(false);
    pull.update(false, -2, 0, 0.1, 0.01);
    expect(pull.commit).toBe(true);
    pull.update(false, -2, 0, 0.1, 0.01);
    expect(pull.commit).toBe(false);
  });

  it('springs back at halfway or when pulling in the wrong direction', () => {
    const pull = new PinchPull(0.08, hit);
    pull.update(true, 0.5, 0, 0, 0.01);
    pull.update(false, 0.5, 0, 0.04, 0.01);
    expect(pull.commit).toBe(false);
    pull.update(false, 0.5, 0, 0.04, 1);
    expect(pull.progress).toBe(0);
    pull.update(true, 0.5, 0, 0, 0.01);
    pull.update(true, 0.5, 0, -1, 0.01);
    expect(pull.progress).toBe(0);
  });

  it('requires pinch onset inside the rectangle and near the panel', () => {
    const pull = new PinchPull(0.08, hit);
    pull.update(true, 2, 0, 0, 0.01);
    pull.update(true, 0.5, 0, 1, 0.01);
    expect(pull.active).toBe(false);
    pull.reset();
    pull.update(true, 0.5, 0, 0, 0.01, false);
    expect(pull.active).toBe(false);
    pull.reset(true);
    pull.update(true, 0.5, 0, 0, 0.01);
    expect(pull.active).toBe(false);
  });
});
