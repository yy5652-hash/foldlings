import { describe, expect, it } from 'vitest';
import { bake } from './bake.js';
import { baked } from './baked.js';
import { runtimeData } from './data.js';
import { flatFold, transform } from './flat.js';
import { FoldUp } from './fold-up.js';
import { fox } from './fox.js';
import { area, validate, type Part, type Point } from './pattern.js';
import { dot, measure, normal, subtract, type Position } from './relax.js';

const definition = fox(), c = definition.construction, data = bake(definition);
const ids = (part: Part) => [...new Set(data.faces.flatMap(f => f.part === part ? f.vertices : []))];
const points = (part: Part) => ids(part).map(v => data.positions[v]);
const span = (ps: Position[], k: number) => Math.max(...ps.map(p => p[k])) - Math.min(...ps.map(p => p[k]));
const top = (part: Part) => Math.max(...points(part).map(p => p[1]));
const distance = (a: Position, b: Position) => Math.hypot(...subtract(a, b));

describe('fox paper', () => {
  it('uses one complete 20 cm square, valid local folds and closed shared vertices', () => {
    expect(data.side).toBe(.2);
    expect(() => validate(c.graph)).not.toThrow();
    const flat = flatFold(c.graph);
    expect(flat.closure).toBeLessThanOrEqual(1e-9);
    c.graph.faces.forEach((face, i) => face.forEach(v => {
      const p = transform(flat.transforms[i], c.graph.vertices[v]);
      expect(Math.hypot(p[0] - flat.positions[v][0], p[1] - flat.positions[v][1])).toBeLessThanOrEqual(1e-9);
    }));
    const sheet = data.sheetPositions.map(p => [p[0], p[2]] as Point);
    const triangles = data.faces.flatMap(f => f.triangles).map(t => area(t.map(v => sheet[v])));
    expect(triangles.every(a => a > 0)).toBe(true);
    expect(triangles.reduce((a, b) => a + b, 0)).toBeCloseTo(.04, 12);
    expect(data.report.area).toBeCloseTo(.04, 12);
    expect(c.graph.edges.filter(e => e.assignment !== 'B').every(e => e.faces.length === 2)).toBe(true);
    expect(new Set(c.parts)).toEqual(new Set(['body', 'head', 'earL', 'earR', 'tail']));
    expect(data.rig).toEqual({ body: 'body', head: 'head', earL: 'earL', earR: 'earR', tail: 'tail' });
  });

  it('has an upright triangular body, separated pointed ears and a short forward muzzle', () => {
    expect(data.report.height).toBeGreaterThanOrEqual(.09);
    expect(data.report.height).toBeLessThanOrEqual(.11);
    expect(data.report.length).toBeGreaterThan(.10);
    expect(data.report.length).toBeLessThan(.12);
    expect(span(points('body'), 0)).toBeGreaterThan(.03);
    expect(span(points('body'), 0)).toBeLessThan(.05);
    expect(top('body')).toBeGreaterThan(.06);
    const upper = points('body').filter(p => p[1] > .055);
    expect(span(upper, 0)).toBeLessThan(span(points('body'), 0) * .8);
    for (const s of [-1, 1]) {
      const ear = points(s < 0 ? 'earL' : 'earR').reduce((a, b) => a[1] > b[1] ? a : b);
      expect(s * ear[0]).toBeGreaterThan(.009);
      expect(ear[1] - top('head')).toBeGreaterThan(.018);
      expect(ear[1] - top('body')).toBeGreaterThan(.025);
    }
    const nose = points('head').reduce((a, b) => a[2] < b[2] ? a : b);
    const projection = Math.min(...points('body').map(p => p[2])) - nose[2];
    expect(projection).toBeGreaterThan(.01);
    expect(projection).toBeLessThan(.025);
    expect(nose[1]).toBeLessThan(top('head') - .01);
    expect(span(points('head'), 0)).toBeGreaterThan(.007);
  });

  it('is mirrored within 1 mm apart from the deliberately swept tail, and sits on the ground', () => {
    const symmetric = [...new Set(['body', 'head', 'earL', 'earR'].flatMap(part => ids(part as Part)))];
    for (const v of symmetric) {
      const p = data.positions[v], reflected: Position = [-p[0], p[1], p[2]];
      expect(Math.min(...symmetric.map(i => distance(reflected, data.positions[i])))).toBeLessThanOrEqual(.001);
    }
    expect(data.touchesGround).toBe(true);
    expect(Math.min(...data.positions.map(p => p[1]))).toBe(0);
    expect(Math.min(...points('body').map(p => p[1]))).toBeLessThan(.001);
    expect(Math.max(...points('tail').map(p => p[2])) - Math.max(...points('body').map(p => p[2]))).toBeGreaterThan(.015);
    expect(top('tail')).toBeLessThan(.02);
    const bends = c.graph.edges.filter(e => e.assignment === 'F' && e.faces.length === 2 && e.faces.every(i => c.parts[i] === 'tail'));
    expect(bends.some(e => Math.abs(dot(normal(c.graph.faces[e.faces[0]], data.positions), normal(c.graph.faces[e.faces[1]], data.positions))) < Math.cos(.2))).toBe(true);
  });

  it('places two mirrored ink dots on outward-facing head surfaces', () => {
    expect(data.eyes).toHaveLength(2);
    const eyes = data.eyes.map((eye, i) => {
      expect(eye.part).toBe('head');
      expect(eye.vertices.every(v => ids('head').includes(v))).toBe(true);
      expect(eye.weights.every(w => w > 0)).toBe(true);
      expect(eye.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      expect(dot(normal(eye.vertices, data.positions), [i ? eye.normalSign : -eye.normalSign, 0, 0])).toBeGreaterThan(.8);
      return [0, 1, 2].map(k => eye.vertices.reduce((sum, v, j) => sum + data.positions[v][k] * eye.weights[j], 0)) as Position;
    });
    expect(eyes[0][0]).toBeLessThan(0);
    expect(eyes[1][0]).toBeGreaterThan(0);
    expect(distance([-eyes[0][0], eyes[0][1], eyes[0][2]], eyes[1])).toBeLessThan(.001);
  });

  it('reproduces the bake and preserves edges, diagonals and planarity after quantization', () => {
    expect(runtimeData(bake(fox()))).toEqual(baked.fox);
    expect(runtimeData(data)).toEqual(baked.fox);
    for (const positions of [data.positions, baked.fox.positions, data.flatPositions]) {
      const report = measure(c.graph, positions);
      expect(report.worstStrain).toBeLessThanOrEqual(.01);
      expect(report.rmsStrain).toBeLessThanOrEqual(.002);
      expect(report.planarity).toBeLessThanOrEqual(.0005);
    }
  });

  it('replays and clamps sheet, flat and opened poses continuously in the same buffer', () => {
    const fold = new FoldUp(baked.fox), out = new Float32Array(data.positions.length * 3), next = new Float32Array(out.length);
    for (const [t, target] of [[0, baked.fox.sheetPositions], [(data.stages - 1) / data.stages, baked.fox.flatPositions], [1, baked.fox.positions], [-1, baked.fox.sheetPositions], [2, baked.fox.positions], [0, baked.fox.sheetPositions]] as const) {
      fold.apply(t, out);
      target.forEach((p, i) => p.forEach((n, k) => expect(Math.abs(out[i * 3 + k] - n)).toBeLessThan(1e-8)));
    }
    for (let stage = 0; stage <= data.stages; stage++) {
      fold.apply(stage / data.stages - 1e-7, out);
      fold.apply(stage / data.stages + 1e-7, next);
      expect(out.every(Number.isFinite)).toBe(true);
      expect(Math.max(...out.map((n, i) => Math.abs(n - next[i])))).toBeLessThan(1e-6);
    }
  });
});
