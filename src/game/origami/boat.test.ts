import { describe, expect, it } from 'vitest';
import { bake } from './bake.js';
import { baked } from './baked.js';
import { boat } from './boat.js';
import { runtimeData } from './data.js';
import { flatFold, transform } from './flat.js';
import { FoldUp } from './fold-up.js';
import { area, validate, type Point } from './pattern.js';
import { measure } from './relax.js';

const definition = boat(), c = definition.construction, data = bake(definition);
const vertex = (x: number, y: number) => data.positions[c.graph.vertices.findIndex(p => Math.hypot(p[0] - x, p[1] - y) < 1e-9)];
const heights = (x: number, z: number) => data.faces.flatMap(f => f.triangles).flatMap(t => {
  const [a, b, c] = t.map(v => data.positions[v]);
  const det = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
  if (Math.abs(det) < 1e-12) return [];
  const u = ((x - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (z - a[2])) / det;
  const v = ((b[0] - a[0]) * (z - a[2]) - (x - a[0]) * (b[2] - a[2])) / det;
  return u >= 0 && v >= 0 && u + v <= 1 ? [a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1])] : [];
});

describe('traditional hat-and-diamond boat', () => {
  it('keeps all the tucked square, valid triangles and exact flat closure', () => {
    expect(() => validate(c.graph)).not.toThrow();
    const sheet = data.sheetPositions.map(p => [p[0], p[2]] as Point);
    const areas = data.faces.flatMap(f => f.triangles).map(t => area(t.map(v => sheet[v])));
    expect(areas.every(a => a > 0)).toBe(true);
    expect(areas.reduce((a, b) => a + b, 0)).toBeCloseTo(.04, 12);
    expect(data.report.area).toBeCloseTo(.04, 12);
    const flat = flatFold(c.graph);
    expect(flat.closure).toBeLessThan(1e-9);
    c.graph.faces.forEach((f, i) => f.forEach(v => {
      const p = transform(flat.transforms[i], c.graph.vertices[v]), q = flat.positions[v];
      expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(1e-9);
    }));
  });

  it('raises the pointed ends above a short, level centre keel', () => {
    expect(data.report.length).toBeGreaterThanOrEqual(.13);
    expect(data.report.length).toBeLessThanOrEqual(.16);
    const bow = vertex(-.1, 0), stern = vertex(.05, 0), peak = vertex(-.025, .05);
    expect(bow[2]).toBeCloseTo(Math.min(...data.positions.map(p => p[2])), 8);
    expect(stern[2]).toBeCloseTo(Math.max(...data.positions.map(p => p[2])), 8);
    for (const p of [bow, stern]) {
      expect(Math.abs(p[0])).toBeLessThan(.001);
      expect(p[1]).toBeGreaterThanOrEqual(.6 * peak[1]);
      expect(p[1]).toBeLessThan(peak[1]);
    }
    const keel = data.positions.filter(p => p[1] < 1e-9);
    expect(keel.some(p => Math.hypot(p[0], p[2]) < .001)).toBe(true);
    const length = Math.max(...keel.map(p => p[2])) - Math.min(...keel.map(p => p[2]));
    expect(length).toBeGreaterThanOrEqual(.015);
    expect(length).toBeLessThanOrEqual(.03);
    for (const p of data.positions) expect(Math.min(...data.positions.map(q => Math.hypot(p[0] + q[0], p[1] - q[1], p[2] - q[2])))).toBeLessThan(.001);
    expect(Math.min(...data.positions.map(p => p[1]))).toBe(0);
    expect(data.touchesGround).toBe(true);
  });

  it('has a dipped gunwale, open pockets and a highest central crest', () => {
    const peak = vertex(-.025, .05), rims = [-1, 1].map(s => vertex(-.025, s * .1));
    expect(Math.abs(peak[0])).toBeLessThan(.001);
    expect(Math.abs(peak[2])).toBeLessThan(.001);
    expect(peak[1]).toBeCloseTo(data.report.height, 8);
    expect(rims[1][0] - rims[0][0]).toBeGreaterThanOrEqual(.03);
    for (const [i, side] of [-1, 1].entries()) {
      const rim = rims[i];
      expect(rim[1]).toBeLessThan(vertex(-.1, 0)[1]);
      expect(rim[1]).toBeLessThan(peak[1]);
      const pocket = heights(side * .012, 0);
      expect(pocket.length).toBeGreaterThan(0);
      expect(Math.max(...pocket)).toBeLessThan(rim[1] - .002);
      expect(Math.min(...pocket)).toBeGreaterThanOrEqual(0);
    }
    expect(new Set(data.faces.map(f => f.part))).toEqual(new Set(['body', 'tail']));
    expect(data.rig).toEqual({ body: 'body', tail: 'tail' });
    expect(data.pivots.tail?.every(Number.isFinite)).toBe(true);
    const sail = data.faces.filter(f => f.part === 'tail').flatMap(f => f.vertices).map(v => data.positions[v]);
    expect(Math.max(...sail.map(p => p[1]))).toBeCloseTo(peak[1], 8);
    expect(Math.max(...sail.map(p => Math.abs(p[2])))).toBeLessThan(.035);
    expect(data.eyes).toHaveLength(0);
  });

  it('bakes deterministically and meets paper tolerances after runtime rounding', () => {
    expect(runtimeData(data)).toEqual(baked.boat);
    expect(bake(boat())).toEqual(data);
    for (const positions of [data.positions, baked.boat.positions]) {
      const report = measure(c.graph, positions);
      expect(report.worstStrain).toBeLessThanOrEqual(.01);
      expect(report.rmsStrain).toBeLessThanOrEqual(.002);
      expect(report.planarity).toBeLessThanOrEqual(.0005);
    }
  }, 240000);

  it('replays the sheet, closed boat and opening continuously with clamping', () => {
    const fold = new FoldUp(baked.boat), out = new Float32Array(data.positions.length * 3), next = new Float32Array(out.length);
    for (const [t, target] of [[-1, baked.boat.sheetPositions], [0, baked.boat.sheetPositions], [(data.stages - 1) / data.stages, baked.boat.flatPositions], [1, baked.boat.positions], [2, baked.boat.positions], [0, baked.boat.sheetPositions]] as const) {
      fold.apply(t, out);
      target.forEach((p, i) => p.forEach((n, k) => expect(Math.abs(out[i * 3 + k] - n)).toBeLessThan(1e-8)));
    }
    for (let stage = 1; stage < data.stages; stage++) {
      fold.apply(stage / data.stages - 1e-7, out);
      fold.apply(stage / data.stages + 1e-7, next);
      expect(Math.max(...out.map((n, i) => Math.abs(n - next[i])))).toBeLessThan(1e-6);
    }
  });
});
