import { describe, expect, it } from 'vitest';
import { bake } from './bake.js';
import { baked } from './baked.js';
import { runtimeData } from './data.js';
import { fish } from './fish.js';
import { FoldUp } from './fold-up.js';
import { area, validate, type Part, type Point } from './pattern.js';
import { cross, dot, measure, normal, subtract, type Position } from './relax.js';

const definition = fish(), c = definition.construction, data = bake(definition);
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

describe('fish paper', () => {
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

  it('centres a 11–14 cm fish with a deep diamond body, volume and mirrored sides', () => {
    expect(data.report.length).toBeGreaterThanOrEqual(.11);
    expect(data.report.length).toBeLessThanOrEqual(.14);
    expect(data.report.height).toBeGreaterThan(.08);
    expect(data.report.height).toBeLessThan(.12);
    expect(data.report.wingspan).toBeGreaterThan(.035);
    expect(data.report.wingspan).toBeLessThan(.06);
    expect(data.touchesGround).toBe(false);
    for (let k = 0; k < 3; k++) expect(Math.min(...data.positions.map(p => p[k])) + Math.max(...data.positions.map(p => p[k]))).toBeCloseTo(0, 10);
    for (const p of data.positions) expect(Math.min(...data.positions.map(q => Math.hypot(p[0] + q[0], p[1] - q[1], p[2] - q[2])))).toBeLessThan(.001);
    const top = data.positions.reduce((a, b) => a[1] > b[1] ? a : b);
    const bottom = data.positions.reduce((a, b) => a[1] < b[1] ? a : b);
    const side = data.positions.reduce((a, b) => a[0] > b[0] ? a : b);
    expect(Math.abs(dot(cross(subtract(top, bottom), subtract(side, bottom)), subtract(corner([.1, .1]), bottom))) / 6).toBeGreaterThan(1e-5);
  });

  it('has forward pointed lips, a vertical fork behind the body and two small side fins', () => {
    const lips = [corner([.1, .1]), corner([-.1, -.1])];
    for (const p of lips) {
      expect(p[2]).toBeCloseTo(-data.report.length / 2, 5);
      expect(Math.abs(p[1])).toBeLessThan(.001);
      expect(Math.abs(p[0])).toBeLessThan(.008);
    }
    const upper = corner([-.1, .1]), lower = corner([.1, -.1]);
    expect(upper[1]).toBeGreaterThan(.025);
    expect(lower[1]).toBeLessThan(-.025);
    for (const p of [upper, lower]) expect(p[2]).toBeGreaterThan(.05);
    const tail = ids('tail').map(v => data.positions[v]);
    expect(Math.min(...tail.map(p => p[2]))).toBeGreaterThan(.035);
    expect(triangles.some(t => inside([0, data.report.length / 2 - .002], t.map(v => [data.positions[v][1], data.positions[v][2]])))).toBe(false);
    for (const s of [-1, 1]) {
      const fin = ids(s < 0 ? 'wingL' : 'wingR').map(v => data.positions[v]);
      expect(Math.max(...fin.map(p => s * p[0]))).toBeGreaterThan(.018);
      expect(Math.max(...fin.map(p => p[2]))).toBeLessThan(.01);
      expect(Math.max(...fin.map(p => p[1])) - Math.min(...fin.map(p => p[1]))).toBeLessThan(data.report.height * .65);
    }
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
    expect(runtimeData(data)).toEqual(baked.fish);
    expect(runtimeData(bake(fish()))).toEqual(baked.fish);
    for (const positions of [data.positions, baked.fish.positions]) {
      const report = measure(c.graph, positions);
      expect(report.worstStrain).toBeLessThanOrEqual(.01);
      expect(report.rmsStrain).toBeLessThanOrEqual(.002);
      expect(report.planarity).toBeLessThanOrEqual(.0005);
    }
  }, 20000);

  it('clamps, opens, and replays continuously into the same output buffer', () => {
    const fold = new FoldUp(baked.fish), out = new Float32Array(data.positions.length * 3);
    for (const [t, target] of [[-1, baked.fish.sheetPositions], [0, baked.fish.sheetPositions], [(data.stages - 1) / data.stages, baked.fish.flatPositions], [1, baked.fish.positions], [2, baked.fish.positions], [0, baked.fish.sheetPositions]] as const) {
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
