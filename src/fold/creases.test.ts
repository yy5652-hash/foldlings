import { expect, it } from 'vitest';
import { prepareSnaps, rawCrease, Snap, snapCrease } from './creases.js';
import { applyFold, initialPaper } from './paper.js';

it('precomputed candidates preserve target selection, hysteresis and commit decisions', () => {
  for (const paper of [initialPaper(), applyFold(initialPaper(), { f: 'u', k: 0, s: -1 })!]) {
    const p = paper.facets[paper.facets.length - 1].poly[0];
    const candidates = prepareSnaps(paper, p);
    const raw = { nx: 0, ny: 0, d: 0 };
    let previous: Snap | null = null;
    for (let i = 0; i < 240; i++) {
      const hand = { x: p.x + 0.18 * Math.cos(i * 0.1), y: p.y + 0.18 * Math.sin(i * 0.1), h: i % 3 ? 0 : 0.07 };
      expect(rawCrease(p, hand, raw)).toBe(raw);
      const expected = snapCrease(raw, p, paper, previous);
      const actual = snapCrease(raw, p, paper, previous, 0.05, candidates);
      expect(actual).toEqual(expected);
      if (actual) expect(candidates.includes(actual)).toBe(true);
      previous = actual;
    }
  }
});
