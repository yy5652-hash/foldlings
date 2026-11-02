import { describe, expect, it } from 'vitest';
import { bake } from './bake.js';
import { baked } from './baked.js';
import { runtimeData } from './data.js';
import { frog } from './frog.js';
import { FoldUp } from './fold-up.js';
import { area, validate, type Part, type Point } from './pattern.js';
import { dot, measure, normal, subtract, type Position } from './relax.js';

const definition = frog(), c = definition.construction, data = bake(definition);
const ids = (part: Part) => [...new Set(data.faces.flatMap(f => f.part === part ? f.vertices : []))];
const corner = (p: Point) => data.positions[c.graph.vertices.findIndex(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9)];
const distance = (a: Position, b: Position) => Math.hypot(...subtract(a, b));

describe('frog paper', () => {
  it('uses the full square once and closes all shared vertices', () => {
    expect(() => validate(c.graph)).not.toThrow();
    expect(data.report.closure).toBeLessThan(1e-9);
    const sheet = data.sheetPositions.map(p => [p[0], p[2]] as Point);
    const triangles = data.faces.flatMap(f => f.triangles).map(t => area(t.map(v => sheet[v])));
    expect(triangles.every(a => a > 0)).toBe(true);
    expect(triangles.reduce((a, b) => a + b, 0)).toBeCloseTo(.04, 12);
    expect(data.report.area).toBeCloseTo(.04, 12);
    expect(new Set(data.faces.map(f => f.part))).toEqual(new Set(['body', 'head', 'legL', 'legR']));
    expect(data.rig).toEqual({ body: 'body', head: 'head', legL: 'legL', legR: 'legR' });
  });

  it('keeps the 8–10 cm natural length, raised back, symmetry and ground contact', () => {
    expect(data.report.length).toBeGreaterThanOrEqual(.08);
    expect(data.report.length).toBeLessThanOrEqual(.10);
    expect(data.report.height).toBeGreaterThan(.01);
    expect(data.touchesGround).toBe(true);
    expect(Math.min(...data.positions.map(p => p[1]))).toBe(0);
    const triangles = data.faces.flatMap(f => f.triangles).map(t => t.map(v => data.positions[v]));
    for (const p of data.positions) {
      expect(p[1]).toBeCloseTo(data.report.height - Math.abs(p[0]) * Math.tan(Math.PI / 10), 10);
      expect(triangles.some(t => {
        const sides = t.map((a, i) => {
          const b = t[(i + 1) % 3];
          return (b[0] - a[0]) * (p[2] - a[2]) - (b[2] - a[2]) * (-p[0] - a[0]);
        });
        return sides.every(v => v >= -1e-12) || sides.every(v => v <= 1e-12);
      })).toBe(true);
    }
    for (const part of ['legL', 'legR'] as const) expect(Math.min(...ids(part).map(v => data.positions[v][1]))).toBeLessThan(1e-9);
  });

  it('has a pointed head facing -Z and eyes on its upper faces', () => {
    const head = ids('head').map(v => data.positions[v]);
    expect(Math.min(...head.map(p => p[2]))).toBeCloseTo(0, 10);
    expect(Math.max(...head.map(p => p[2]))).toBeCloseTo(.025, 10);
    for (const p of head) expect(Math.abs(p[0])).toBeLessThanOrEqual(p[2] + 1e-9);
    expect(Math.max(...head.map(p => p[0])) - Math.min(...head.map(p => p[0]))).toBeGreaterThan(.04);
    expect(data.eyes).toHaveLength(2);
    const eyeX = data.eyes.map(eye => eye.vertices.reduce((s, v, i) => s + data.positions[v][0] * eye.weights[i], 0));
    expect(eyeX[0]).toBeLessThan(0);
    expect(eyeX[1]).toBeGreaterThan(0);
    for (const eye of data.eyes) expect(dot(normal(eye.vertices, data.positions), [0, eye.normalSign, 0])).toBeGreaterThan(.9);
  });

  it('has short forward front legs and longer hind legs with two direction reversals', () => {
    for (const s of [-1, 1]) {
      const part = s < 0 ? 'legL' : 'legR';
      const front = corner(s < 0 ? [.1, -.1] : [-.1, .1]);
      const toe = corner(s < 0 ? [-.1, -.1] : [.1, .1]);
      const back = ids(part).map(v => data.positions[v]).filter(p => p[2] > .025);
      const knee = back.reduce((a, b) => a[2] > b[2] ? a : b);
      const ankle = back.reduce((a, b) => Math.abs(a[0]) > Math.abs(b[0]) ? a : b);
      const hip = back.reduce((a, b) => Math.abs(a[0]) < Math.abs(b[0]) ? a : b);
      expect(front[2]).toBeLessThan(0);
      expect(s * front[0]).toBeGreaterThan(.01);
      expect(knee[2] - hip[2]).toBeGreaterThan(.01);
      expect(ankle[2] - knee[2]).toBeLessThan(-.02);
      expect(toe[2] - ankle[2]).toBeGreaterThan(.002);
      expect(s * ankle[0]).toBeGreaterThan(.04);
      const hindLength = distance(hip, knee) + distance(knee, ankle) + distance(ankle, toe);
      const frontLength = Math.max(...ids(part).map(v => data.positions[v]).filter(p => p[2] < .025).map(p => distance(p, [0, data.report.height, .025])));
      expect(hindLength).toBeGreaterThan(frontLength * 1.5);
    }
  });

  it('reproduces the baked data and preserves paper after runtime quantization', () => {
    expect(runtimeData(data)).toEqual(baked.frog);
    for (const positions of [data.positions, baked.frog.positions]) {
      const report = measure(c.graph, positions);
      expect(report.worstStrain).toBeLessThanOrEqual(.01);
      expect(report.rmsStrain).toBeLessThanOrEqual(.002);
      expect(report.planarity).toBeLessThanOrEqual(.0005);
    }
  });

  it('replays sheet, flat-folded and opened poses without replacing its output', () => {
    const fold = new FoldUp(baked.frog), out = new Float32Array(data.positions.length * 3);
    for (const [t, target] of [[0, baked.frog.sheetPositions], [(data.stages - 1) / data.stages, baked.frog.flatPositions], [1, baked.frog.positions], [0, baked.frog.sheetPositions]] as const) {
      fold.apply(t, out);
      target.forEach((p, i) => p.forEach((n, k) => expect(Math.abs(out[i * 3 + k] - n)).toBeLessThan(1e-8)));
    }
  });
});
