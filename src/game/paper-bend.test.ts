import { describe, expect, it } from 'vitest';
import { bendPoint, BendPose } from '../fold/bend.js';
import { applyAffine } from '../fold/geom.js';
import { initialPaper } from '../fold/paper.js';
import { createBendBuffers, writeBentFacet, writeBentWalls } from './paper-bend.js';

const pose: BendPose = { nx: 0.6, ny: 0.8, d: 0.003, theta: 2.1, radius: 0.012, residual: 0 };

describe('bent facet buffers', () => {
  it('slices on the crease and arc boundaries with continuous normals and sheet UVs', () => {
    const f = initialPaper().facets[0];
    f.toSheet = [0, 1, -1, 0, 0.02, -0.01];
    const b = createBendBuffers(f, 0.001);
    const count = writeBentFacet(f, b, pose, 0.001);
    const cuts = new Set<number>();
    const point = { x: 0, y: 0, h: 0, nx: 0, ny: 0, nh: 0 };
    for (let i = 0; i < count; i++) {
      const sx = (b.uvs[i * 2] - 0.5) * 0.2;
      const sy = (b.uvs[i * 2 + 1] - 0.5) * 0.2;
      const x = sy + 0.01;
      const y = 0.02 - sx;
      bendPoint(x, y, b.height, pose, 0.001, point);
      expect(b.positions[i * 3]).toBeCloseTo(point.x, 6);
      expect(b.positions[i * 3 + 1]).toBeCloseTo(point.h, 6);
      expect(b.positions[i * 3 + 2]).toBeCloseTo(-point.y, 6);
      expect(b.normals[i * 3]).toBeCloseTo(point.nx, 5);
      expect(b.normals[i * 3 + 1]).toBeCloseTo(point.nh, 5);
      const s = pose.nx * x + pose.ny * y - pose.d;
      const cut = Math.round(s / (pose.radius * pose.theta / 8));
      if (Math.abs(s - cut * pose.radius * pose.theta / 8) < 1e-7) cuts.add(cut);
    }
    for (let k = 0; k <= 8; k++) expect(cuts.has(k)).toBe(true);
    expect(count).toBeLessThanOrEqual(b.positions.length / 3);
  });

  it('writes walls only on original edges, extruded along the local normal', () => {
    const f = initialPaper().facets[0];
    const b = createBendBuffers(f, 0);
    const wall = { positions: new Float32Array(4 * 60 * 3), aH: new Float32Array(4 * 60) };
    const count = writeBentWalls(b, pose, 0, 0.022, wall);
    let boundaryLength = 0;
    for (let i = 0; i < count; i += 6) {
      // UV-free inverse is unnecessary: compare base/top length and sum flat boundary segments separately.
      expect(Math.hypot(wall.positions[(i + 2) * 3] - wall.positions[(i + 1) * 3], wall.positions[(i + 2) * 3 + 1] - wall.positions[(i + 1) * 3 + 1], wall.positions[(i + 2) * 3 + 2] - wall.positions[(i + 1) * 3 + 2])).toBeCloseTo(0.022, 7);
      expect(Array.from(wall.aH.slice(i, i + 6))).toEqual([0, 0, 1, 0, 1, 1]);
    }
    const flat = { ...pose, theta: 0 };
    const flatCount = writeBentWalls(b, flat, 0, 0.022, wall);
    for (let i = 0; i < flatCount; i += 6) {
      const x = wall.positions[i * 3];
      const y = -wall.positions[i * 3 + 2];
      expect(Math.min(Math.abs(Math.abs(x) - 0.1), Math.abs(Math.abs(y) - 0.1))).toBeLessThan(1e-7);
      boundaryLength += Math.hypot(wall.positions[(i + 1) * 3] - x, wall.positions[(i + 1) * 3 + 2] + y);
    }
    expect(boundaryLength).toBeCloseTo(0.8, 6);
  });

  it('keeps non-moving facets flat and reuses buffers for expanded underlays', () => {
    const f = initialPaper().facets[0];
    const b = createBendBuffers(f, 0.002, 0.0011);
    const positions = b.positions;
    const count = writeBentFacet(f, b, pose, 0.004, false);
    expect(count).toBe(6);
    for (let i = 0; i < count; i++) {
      expect(b.positions[i * 3 + 1]).toBeCloseTo(0.002);
      expect(b.normals[i * 3 + 1]).toBe(1);
      const sheet = applyAffine(f.toSheet, { x: b.positions[i * 3], y: -b.positions[i * 3 + 2] });
      expect(b.uvs[i * 2]).toBeCloseTo(sheet.x / 0.2 + 0.5);
    }
    expect(b.positions[0]).toBeLessThan(-0.1);
    writeBentFacet(f, b, pose, 0.004);
    expect(b.positions).toBe(positions);
  });
});

it('covers convex facets exactly in sheet space within the preallocated capacity', () => {
  for (let n = 3; n <= 12; n++) {
    const f = initialPaper().facets[0];
    f.poly = Array.from({ length: n }, (_, i) => ({ x: Math.cos(i * Math.PI * 2 / n) * 0.1, y: Math.sin(i * Math.PI * 2 / n) * 0.1 }));
    const b = createBendBuffers(f, 0);
    const walls = { positions: new Float32Array(n * 60 * 3), aH: new Float32Array(n * 60) };
    for (const theta of [0, 0.1, 1.7, Math.PI]) {
      for (const radius of [0, 0.012]) {
        const bend = { ...pose, theta, radius };
        const count = writeBentFacet(f, b, bend, 0);
        let area = 0;
        for (let i = 0; i < count; i += 3) {
          const a = i * 2;
          area += ((b.uvs[a + 2] - b.uvs[a]) * (b.uvs[a + 5] - b.uvs[a + 1]) - (b.uvs[a + 3] - b.uvs[a + 1]) * (b.uvs[a + 4] - b.uvs[a])) * 0.02;
        }
        expect(area).toBeCloseTo(n * Math.sin(2 * Math.PI / n) * 0.005, 7);
        expect(count).toBeLessThanOrEqual(b.positions.length / 3);
        const wallCount = writeBentWalls(b, bend, 0, 0.022, walls);
        expect(wallCount).toBeLessThanOrEqual(walls.aH.length);
        expect(b.positions.every(Number.isFinite)).toBe(true);
        expect(walls.positions.every(Number.isFinite)).toBe(true);
      }
    }
  }
});
