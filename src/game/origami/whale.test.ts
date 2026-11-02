import { describe, expect, it } from 'vitest';
import { bake } from './bake.js';
import { baked } from './baked.js';
import { runtimeData } from './data.js';
import { whale } from './whale.js';
import { FoldUp } from './fold-up.js';
import { area, validate, type Part, type Point } from './pattern.js';
import { cross, dot, measure, normal, subtract, type Position } from './relax.js';

const definition = whale(), c = definition.construction, data = bake(definition);
const ids = (part: Part) => [...new Set(data.faces.flatMap(f => f.part === part ? f.vertices : []))];
const corner = (p: Point) => data.positions[c.graph.vertices.findIndex(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9)];
const triangles = data.faces.flatMap(f => f.triangles);
const inside = (p: Point, t: Point[]) => {
  const sides = t.map((a, i) => {
    const b = t[(i + 1) % 3];
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  });
  return Math.abs(area(t)) > 1e-12 && (sides.every(v => v >= -1e-12) || sides.every(v => v <= 1e-12));
};

describe('whale paper', () => {
  it('tiles the square, validates the crease pattern and closes every shared vertex', () => {
    expect(() => validate(c.graph)).not.toThrow();
    expect(data.report.closure).toBeLessThan(1e-9);
    const sheet = data.sheetPositions.map(p => [p[0], p[2]] as Point);
    const areas = triangles.map(t => area(t.map(v => sheet[v])));
    expect(areas.every(a => a > 0)).toBe(true);
    expect(areas.reduce((a, b) => a + b, 0)).toBeCloseTo(.04, 12);
    expect(data.report.area).toBeCloseTo(.04, 12);
    expect(new Set(c.parts)).toEqual(new Set(['body', 'head', 'tail', 'wingL', 'wingR']));
    expect(new Set(Object.values(data.rig))).toEqual(new Set(['body', 'tail']));
  });

  it('centres a 12–15 cm whale with an opened belly and mirrored sides', () => {
    expect(data.report.length).toBeGreaterThanOrEqual(.12);
    expect(data.report.length).toBeLessThanOrEqual(.15);
    expect(data.report.height).toBeGreaterThan(.05);
    expect(data.report.height).toBeLessThan(.10);
    expect(data.report.wingspan).toBeGreaterThan(.06);
    expect(data.report.wingspan).toBeLessThan(.10);
    expect(data.touchesGround).toBe(false);
    for (let k = 0; k < 3; k++) expect(Math.min(...data.positions.map(p => p[k])) + Math.max(...data.positions.map(p => p[k]))).toBeCloseTo(0, 10);
    for (const p of data.positions) expect(Math.min(...data.positions.map(q => Math.hypot(p[0] + q[0], p[1] - q[1], p[2] - q[2])))).toBeLessThan(.001);
    const head = ids('head').map(v => data.positions[v]);
    expect(Math.max(...head.map(p => p[0])) - Math.min(...head.map(p => p[0]))).toBeGreaterThan(.06);
    expect(Math.max(...head.map(p => p[1])) - Math.min(...head.map(p => p[1]))).toBeGreaterThan(.05);
    const nose = head.filter(p => p[2] < -data.report.length / 2 + .015);
    expect(Math.max(...nose.map(p => p[0])) - Math.min(...nose.map(p => p[0]))).toBeGreaterThan(.035);
    expect(Math.max(...nose.map(p => p[1])) - Math.min(...nose.map(p => p[1]))).toBeGreaterThan(.025);
  });

  it('tapers from a broad head to a raised forked fluke, with one flipper per side', () => {
    const fluke = c.positions.flatMap(([u, v], i) => Math.abs(u - .075) < 1e-8 && Math.abs(v) > .02 ? [data.positions[i]] : []);
    expect(fluke).toHaveLength(2);
    const notch = c.positions.flatMap(([u, v], i) => Math.abs(u - .075) < 1e-8 && Math.abs(v) < 1e-8 ? [data.positions[i]] : []);
    for (const p of fluke) {
      expect(Math.abs(p[0])).toBeGreaterThan(.015);
      expect(p[1]).toBeGreaterThan(.015);
      expect(p[2]).toBeGreaterThan(.065);
      expect(p[2] - Math.max(...notch.map(q => q[2]))).toBeGreaterThan(.005);
    }
    expect(triangles.some(t => inside([0, data.report.length / 2 - .002], t.map(v => [data.positions[v][0], data.positions[v][2]])))).toBe(false);
    const neck = c.positions.flatMap(([u, v], i) => Math.abs(u - .035) < 1e-8 && Math.abs(v) < 1e-8 ? [data.positions[i]] : []);
    expect(neck.length).toBeGreaterThan(0);
    expect(Math.max(...notch.map(p => p[1])) - Math.max(...neck.map(p => p[1]))).toBeGreaterThan(.01);
    for (const s of [-1, 1]) {
      const tip = corner(s < 0 ? [.1, -.1] : [-.1, .1]);
      expect(s * tip[0]).toBeGreaterThan(.04);
      expect(tip[2]).toBeGreaterThan(-.04);
      expect(tip[2]).toBeLessThan(0);
      expect(tip[1]).toBeLessThan(.02);
      const fin = ids(s < 0 ? 'wingL' : 'wingR').map(v => data.positions[v]);
      expect(Math.max(...fin.map(p => p[2])) - Math.min(...fin.map(p => p[2]))).toBeLessThan(.04);
    }
    const headWidth = Math.max(...ids('head').map(v => Math.abs(data.positions[v][0]))) * 2;
    expect(headWidth).toBeGreaterThan(Math.abs(fluke[0][0] - fluke[1][0]) * 2);
  });

  it('places mirrored ink dots on exposed left and right head surfaces', () => {
    expect(data.eyes).toHaveLength(2);
    const eyes = data.eyes.map(eye => [0, 1, 2].map(k => eye.vertices.reduce((s, v, i) => s + data.positions[v][k] * eye.weights[i], 0)) as Position);
    expect(Math.hypot(eyes[0][0] + eyes[1][0], eyes[0][1] - eyes[1][1], eyes[0][2] - eyes[1][2])).toBeLessThan(.001);
    data.eyes.forEach((eye, i) => {
      const p = eyes[i], direction = normal(eye.vertices, data.positions).map(n => n * eye.normalSign) as Position;
      expect((i ? 1 : -1) * p[0]).toBeGreaterThan(.002);
      expect(p[2]).toBeLessThan(-.03);
      expect((i ? 1 : -1) * direction[0]).toBeGreaterThan(.5);
      expect(eye.radius).toBeGreaterThan(.001);
      expect(eye.radius).toBeLessThan(.002);
      for (const t of triangles) {
        const [a, b, c] = t.map(v => data.positions[v]), ab = subtract(b, a), ac = subtract(c, a);
        const h = cross(direction, ac), det = dot(ab, h);
        if (Math.abs(det) < 1e-12) continue;
        const offset = subtract(p, a), u = dot(offset, h) / det, q = cross(offset, ab), v = dot(direction, q) / det;
        if (u > 1e-6 && v > 1e-6 && u + v < 1 - 1e-6) expect(dot(ac, q) / det).toBeLessThan(.0002);
      }
    });
  });

  it('bakes reproducibly and preserves the paper after runtime rounding', () => {
    expect(runtimeData(data)).toEqual(baked.whale);
    expect(runtimeData(bake(whale()))).toEqual(baked.whale);
    for (const positions of [data.positions, baked.whale.positions]) {
      const report = measure(c.graph, positions);
      expect(report.worstStrain).toBeLessThanOrEqual(.01);
      expect(report.rmsStrain).toBeLessThanOrEqual(.002);
      expect(report.planarity).toBeLessThanOrEqual(.0005);
    }
  }, 20000);

  it('clamps, opens, and replays continuously into the same output buffer', () => {
    const fold = new FoldUp(baked.whale), out = new Float32Array(data.positions.length * 3);
    for (const [t, target] of [[-1, baked.whale.sheetPositions], [0, baked.whale.sheetPositions], [(data.stages - 1) / data.stages, baked.whale.flatPositions], [1, baked.whale.positions], [2, baked.whale.positions], [0, baked.whale.sheetPositions]] as const) {
      fold.apply(t, out);
      target.forEach((p, i) => p.forEach((n, k) => expect(Math.abs(out[i * 3 + k] - n)).toBeLessThan(1e-8)));
    }
    for (let stage = 1; stage <= data.stages; stage++) {
      fold.apply(stage / data.stages - 1e-7, out);
      const before = out.slice();
      fold.apply(stage / data.stages + 1e-7, out);
      expect(Math.max(...out.map((v, i) => Math.abs(v - before[i])))).toBeLessThan(.00002);
    }
  });
});
