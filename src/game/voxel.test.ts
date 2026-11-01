import { describe, expect, it } from 'vitest';
import { voxelize } from './voxel.js';

/** A closed axis-aligned box, as twelve triangles. */
function box(h: number): number[] {
  const c = [
    [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
    [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h],
  ];
  const faces = [
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
    [0, 4, 5], [0, 5, 1], [3, 2, 6], [3, 6, 7],
    [0, 3, 7], [0, 7, 4], [1, 5, 6], [1, 6, 2],
  ];
  return faces.flatMap((f) => f.flatMap((v) => c[v]));
}

const sample = (g: ReturnType<typeof voxelize>, x: number, y: number, z: number, ch: 0 | 1) => {
  const i = Math.min(g.nx - 1, Math.floor(((x - g.min[0]) / g.size[0]) * g.nx));
  const j = Math.min(g.ny - 1, Math.floor(((y - g.min[1]) / g.size[1]) * g.ny));
  const k = Math.min(g.nz - 1, Math.floor(((z - g.min[2]) / g.size[2]) * g.nz));
  return g.data[(i + g.nx * (j + g.ny * k)) * 2 + ch];
};

describe('voxelize', () => {
  it('finds the inside of a closed solid', () => {
    const g = voxelize(box(0.1), 32, 0.02, 0.03);
    expect(sample(g, 0, 0, 0, 1)).toBeGreaterThan(200);
    expect(sample(g, 0, 0, 0, 0)).toBe(0);
  });

  it('gives a surface thickness, fading with distance', () => {
    const g = voxelize(box(0.1), 32, 0.02, 0.03);
    const on = sample(g, 0.1, 0, 0, 0);
    const near = sample(g, 0.112, 0, 0, 0);
    const far = sample(g, 0.128, 0, 0, 0);
    expect(on).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(0);
    expect(far).toBe(0);
  });

  it('leaves open air empty', () => {
    const g = voxelize(box(0.1), 32, 0.02, 0.03);
    expect(sample(g, 0.128, 0.128, 0.128, 1)).toBe(0);
  });

  it('treats a flat sheet as all shell and no inside', () => {
    const sheet = [-0.1, 0, -0.1, 0.1, 0, -0.1, 0.1, 0, 0.1, -0.1, 0, -0.1, 0.1, 0, 0.1, -0.1, 0, 0.1];
    const g = voxelize(sheet, 32, 0.02, 0.03);
    expect(sample(g, 0, 0, 0, 0)).toBeGreaterThan(150);
    for (let i = 0; i < g.data.length; i += 2) expect(g.data[i + 1]).toBe(0);
  });

  it('keeps the grid within the requested resolution', () => {
    const g = voxelize(box(0.1), 24, 0.02, 0.03);
    expect(Math.max(g.nx, g.ny, g.nz)).toBeLessThanOrEqual(25);
    expect(g.data.length).toBe(g.nx * g.ny * g.nz * 2);
  });
});
