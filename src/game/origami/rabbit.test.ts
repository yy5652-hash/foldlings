import { describe, expect, it } from 'vitest';
import { bake } from './bake.js';
import { baked } from './baked.js';
import { runtimeData } from './data.js';
import { flatFold, transform } from './flat.js';
import { FoldUp } from './fold-up.js';
import { area, validate, type Part, type Point } from './pattern.js';
import { rabbit } from './rabbit.js';
import { cross, dot, measure, normal, subtract, type Position } from './relax.js';

// Shape checks read the pose as designed; the bake itself lies where its weight puts it.
const definition = rabbit(), c = definition.construction, data = bake(definition, { rest: false });
const ids = (part: Part) => [...new Set(data.faces.flatMap(f => data.rig[f.part] === part ? f.vertices : []))];
const points = (part: Part) => ids(part).map(v => data.positions[v]);
const span = (ps: Position[], k: number) => Math.max(...ps.map(p => p[k])) - Math.min(...ps.map(p => p[k]));
const top = (part: Part) => Math.max(...points(part).map(p => p[1]));
const distance = (a: Position, b: Position) => Math.hypot(...subtract(a, b));
function hull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (ps: Point[]) => {
    const out: Point[] = [];
    for (const p of ps) {
      while (out.length > 1) {
        const a = out[out.length - 2], b = out[out.length - 1];
        if ((b[0] - a[0]) * (p[1] - b[1]) - (b[1] - a[1]) * (p[0] - b[0]) > 1e-8) break;
        out.pop();
      }
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

function section(part: Part, y: number) {
  const ps: Position[] = [];
  for (const face of data.faces.filter(f => f.part === part)) face.vertices.forEach((v, i) => {
    const a = data.positions[v], b = data.positions[face.vertices[(i + 1) % face.vertices.length]];
    const t = (y - a[1]) / (b[1] - a[1]);
    if (t >= 0 && t <= 1) ps.push(a.map((n, k) => n + (b[k] - n) * t) as Position);
  });
  const center = [0, 1, 2].map(k => (Math.min(...ps.map(p => p[k])) + Math.max(...ps.map(p => p[k]))) / 2) as Position;
  return { center, width: span(ps, 0) };
}

function occlusion(p: Position, sign: number): number {
  let depth = 0;
  for (const face of data.faces) for (const triangle of face.triangles) {
    const [a, b, c] = triangle.map(v => data.positions[v]);
    const u = [b[1] - a[1], b[2] - a[2]], v = [c[1] - a[1], c[2] - a[2]];
    const y = p[1] - a[1], z = p[2] - a[2], d = u[0] * v[1] - u[1] * v[0];
    if (Math.abs(d) < 1e-10) continue;
    const s = (y * v[1] - z * v[0]) / d, t = (u[0] * z - u[1] * y) / d;
    if (s < -1e-6 || t < -1e-6 || s + t > 1 + 1e-6) continue;
    depth = Math.max(depth, sign * (a[0] + s * (b[0] - a[0]) + t * (c[0] - a[0]) - p[0]));
  }
  return depth;
}

describe('rabbit paper', () => {
  it('uses the whole square with valid local folds, triangulation and flat closure', () => {
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
    expect(new Set(c.parts)).toEqual(new Set(['body', 'head', 'neck', 'earL', 'earR']));
    expect(data.rig).toEqual({ body: 'body', head: 'head', neck: 'head', earL: 'earL', earR: 'earR' });
  });

  it('has broad upright ears with rounded crowns, a 15–30 degree V and a slight backward lean', () => {
    expect(data.report.height).toBeGreaterThanOrEqual(.09);
    expect(data.report.height).toBeLessThanOrEqual(.12);
    const angles: number[] = [];
    for (const part of ['earL', 'earR'] as const) {
      const ps = points(part), low = Math.min(...ps.map(p => p[1])), height = top(part) - low;
      const slice = (t: number) => section(part, low + height * t);
      expect(height / data.report.height).toBeGreaterThanOrEqual(.4);
      const widest = Math.max(...[.15, .35, .55, .75, .9].map(t => slice(t).width));
      expect(widest).toBeGreaterThanOrEqual(.012);
      expect(slice(.98).width).toBeGreaterThan(.0015);
      expect(slice(.98).width).toBeLessThan(widest * .4);
      const a = slice(.15).center, b = slice(.85).center;
      angles.push(Math.atan2(Math.abs(b[0] - a[0]), b[1] - a[1]) * 180 / Math.PI);
      expect((b[2] - a[2]) / (b[1] - a[1])).toBeGreaterThan(.03);
      expect((b[2] - a[2]) / (b[1] - a[1])).toBeLessThan(.45);
      expect(top(part)).toBeGreaterThan(Math.max(top('head'), top('body')) + .03);
      for (const t of [.35, .55, .75, .9]) {
        const cut = slice(t), sign = part === 'earL' ? -1 : 1;
        expect(sign * cut.center[0] - cut.width / 2).toBeGreaterThan(.001);
      }
    }
    expect(angles[0] + angles[1]).toBeGreaterThanOrEqual(15);
    expect(angles[0] + angles[1]).toBeLessThanOrEqual(30);
  });

  it('has a compact head, a blunt forward nose and a low rear tail bump', () => {
    const head = points('head'), body = points('body');
    const dimensions = [0, 1, 2].map(k => span(head, k));
    expect(Math.min(...dimensions)).toBeGreaterThan(.015);
    expect(Math.max(...dimensions) / Math.min(...dimensions)).toBeLessThan(2.5);
    const nose = Math.min(...head.map(p => p[2]));
    const forehead = head.filter(p => p[1] > top('head') - .005);
    expect(nose).toBeLessThan(Math.min(...forehead.map(p => p[2])) - .002);
    expect(Math.min(...forehead.map(p => p[2])) - nose).toBeLessThan(.012);
    const muzzle = head.filter(p => p[2] < nose + .003);
    expect(span(muzzle, 1)).toBeGreaterThan(.004);
    expect(top('head') - Math.min(...muzzle.map(p => p[1]))).toBeLessThan(.035);
    const back = Math.max(...body.filter(p => p[1] > .025).map(p => p[2]));
    const tail = body.filter(p => p[2] > back + .005);
    expect(tail.length).toBeGreaterThan(0);
    expect(Math.max(...tail.map(p => p[2])) - back).toBeLessThan(.025);
    expect(Math.max(...tail.map(p => p[1]))).toBeLessThan(.025);
    expect(span(tail, 0)).toBeLessThan(span(body, 0) * .6);
  });

  it('opens a rounded faceted body with volume, symmetric silhouettes and ground contact', () => {
    const body = points('body');
    expect(span(body, 0)).toBeGreaterThan(span(points('head'), 0));
    expect(span(body, 2)).toBeGreaterThan(span(points('head'), 2));
    expect(span(body, 0)).toBeGreaterThan(.03);
    expect(span(body, 0)).toBeLessThan(.05);
    expect(top('body')).toBeGreaterThan(.04);
    for (const k of [0, 2]) {
      const outline = hull(body.map(p => [p[k], p[1]]));
      expect(outline.length).toBeGreaterThanOrEqual(5);
      expect(area(outline) / (span(body, k) * span(body, 1))).toBeGreaterThan(.65);
    }
    for (const p of data.positions) {
      const reflected: Position = [-p[0], p[1], p[2]];
      expect(Math.min(...data.positions.map(q => distance(reflected, q)))).toBeLessThanOrEqual(.001);
    }
    expect(data.touchesGround).toBe(true);
    expect(Math.min(...body.map(p => p[1]))).toBe(0);
    expect(span(body.filter(p => p[1] < .0001), 0)).toBeGreaterThan(.025);
    expect(Math.min(...data.positions.map(p => p[1]))).toBe(0);
  });

  it('places mirrored ink eyes on visible cheeks below both ears', () => {
    expect(data.eyes).toHaveLength(2);
    const eyes = data.eyes.map((eye, i) => {
      expect(eye.part).toBe('head');
      expect(eye.vertices.every(v => ids('head').includes(v))).toBe(true);
      expect(eye.weights.every(w => w > 0)).toBe(true);
      expect(eye.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      const triangle = eye.vertices.map(v => data.positions[v]);
      const twiceArea = Math.hypot(...cross(subtract(triangle[1], triangle[0]), subtract(triangle[2], triangle[0])));
      eye.weights.forEach((w, j) => {
        expect(w * twiceArea / distance(triangle[(j + 1) % 3], triangle[(j + 2) % 3])).toBeGreaterThan(eye.radius);
      });
      expect(dot(normal(eye.vertices, data.positions), [i ? eye.normalSign : -eye.normalSign, 0, 0])).toBeGreaterThan(.8);
      const p = [0, 1, 2].map(k => eye.vertices.reduce((sum, v, j) => sum + data.positions[v][k] * eye.weights[j], 0)) as Position;
      expect(p[1]).toBeGreaterThan(top('body') - .005);
      expect(p[1]).toBeLessThan(top('head'));
      expect(occlusion(p, i ? 1 : -1)).toBeLessThan(.0003);
      return p;
    });
    expect(eyes[0][0]).toBeLessThan(0);
    expect(eyes[1][0]).toBeGreaterThan(0);
    expect(distance([-eyes[0][0], eyes[0][1], eyes[0][2]], eyes[1])).toBeLessThan(.001);
  });

  it('reproduces the bake and preserves every edge, diagonal and face plane after rounding', () => {
    expect(runtimeData(bake(definition))).toEqual(baked.rabbit);
    for (const positions of [data.positions, baked.rabbit.positions, data.flatPositions]) {
      const report = measure(c.graph, positions);
      expect(report.worstStrain).toBeLessThanOrEqual(.01);
      expect(report.rmsStrain).toBeLessThanOrEqual(.002);
      expect(report.planarity).toBeLessThanOrEqual(.0005);
    }
  }, 240000);

  it('replays and clamps the sheet, flat and opened poses continuously in one buffer', () => {
    const fold = new FoldUp(baked.rabbit), out = new Float32Array(data.positions.length * 3), next = new Float32Array(out.length);
    for (const [t, target] of [[0, baked.rabbit.sheetPositions], [(data.stages - 1) / data.stages, baked.rabbit.flatPositions], [1, baked.rabbit.positions], [-1, baked.rabbit.sheetPositions], [2, baked.rabbit.positions], [0, baked.rabbit.sheetPositions]] as const) {
      fold.apply(t, out);
      target.forEach((p, i) => p.forEach((n, k) => expect(Math.abs(out[i * 3 + k] - n)).toBeLessThan(1e-8)));
    }
    // Rounded sheet hinges accumulate up to 0.02 mm at the flat-pose seam.
    for (const [pose, tolerance] of [[data, 1e-6], [baked.rabbit, .00002]] as const) {
      const replay = new FoldUp(pose);
      for (let stage = 0; stage <= data.stages; stage++) {
        replay.apply(stage / data.stages - 1e-7, out);
        replay.apply(stage / data.stages + 1e-7, next);
        expect(out.every(Number.isFinite)).toBe(true);
        expect(Math.max(...out.map((n, i) => Math.abs(n - next[i])))).toBeLessThan(tolerance);
      }
    }
  });
});
