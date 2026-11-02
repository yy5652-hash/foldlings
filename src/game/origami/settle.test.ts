import { describe, expect, it } from 'vitest';
import type { Position } from './relax.js';
import { applyRest, centreOfMass, settle } from './settle.js';

/** A square plate of side 2 lying flat, with one triangle fan per corner pair. */
const plate = (pose: (p: Position) => Position) => ({
  points: ([[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]] as Position[]).map(pose),
  triangles: [[0, 1, 2], [0, 2, 3]],
});

describe('settle', () => {
  it('leaves a stable sheet exactly as it is', () => {
    const { points, triangles } = plate(p => p);
    const rest = settle(points, triangles);
    expect(rest.tilt).toBeCloseTo(0, 9);
    expect(rest.margin).toBeCloseTo(1, 9);
  });

  it('lays a plate balanced on one edge down flat', () => {
    // Tilted 40 degrees about the x = -1 edge, so the far edge hangs in the air.
    const angle = (40 * Math.PI) / 180;
    const { points, triangles } = plate(([x, , z]) => [-1 + (x + 1) * Math.cos(angle), (x + 1) * Math.sin(angle), z]);
    const rest = settle(points, triangles);
    const settled = points.map(p => applyRest(rest, p));
    const ys = settled.map(p => p[1]);
    expect(rest.tilt).toBeCloseTo(40, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1e-9);
  });

  it('keeps every length while it falls', () => {
    const { points, triangles } = plate(([x, y, z]) => [x * 0.9 + y * 0.1, 0.3 * x + 0.5 * z + y, z]);
    const rest = settle(points, triangles);
    const settled = points.map(p => applyRest(rest, p));
    points.forEach((p, i) => {
      const before = Math.hypot(p[0] - points[0][0], p[1] - points[0][1], p[2] - points[0][2]);
      const after = Math.hypot(settled[i][0] - settled[0][0], settled[i][1] - settled[0][1], settled[i][2] - settled[0][2]);
      expect(after).toBeCloseTo(before, 9);
    });
    expect(rest.margin).toBeGreaterThanOrEqual(0);
  });

  it('weighs a sheet by area', () => {
    const points: Position[] = [[0, 0, 0], [3, 0, 0], [0, 0, 3], [3, 0, 3], [4, 0, 3]];
    const com = centreOfMass(points, [[0, 1, 2], [1, 3, 4]]);
    expect(com[0]).toBeCloseTo((4.5 * 1 + 1.5 * (10 / 3)) / 6, 9);
  });
});
