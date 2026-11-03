import { describe, expect, it } from 'vitest';
import { bake } from './bake.js';
import { baked } from './baked.js';
import { runtimeData } from './data.js';
import { flatFold, transform } from './flat.js';
import { frog } from './frog.js';
import { FoldUp } from './fold-up.js';
import { area, validate, type Part, type Point } from './pattern.js';
import { dot, measure, normal, subtract, type Position } from './relax.js';

// Shape checks read the pose as designed; the bake itself lies where its weight puts it.
const definition = frog(), c = definition.construction, data = bake(definition, { rest: false });
const ids = (part: Part) => [...new Set(data.faces.flatMap(f => f.part === part ? f.vertices : []))];
const points = (part: Part) => ids(part).map(v => data.positions[v]);
const corner = (p: Point) => data.positions[c.graph.vertices.findIndex(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9)];
const distance = (a: Position, b: Position) => Math.hypot(...subtract(a, b));
const onSurface = (p: Position) => data.faces.flatMap(f => f.triangles).some(t => {
  const [a, b, c] = t.map(v => data.positions[v]);
  const u = subtract(b, a), v = subtract(c, a), q = subtract(p, a);
  const uu = dot(u, u), vv = dot(v, v), uv = dot(u, v), det = uu * vv - uv * uv;
  const x = (dot(q, u) * vv - dot(q, v) * uv) / det;
  const y = (dot(q, v) * uu - dot(q, u) * uv) / det;
  return x >= -1e-7 && y >= -1e-7 && x + y <= 1 + 1e-7 && Math.abs(dot(q, normal(t, data.positions))) < .001;
});

