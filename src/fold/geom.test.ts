import { describe, expect, it } from 'vitest';
import { clipConvex, closestOnConvex, lineChord, polygonArea, unionOutline, V2 } from './geom.js';

const square = (x0: number, y0: number, s: number): V2[] => [
  { x: x0, y: y0 },
  { x: x0 + s, y: y0 },
  { x: x0 + s, y: y0 + s },
  { x: x0, y: y0 + s },
];

const total = (segs: [V2, V2][]) => segs.reduce((a, [p, q]) => a + Math.hypot(q.x - p.x, q.y - p.y), 0);

describe('geometry helpers', () => {
  it('clips a square in half', () => {
    const half = clipConvex(square(0, 0, 1), { nx: 1, ny: 0, d: 0.5 }, 1);
    expect(polygonArea(half)).toBeCloseTo(0.5, 9);
  });

  it('finds the chord a line cuts through a polygon', () => {
    const c = lineChord({ nx: 0, ny: 1, d: 0.25 }, square(0, 0, 1))!;
    expect(Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y)).toBeCloseTo(1, 9);
    expect(lineChord({ nx: 0, ny: 1, d: 3 }, square(0, 0, 1))).toBeNull();
  });

  it('snaps an outside point to the nearest edge', () => {
    const p = closestOnConvex(square(0, 0, 1), { x: 1.5, y: 0.5 });
    expect(p.x).toBeCloseTo(1, 9);
    expect(p.y).toBeCloseTo(0.5, 9);
  });

  it('outlines two touching squares without the shared edge', () => {
    const segs = unionOutline([square(0, 0, 0.1), square(0.1, 0, 0.1)], 0.005);
    expect(total(segs)).toBeCloseTo(0.6, 3);
  });
});
