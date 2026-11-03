import { describe, expect, it } from 'vitest';
import { area, graph, validate, type CreasePattern } from './pattern.js';
import { birdBase } from './bird-base.js';
import { crane as defineCrane } from './crane.js';
import { flatFold, transform } from './flat.js';
import { bake } from './bake.js';
import { minimumCraneSpan } from './crane-metrics.js';
import { Construction } from './construction.js';
import { runtimeData } from './data.js';
import { baked } from './baked.js';
import { FoldUp } from './fold-up.js';
import { measure, relax, type Position } from './relax.js';
import { triangulate } from './triangulate.js';

const definition = defineCrane();
const crane = definition.construction;
const data = bake(definition);

describe('origami sheet topology', () => {
  it('folds a full bird-base rhombus with 20 cm and 8.284271 cm diagonals', () => {
    const base = new Construction(birdBase(), () => 'body').finish();
    const span = (axis: number) => Math.max(...base.positions.map(p => p[axis])) - Math.min(...base.positions.map(p => p[axis]));
    expect(Math.abs(span(0) - .2)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(span(1) - .2 * (Math.SQRT2 - 1))).toBeLessThanOrEqual(1e-9);
    const tip = (x: number, y: number) => base.positions[base.graph.vertices.findIndex(p => Math.hypot(p[0] - x, p[1] - y) < 1e-9)];
    expect(Math.hypot(tip(-.1, .1)[0] - tip(.1, -.1)[0], tip(-.1, .1)[1] - tip(.1, -.1)[1])).toBeLessThanOrEqual(1e-9);
    expect(Math.hypot(tip(.1, .1)[0] - tip(-.1, -.1)[0], tip(.1, .1)[1] - tip(-.1, -.1)[1])).toBeLessThanOrEqual(1e-9);
  });

  it('keeps preparatory creases flat until the model is opened', () => {
    const pattern: CreasePattern = { side: .2, creases: [
      { a: [0, -.1], b: [0, .1], assignment: 'F', stage: 1 },
    ] };
    const g = graph(pattern), flat = flatFold(g);
    expect(() => validate(g)).not.toThrow();
    expect(flat.positions).toEqual(g.vertices);
    expect(flat.front.every(Boolean)).toBe(true);
  });

  it('satisfies Kawasaki and Maekawa at every interior crane vertex', () => {
    expect(() => validate(graph(birdBase()))).not.toThrow();
    expect(() => validate(crane.graph)).not.toThrow();
    expect(crane.graph.edges.filter(e => e.assignment !== 'B').every(e => e.faces.length === 2)).toBe(true);
    expect(crane.pattern.creases.every(c => c.stage >= 1 && c.stage <= data.stages)).toBe(true);
  });

  it('splits crossings and collinear overlaps without duplicate edges', () => {
    const pattern: CreasePattern = { side: .2, creases: [
      { a: [-.1, 0], b: [.1, 0], assignment: 'M', stage: 1 },
      { a: [-.05, 0], b: [.05, 0], assignment: 'M', stage: 1 },
      { a: [0, -.1], b: [0, .1], assignment: 'V', stage: 2 },
    ] };
    const g = graph(pattern);
    expect(g.faces).toHaveLength(4);
    expect(new Set(g.edges.map(e => [e.a, e.b].sort((a, b) => a - b).join(','))).size).toBe(g.edges.length);
    expect(g.faces.reduce((s, f) => s + area(f.map(v => g.vertices[v])), 0)).toBeCloseTo(.04, 14);
  });

  it('reports the vertex when an assignment or sector angle is invalid', () => {
    const pattern: CreasePattern = { side: .2, creases: [
      { a: [0, 0], b: [.1, 0], assignment: 'M', stage: 1 },
      { a: [0, 0], b: [0, .1], assignment: 'M', stage: 1 },
      { a: [0, 0], b: [-.1, 0], assignment: 'V', stage: 1 },
      { a: [0, 0], b: [0, -.1], assignment: 'V', stage: 1 },
    ] };
    expect(() => validate(graph(pattern))).toThrow(/Maekawa at \(0, 0\)/);
    pattern.creases[3].assignment = 'M';
    expect(() => validate(graph(pattern))).not.toThrow();
    pattern.creases[3].b = [.03, -.1];
    expect(() => validate(graph(pattern))).toThrow(/Kawasaki at \(0, 0\)/);
    expect(() => flatFold(graph(pattern))).toThrow(/Flat closure/);
  });
});

