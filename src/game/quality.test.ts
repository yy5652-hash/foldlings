import { describe, expect, it } from 'vitest';
import { QualityGuard } from './quality.js';

const run = (g: QualityGuard, seconds: number, fps: number) => {
  let drops = 0;
  for (let t = 0; t < seconds; t += 1 / fps) if (g.update(1 / fps)) drops++;
  return drops;
};

describe('QualityGuard', () => {
  it('holds at full quality at 72 fps', () => {
    const g = new QualityGuard();
    expect(run(g, 30, 72)).toBe(0);
    expect(g.level).toBe(0);
  });

  it('steps down at 50 fps, and only as far as allowed', () => {
    const g = new QualityGuard(2);
    expect(run(g, 40, 50)).toBe(2);
    expect(g.level).toBe(2);
  });

  it('ignores the first seconds, while the session settles', () => {
    const g = new QualityGuard();
    expect(run(g, 5, 30)).toBe(0);
  });

  it('does not count a long pause as a slow frame rate', () => {
    const g = new QualityGuard();
    run(g, 7, 72);
    for (let i = 0; i < 40; i++) expect(g.update(1)).toBe(false);
    expect(g.level).toBe(0);
  });
});
