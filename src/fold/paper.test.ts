import { describe, expect, it } from 'vitest';
import { rawCrease, snapCrease } from './creases.js';
import { applyAffine, polygonArea } from './geom.js';
import {
  applyFolds,
  BOARD,
  creaseLine,
  foldPaper,
  initialPaper,
  PaperState,
  RASTER_H,
  RASTER_W,
  rasterize,
  rasterMatch,
  topFacetAt,
} from './paper.js';

const cellArea =
  ((BOARD.maxX - BOARD.minX) / RASTER_W) * ((BOARD.maxY - BOARD.minY) / RASTER_H);

function count(r: Uint8Array, v: number): number {
  return r.reduce((n, x) => n + (x === v ? 1 : 0), 0);
}

function totalArea(s: PaperState): number {
  return s.facets.reduce((a, f) => a + polygonArea(f.poly), 0);
}

describe('folding engine', () => {
  it('starts as one front-up square', () => {
    const r = rasterize(initialPaper());
    expect(count(r, 2)).toBe(0);
    expect(count(r, 1) * cellArea).toBeCloseTo(0.04, 3);
  });

  it('diagonal fold makes a back-up triangle on top', () => {
    const s = applyFolds([{ f: 'a', k: 0, s: 1 }])!;
    expect(s.facets).toHaveLength(2);
    const r = rasterize(s);
    expect(count(r, 1)).toBe(0);
    expect(count(r, 2) * cellArea).toBeCloseTo(0.02, 2);
    const top = topFacetAt(s, { x: -0.05, y: -0.05 })!;
    expect(top.flipped).toBe(true);
    expect(top.layer).toBe(1);
  });

  it('keeps total area and maps every vertex back onto the sheet', () => {
    const s = applyFolds([
      { f: 'u', k: 0, s: -1 },
      { f: 'v', k: 0, s: 1 },
      { f: 'd', k: 1, s: 1 },
    ])!;
    expect(s).not.toBeNull();
    expect(totalArea(s)).toBeCloseTo(0.04, 9);
    for (const f of s.facets) {
      for (const p of f.poly) {
        const q = applyAffine(f.toSheet, p);
        expect(Math.abs(q.x)).toBeLessThanOrEqual(0.1 + 1e-9);
        expect(Math.abs(q.y)).toBeLessThanOrEqual(0.1 + 1e-9);
      }
    }
  });

  it('rejects a crease that misses the paper', () => {
    expect(foldPaper(initialPaper(), creaseLine({ f: 'u', k: 3 }), 1)).toBeNull();
  });

  it('two different sequences reaching the same shape match exactly', () => {
    const a = applyFolds([
      { f: 'u', k: 0, s: 1 },
      { f: 'v', k: 0, s: 1 },
    ])!;
    const b = applyFolds([
      { f: 'v', k: 0, s: 1 },
      { f: 'u', k: 0, s: 1 },
    ])!;
    expect(rasterMatch(rasterize(a), rasterize(b))).toBe(1);
  });
});

describe('crease from a hand motion', () => {
  it('corner to opposite corner snaps to the diagonal', () => {
    const p = { x: 0.098, y: 0.097 };
    const raw = rawCrease(p, { x: -0.095, y: -0.1, h: 0.02 })!;
    const snap = snapCrease(raw, p, initialPaper())!;
    expect(snap.f).toBe('a');
    expect(snap.k).toBe(0);
    expect(snap.s).toBe(1);
  });

  it('lifting straight up does not fold', () => {
    expect(rawCrease({ x: 0.1, y: 0.1 }, { x: 0.101, y: 0.1, h: 0.1 })).toBeNull();
  });

  it('half fold from the right edge snaps to the centre line', () => {
    const p = { x: 0.09, y: 0.02 };
    const raw = rawCrease(p, { x: -0.085, y: 0.025, h: 0.03 })!;
    const snap = snapCrease(raw, p, initialPaper())!;
    expect(snap.f).toBe('u');
    expect(snap.k).toBe(0);
    expect(snap.s).toBe(1);
  });
});

describe('levels', async () => {
  const { LEVELS, DAILY } = await import('./levels-fixture.js');
  it('every campaign and daily solution folds cleanly inside the board', () => {
    for (const l of [...LEVELS, ...DAILY]) {
      const s = applyFolds(l.solution);
      expect(s, l.id).not.toBeNull();
    }
  });
});

describe('daily fold', async () => {
  const { dailyLevel } = await import('../game/levels.js');
  it('is the same picture for the same day and changes day to day', () => {
    const a = dailyLevel(20400);
    expect(dailyLevel(20400).solution).toEqual(a.solution);
    const days = new Set(Array.from({ length: 30 }, (_, i) => JSON.stringify(dailyLevel(20400 + i).solution)));
    expect(days.size).toBe(30);
  });
});