describe('rectangle-base jumping frog', () => {
  it('uses the full square once with valid creases, triangulation and flat closure', () => {
    expect(() => validate(c.graph)).not.toThrow();
    const sheet = data.sheetPositions.map(p => [p[0], p[2]] as Point);
    const triangles = data.faces.flatMap(f => f.triangles).map(t => area(t.map(v => sheet[v])));
    expect(triangles.every(a => a > 0)).toBe(true);
    expect(triangles.reduce((a, b) => a + b, 0)).toBeCloseTo(.04, 12);
    expect(data.report.area).toBeCloseTo(.04, 12);
    expect(data.faces.length).toBeLessThan(120);
    const flat = flatFold(c.graph);
    expect(flat.closure).toBeLessThan(1e-9);
    c.graph.faces.forEach((f, i) => f.forEach(v => {
      const p = transform(flat.transforms[i], c.graph.vertices[v]), q = flat.positions[v];
      expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(1e-9);
    }));
    expect(new Set(data.faces.map(f => f.part))).toEqual(new Set(['body', 'head', 'legL', 'legR']));
    expect(data.rig).toEqual({ body: 'body', head: 'head', legL: 'legL', legR: 'legR' });
  });

  it('raises its rectangular back above 2.5 cm with the front higher than the rear', () => {
    expect(data.report.length).toBeGreaterThanOrEqual(.08);
    expect(data.report.length).toBeLessThanOrEqual(.11);
    const body = points('body');
    expect(Math.min(...body.map(p => p[1]))).toBeGreaterThanOrEqual(.025);
    const front = body.reduce((a, b) => a[2] < b[2] ? a : b), rear = body.reduce((a, b) => a[2] > b[2] ? a : b);
    expect(front[1]).toBeGreaterThan(rear[1]);
    expect(Math.max(...body.map(p => p[0])) - Math.min(...body.map(p => p[0]))).toBeCloseTo(.05, 9);
    for (const p of data.positions) expect(onSurface([-p[0], p[1], p[2]])).toBe(true);
    expect(Math.min(...data.positions.map(p => p[1]))).toBe(0);
    expect(data.touchesGround).toBe(true);
  });

  it('points the head forward and puts symmetric ink eyes on its upper surface', () => {
    const head = points('head'), nose = corner([.05, -.05]);
    expect(Math.min(...head.map(p => p[2]))).toBeCloseTo(nose[2], 9);
    expect(nose[2]).toBeLessThan(Math.min(...points('body').map(p => p[2])));
    expect(Math.abs(nose[0])).toBeLessThan(.001);
    expect(nose[1]).toBeGreaterThan(Math.max(...points('body').map(p => p[1])));
    expect(data.eyes).toHaveLength(2);
    const eyes = data.eyes.map(eye => [0, 1, 2].map(k => eye.vertices.reduce((s, v, i) => s + data.positions[v][k] * eye.weights[i], 0)) as Position);
    expect(eyes[0][0]).toBeLessThan(0);
    expect(eyes[1][0]).toBeGreaterThan(0);
    expect(distance([-eyes[0][0], eyes[0][1], eyes[0][2]], eyes[1])).toBeLessThan(.001);
    for (const [i, eye] of data.eyes.entries()) {
      expect(eye.part).toBe('head');
      expect(eyes[i][1]).toBeGreaterThan(.025);
      expect(dot(normal(eye.vertices, data.positions), [0, eye.normalSign, 0])).toBeGreaterThan(.9);
      expect(eye.radius).toBeLessThan(.002);
    }
  });

  it('places short front legs behind the nose and wider, longer back legs at the rear', () => {
    const nose = corner([.05, -.05]), front = [corner([.1, -.1]), corner([0, -.1])];
    const back = [corner([.1, .1]), corner([0, .1])];
    expect(nose[2]).toBeCloseTo(Math.min(...data.positions.map(p => p[2])), 9);
    for (const [i, side] of [-1, 1].entries()) {
      expect(front[i][2]).toBeGreaterThan(nose[2]);
      expect(front[i][2] - nose[2]).toBeLessThan(data.report.length / 2);
      expect(back[i][2]).toBeCloseTo(Math.max(...data.positions.map(p => p[2])), 9);
      expect(side * back[i][0]).toBeGreaterThan(side * front[i][0]);
      expect(back[i][1]).toBeCloseTo(0, 9);
      expect(distance(back[i], [0, points('body')[0][1], 0])).toBeGreaterThan(distance(front[i], [0, front[i][1], front[i][2]]));
    }
    for (const pair of [front, back]) expect(distance([-pair[0][0], pair[0][1], pair[0][2]], pair[1])).toBeLessThan(.001);
  });

  it('reproduces the bake and preserves paper after runtime quantization', () => {
    const settled = bake(definition);
    expect(runtimeData(settled)).toEqual(baked.frog);
    expect(bake(frog())).toEqual(settled);
    for (const positions of [data.positions, baked.frog.positions]) {
      const report = measure(c.graph, positions);
      expect(report.worstStrain).toBeLessThanOrEqual(.01);
      expect(report.rmsStrain).toBeLessThanOrEqual(.002);
      expect(report.planarity).toBeLessThanOrEqual(.0005);
    }
  }, 240000);

  it('clamps and replays sheet, flat and opened states with continuous stage boundaries', () => {
    const fold = new FoldUp(baked.frog), out = new Float32Array(data.positions.length * 3), next = new Float32Array(out.length);
    for (const [t, target] of [[-1, baked.frog.sheetPositions], [0, baked.frog.sheetPositions], [(data.stages - 1) / data.stages, baked.frog.flatPositions], [1, baked.frog.positions], [2, baked.frog.positions], [0, baked.frog.sheetPositions]] as const) {
      fold.apply(t, out);
      target.forEach((p, i) => p.forEach((n, k) => expect(Math.abs(out[i * 3 + k] - n)).toBeLessThan(1e-8)));
    }
    const exact = new FoldUp(data);
    for (let stage = 1; stage < data.stages; stage++) {
      exact.apply(stage / data.stages - 1e-7, out);
      exact.apply(stage / data.stages + 1e-7, next);
      expect(Math.max(...out.map((n, i) => Math.abs(n - next[i])))).toBeLessThan(1e-6);
      // Micrometre rounding accumulates along the face tree before the flat-pose snap.
      fold.apply(stage / data.stages - 1e-7, out);
      fold.apply(stage / data.stages + 1e-7, next);
      expect(Math.max(...out.map((n, i) => Math.abs(n - next[i])))).toBeLessThan(.00005);
    }
  });
});