describe('crane geometry', () => {
  it('exposes the incompatible 17 cm span bound without scaling the paper', () => {
    expect(minimumCraneSpan(.03, 15, .01, .003)).toBeGreaterThan(.1815);
  });

  it('reports the corrected wing alignment and root heights', () => {
    expect(data.report.silhouette.mirrorError).toBeLessThanOrEqual(.001);
    expect(data.report.silhouette.wingTipAlignment).toBeLessThanOrEqual(.003);
    expect(data.report.silhouette.neckTailRootHeightDifference).toBeLessThanOrEqual(.002);
    expect(data.report.silhouette.bodyWidth).toBeGreaterThanOrEqual(.03);
    expect(data.report.silhouette.bodyWidth).toBeLessThanOrEqual(.06);
    const head = data.faces.filter(f => f.part === 'head').flatMap(f => f.vertices);
    const tail = data.faces.filter(f => f.part === 'tail').flatMap(f => f.vertices);
    expect(Math.min(...head.map(v => data.positions[v][2]))).toBeLessThan(Math.min(...tail.map(v => data.positions[v][2])));
  });

  it('closes every face cycle, including every copy of every shared vertex', () => {
    const flat = flatFold(crane.graph);
    expect(flat.closure).toBeLessThanOrEqual(1e-9);
    crane.graph.faces.forEach((face, i) => face.forEach(v => {
      const p = transform(flat.transforms[i], crane.graph.vertices[v]), q = flat.positions[v];
      expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThanOrEqual(1e-9);
    }));
    expect(flat.front.filter(Boolean).length).toBeGreaterThan(0);
    expect(flat.front.filter(v => !v).length).toBeGreaterThan(0);
  });

  it('uses the complete 400 cm² sheet once, with valid polygon triangulation', () => {
    const sheet = data.sheetPositions.map(p => [p[0], p[2]] as [number, number]);
    const total = data.faces.reduce((s, f) => s + area(f.vertices.map(v => sheet[v])), 0);
    const triangles = data.faces.reduce((s, f) => s + f.triangles.reduce((a, t) => a + area(t.map(v => sheet[v])), 0), 0);
    expect(total * 10000).toBeCloseTo(400, 10);
    expect(triangles).toBeCloseTo(total, 14);
    expect(data.report.area).toBeCloseTo(total, 14);
    for (const uv of data.uvs) for (const n of uv) expect(n).toBeGreaterThanOrEqual(-1e-9);
    for (const uv of data.uvs) for (const n of uv) expect(n).toBeLessThanOrEqual(1 + 1e-9);
    expect(data.faces.every(f => f.triangles.every(t => area(t.map(v => sheet[v])) > 0))).toBe(true);
  });

  it('preserves all edges and face diagonals, and keeps polygons planar', () => {
    const measured = measure(crane.graph, data.positions);
    for (const report of [data.report, measured]) {
      expect(report.worstStrain).toBeLessThanOrEqual(.01);
      expect(report.rmsStrain).toBeLessThanOrEqual(.002);
      expect(report.planarity).toBeLessThanOrEqual(.0005);
    }
    expect(Math.min(...data.positions.map(p => p[1]))).toBe(0);
    expect(data.report.wingspan).toBeGreaterThanOrEqual(.17);
    expect(data.report.wingspan).toBeLessThanOrEqual(.19);
    expect(new Set(data.faces.map(f => f.part))).toEqual(new Set(['body', 'wingL', 'wingR', 'neck', 'tail', 'head']));
  });

  it('reproduces the checked-in crane data without IO', () => {
    expect(runtimeData(data)).toEqual(baked.crane);
  }, 240000);

  it('keeps micrometre-quantized runtime paper within the strain budget', () => {
    const report = measure(crane.graph, baked.crane.positions);
    expect(report.worstStrain).toBeLessThanOrEqual(.01);
    expect(report.rmsStrain).toBeLessThanOrEqual(.002);
    expect(report.planarity).toBeLessThanOrEqual(.0005);
    expect(JSON.stringify(baked).length).toBeLessThan(350000);
  });

  it('projects a perturbed rigid-face opening back onto its length constraints', () => {
    const g = graph({ side: .2, creases: [{ a: [0, -.1], b: [0, .1], assignment: 'M', stage: 1 }] });
    const flat = flatFold(g);
    const result = relax(flat, [{ faces: [1], axis: [[.001, -.1, 0], [.001, .1, 0]], angle: .8 }]);
    expect(result.report.iterations).toBeGreaterThan(0);
    expect(result.report.worstStrain).toBeLessThan(.01);
    expect(result.report.planarity).toBeLessThan(.0005);
  });

  it('triangulates a concave face without adding area outside the paper', () => {
    const points: [number, number][] = [[0, 0], [1, 0], [1, 1], [.5, .4], [0, 1]];
    const triangles = triangulate([0, 1, 2, 3, 4], points);
    expect(triangles.reduce((s, t) => s + area(t.map(v => points[v])), 0)).toBeCloseTo(area(points), 14);
  });
});

describe('staged face-hinge folding', () => {
  it('starts as the sheet, ends at the baked pose, clamps, and can replay', () => {
    const fold = new FoldUp(data), out = new Float32Array(data.positions.length * 3);
    for (const t of [0, .5, 1, -1, 2, 0]) {
      const same = out;
      fold.apply(t, out);
      expect(out).toBe(same);
      expect(out.every(Number.isFinite)).toBe(true);
      if (t > 0 && t < 1) continue;
      const target = t <= 0 ? data.sheetPositions : data.positions;
      target.forEach((p, i) => p.forEach((n, k) => expect(Math.abs(out[i * 3 + k] - n)).toBeLessThan(1e-8)));
    }
  });

  it('reaches the full flat-folded pose before opening', () => {
    const fold = new FoldUp(data), out = new Float32Array(data.positions.length * 3);
    fold.apply((data.stages - 1) / data.stages, out);
    data.flatPositions.forEach((p, i) => p.forEach((n, k) => expect(Math.abs(out[i * 3 + k] - n)).toBeLessThan(1e-8)));
    const positions: Position[] = data.flatPositions.map((_, i) => [out[i * 3], out[i * 3 + 1], out[i * 3 + 2]]);
    expect(measure(crane.graph, positions).worstStrain).toBeLessThan(.0001);
  });

  it('is continuous across all stage boundaries and writes shared vertex positions', () => {
    const fold = new FoldUp(data), a = new Float32Array(data.positions.length * 3), b = new Float32Array(a.length);
    for (let stage = 1; stage < data.stages; stage++) {
      fold.apply(stage / data.stages - 1e-7, a);
      fold.apply(stage / data.stages + 1e-7, b);
      expect(Math.max(...a.map((v, i) => Math.abs(v - b[i])))).toBeLessThan(1e-6);
    }
    fold.apply(1, a);
    const positions: Position[] = data.positions.map((_, i) => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]]);
    expect(measure(crane.graph, positions).worstStrain).toBeLessThan(.01);
  });
});
