import { describe, expect, it } from 'vitest';
import { bake } from './bake.js';
import { baked } from './baked.js';
import { butterfly } from './butterfly.js';
import { runtimeData } from './data.js';
import { flatFold, transform } from './flat.js';
import { FoldUp } from './fold-up.js';
import { area, validate, type Point } from './pattern.js';
import { dot, measure, normal } from './relax.js';

const definition = butterfly(), c = definition.construction, data = bake(definition);
const triangles = data.faces.flatMap(f => f.triangles).map(t => t.map(v => data.positions[v]));
const covers = (x: number, z: number) => triangles.some(t => {
  const sides = t.map((a, i) => {
    const b = t[(i + 1) % 3];
    return (b[0] - a[0]) * (z - a[2]) - (b[2] - a[2]) * (x - a[0]);
  });
  return sides.every(v => v >= -1e-12) || sides.every(v => v <= 1e-12);
});

describe('waterbomb butterfly', () => {
  it('uses the complete square with valid creases, triangles and flat closure', () => {
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

  it('has an X silhouette with leading forewings, blunt hindwings and deep notches', () => {
    expect(data.report.wingspan).toBeGreaterThanOrEqual(.11);
    expect(data.report.wingspan).toBeLessThanOrEqual(.14);
    const body = data.faces.filter(f => f.part === 'body').flatMap(f => f.vertices).map(v => data.positions[v]);
    const middle = (Math.min(...body.map(p => p[2])) + Math.max(...body.map(p => p[2]))) / 2;
    expect(Math.max(...body.map(p => p[0])) - Math.min(...body.map(p => p[0]))).toBeLessThanOrEqual(.012);
    for (const side of [-1, 1]) {
      const wing = data.positions.filter(p => side * p[0] > .004);
      const fore = wing.reduce((a, b) => side * a[0] > side * b[0] ? a : b);
      const hind = wing.filter(p => p[2] > middle + .02).reduce((a, b) => side * a[0] > side * b[0] ? a : b);
      expect(fore[2]).toBeLessThan(middle);
      expect(hind[2]).toBeGreaterThan(middle);
      expect(Math.abs(hind[0])).toBeLessThan(Math.abs(fore[0]));
      const angle = Math.atan2(fore[1], Math.abs(fore[0]) - .004) * 180 / Math.PI;
      expect(angle).toBeGreaterThanOrEqual(10);
      expect(angle).toBeLessThanOrEqual(25);
      let notch = 0;
      for (let z = fore[2] + .0001; z < hind[2]; z += .0001) {
        const width = Math.max(...triangles.flatMap(t => t.flatMap((a, i) => {
          const b = t[(i + 1) % 3];
          if (z < Math.min(a[2], b[2]) || z > Math.max(a[2], b[2]) || Math.abs(b[2] - a[2]) < 1e-12) return [];
          return [side * (a[0] + (b[0] - a[0]) * (z - a[2]) / (b[2] - a[2]))];
        })));
        const line = side * (fore[0] + (hind[0] - fore[0]) * (z - fore[2]) / (hind[2] - fore[2]));
        notch = Math.max(notch, (line - width) * (hind[2] - fore[2]) / Math.hypot(hind[0] - fore[0], hind[2] - fore[2]));
      }
      expect(notch).toBeGreaterThanOrEqual(.015);
    }
    const head = data.faces.filter(f => f.part === 'head').flatMap(f => f.vertices).map(v => data.positions[v]);
    expect(Math.min(...head.map(p => p[2]))).toBeCloseTo(Math.min(...data.positions.map(p => p[2])), 9);
    expect(data.touchesGround).toBe(false);
    expect(covers(0, 0)).toBe(true);
    expect(Math.min(...data.positions.map(p => p[1]))).toBeCloseTo(0, 10);
    expect(data.rig).toEqual({ body: 'body', head: 'body', wingL: 'wingL', wingR: 'wingR' });
  });

  it('mirrors its silhouette and lifts both wings above the wall contact', () => {
    for (const p of data.positions) {
      expect(Math.min(...data.positions.map(q => Math.hypot(p[0] + q[0], p[1] - q[1], p[2] - q[2])))).toBeLessThan(.001);
      expect(p[1]).toBeCloseTo(Math.max(0, Math.abs(p[0]) - .004) * Math.tan(Math.PI / 12), 10);
    }
    expect(data.eyes).toHaveLength(2);
    const eyes = data.eyes.map(e => [0, 1, 2].map(k => e.vertices.reduce((s, v, i) => s + data.positions[v][k] * e.weights[i], 0)));
    expect(eyes[0][0]).toBeLessThan(0);
    expect(eyes[1][0]).toBeGreaterThan(0);
    expect(Math.hypot(eyes[0][0] + eyes[1][0], eyes[0][1] - eyes[1][1], eyes[0][2] - eyes[1][2])).toBeLessThan(.001);
    for (const [i, eye] of data.eyes.entries()) {
      expect(eye.part).toBe('head');
      expect(eyes[i][2]).toBeLessThan(-.015);
      expect(dot(normal(eye.vertices, data.positions), [0, eye.normalSign, 0])).toBeGreaterThan(.99);
      expect(eye.radius).toBeLessThan(.002);
    }
  });

  it('reproduces the bake and retains paper dimensions after quantization', () => {
    expect(runtimeData(data)).toEqual(baked.butterfly);
    expect(bake(butterfly())).toEqual(data);
    for (const positions of [data.positions, baked.butterfly.positions]) {
      const report = measure(c.graph, positions);
      expect(report.worstStrain).toBeLessThanOrEqual(.01);
      expect(report.rmsStrain).toBeLessThanOrEqual(.002);
      expect(report.planarity).toBeLessThanOrEqual(.0005);
    }
  }, 240000);

  it('clamps, replays and joins every folding stage continuously', () => {
    const fold = new FoldUp(baked.butterfly), out = new Float32Array(data.positions.length * 3), next = new Float32Array(out.length);
    for (const [t, target] of [[-1, baked.butterfly.sheetPositions], [0, baked.butterfly.sheetPositions], [(data.stages - 1) / data.stages, baked.butterfly.flatPositions], [1, baked.butterfly.positions], [2, baked.butterfly.positions], [0, baked.butterfly.sheetPositions]] as const) {
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
