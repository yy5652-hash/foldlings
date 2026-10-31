import { describe, expect, it } from 'vitest';
import { applyFolds, rasterize } from '../fold/paper.js';
import { LEVELS, PER_WORLD, WORLDS, customLevel } from './levels.js';

const SIDE = Math.round(Math.sqrt(rasterize(applyFolds([])!).length));

/** A picture and all its turns and mirror images, as one key. */
function canonical(r: Uint8Array): string {
  let best = '';
  for (let t = 0; t < 8; t++) {
    const o = new Uint8Array(r.length);
    for (let j = 0; j < SIDE; j++)
      for (let i = 0; i < SIDE; i++) {
        let x = i;
        let y = j;
        if (t & 1) [x, y] = [y, x];
        if (t & 2) x = SIDE - 1 - x;
        if (t & 4) y = SIDE - 1 - y;
        o[y * SIDE + x] = r[j * SIDE + i];
      }
    const k = o.join('');
    if (!best || k < best) best = k;
  }
  return best;
}

describe('campaign', () => {
  it('has eight worlds of ten with unique ids, keeping the original twelve', () => {
    expect(LEVELS).toHaveLength(WORLDS.length * PER_WORLD);
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length);
    for (const id of ['crane', 'frog', 'boat', 'fish', 'fox', 'butterfly', 'rabbit', 'whale', 'crane-2', 'frog-2', 'fox-2', 'whale-2']) {
      expect(LEVELS.some((l) => l.id === id)).toBe(true);
    }
    LEVELS.forEach((l, i) => {
      expect(l.world).toBe(Math.floor(i / PER_WORLD));
      expect(l.creature).toBe(WORLDS[l.world].kind);
    });
  });

  it('every level folds from its own solution, with par no more than its length', () => {
    for (const l of LEVELS) {
      expect(applyFolds(l.solution), l.id).not.toBeNull();
      expect(l.par, l.id).toBeGreaterThanOrEqual(1);
      expect(l.par, l.id).toBeLessThanOrEqual(l.solution.length);
    }
  });

  it('never repeats a picture, even turned or mirrored', () => {
    const keys = LEVELS.map((l) => canonical(rasterize(applyFolds(l.solution)!)));
    expect(new Set(keys).size).toBe(LEVELS.length);
  });

  it('gets harder through each world', () => {
    for (let w = 0; w < WORLDS.length; w++) {
      const pars = LEVELS.filter((l) => l.world === w).map((l) => l.par);
      expect(pars[pars.length - 1]).toBeGreaterThanOrEqual(pars[0]);
    }
  });
});

describe('customLevel', () => {
  it('always has a paper look, even when the code hashes above 2^31', () => {
    for (const code of ['1D27P', '1B2507T', '121F1W29T', 'ZZZZZZZZZZ', '9W9W9W9W9']) {
      expect(customLevel(code, 0).look).toBeDefined();
    }
  });
});
