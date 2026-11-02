import { area, graph, validate, TOL, type CreasePattern, type Part, type Point, type PatternGraph } from './pattern.js';
import { flatFold, transform, type Transform } from './flat.js';

interface Facet { sheet: Point[]; map: Transform; part: Part; stage: number }
export interface Cut { nx: number; ny: number; d: number }
const side = (p: Point, l: Cut) => p[0] * l.nx + p[1] * l.ny - l.d;
const near = (p: Point, q: Point) => Math.hypot(p[0] - q[0], p[1] - q[1]) < TOL;
function clip(f: Facet, l: Cut, sign: number): Point[] {
  const out: Point[] = [];
  f.sheet.forEach((a, i) => {
    const b = f.sheet[(i + 1) % f.sheet.length];
    const sa = sign * side(transform(f.map, a), l), sb = sign * side(transform(f.map, b), l);
    if (sa >= -TOL) out.push(a);
    if (sa > TOL && sb < -TOL || sa < -TOL && sb > TOL) {
      const t = sa / (sa - sb);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  });
  return out.filter((p, i) => !near(p, out[(i + 1) % out.length]));
}
function reflect(m: Transform, l: Cut): Transform {
  const { nx, ny, d } = l, x = 1 - 2 * nx * nx, y = -2 * nx * ny, z = 1 - 2 * ny * ny;
  return [x * m[0] + y * m[1], y * m[0] + z * m[1], x * m[2] + y * m[3], y * m[2] + z * m[3], x * m[4] + y * m[5] + 2 * d * nx, y * m[4] + z * m[5] + 2 * d * ny];
}
function adjacent(a: Facet, b: Facet, line: Cut): boolean {
  for (let i = 0; i < a.sheet.length; i++) {
    const p = a.sheet[i], q = a.sheet[(i + 1) % a.sheet.length];
    if (Math.abs(side(transform(a.map, p), line)) <= TOL && Math.abs(side(transform(a.map, q), line)) <= TOL) continue;
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
    for (let j = 0; j < b.sheet.length; j++) {
      const r = b.sheet[j], s = b.sheet[(j + 1) % b.sheet.length];
      if (Math.abs(dx * (r[1] - p[1]) - dy * (r[0] - p[0])) > TOL * len || Math.abs(dx * (s[1] - p[1]) - dy * (s[0] - p[0])) > TOL * len) continue;
      const u = ((r[0] - p[0]) * dx + (r[1] - p[1]) * dy) / len;
      const v = ((s[0] - p[0]) * dx + (s[1] - p[1]) * dy) / len;
      if (Math.min(len, Math.max(u, v)) - Math.max(0, Math.min(u, v)) > TOL) return true;
    }
  }
  return false;
}

/** Work on connected paper flaps, never on disconnected decorative triangles. */
export class Construction {
  facets: Facet[];
  private creases: CreasePattern['creases'];
  constructor(pattern: CreasePattern, part: (p: Point) => Part) {
    this.creases = [...pattern.creases];
    const g = graph(pattern);
    validate(g);
    const flat = flatFold(g);
    // Orient the base with the leg direction along u and its full width along v.
    const origin = flat.positions[g.vertices.findIndex(p => Math.hypot(...p) < TOL)];
    const tip = flat.positions[g.vertices.findIndex(p => near(p, [.1, .1]))];
    const dx = tip[0] - origin[0], dy = tip[1] - origin[1], len = Math.hypot(dx, dy);
    const x = dx / len, y = dy / len;
    this.facets = g.faces.map((f, i) => {
      const m = flat.transforms[i];
      const map: Transform = [x * m[0] + y * m[1], -y * m[0] + x * m[1], x * m[2] + y * m[3], -y * m[2] + x * m[3], x * (m[4] - origin[0]) + y * (m[5] - origin[1]), -y * (m[4] - origin[0]) + x * (m[5] - origin[1])];
      const sheet = f.map(v => g.vertices[v]);
      const center: Point = [sheet.reduce((s, p) => s + p[0], 0) / f.length, sheet.reduce((s, p) => s + p[1], 0) / f.length];
      return { sheet, map, part: part(center), stage: 0 };
    });
  }

  /** Split in the current folded plane; move only components containing seeds. */
  fold(line: Cut, seeds: Point[], stage: number, part?: Part): void {
    const split: Facet[] = [];
    for (const f of this.facets) for (const sign of [-1, 1]) {
      const sheet = clip(f, line, sign);
      if (sheet.length >= 3 && area(sheet) > TOL * TOL) split.push({ ...f, sheet });
    }
    const positive = split.map(f => f.sheet.some(p => side(transform(f.map, p), line) > TOL));
    const moving = new Set<number>();
    split.forEach((f, i) => { if (positive[i] && seeds.some(s => f.sheet.some(p => near(p, s)))) moving.add(i); });
    const queue = [...moving];
    for (let n = 0; n < queue.length; n++) {
      const f = queue[n];
      split.forEach((other, j) => {
        if (positive[j] && !moving.has(j) && adjacent(split[f], other, line)) { moving.add(j); queue.push(j); }
      });
    }
    if (!moving.size) throw new Error(`No flap at stage ${stage}`);
    moving.forEach(i => {
      const f = split[i];
      f.sheet.forEach((a, j) => {
        const b = f.sheet[(j + 1) % f.sheet.length];
        if (Math.abs(side(transform(f.map, a), line)) < TOL && Math.abs(side(transform(f.map, b), line)) < TOL) this.creases.push({ a, b, assignment: 'M', stage });
      });
      split[i].map = reflect(split[i].map, line);
      split[i].stage = stage;
      if (part) split[i].part = part;
    });
    this.facets = split;
  }

  /** Add an unfolded hinge in the current plane for the opening program. */
  crease(line: Cut, stage: number): void {
    const split: Facet[] = [];
    for (const f of this.facets) for (const sign of [-1, 1]) {
      const sheet = clip(f, line, sign);
      if (sheet.length < 3 || area(sheet) <= TOL * TOL) continue;
      split.push({ ...f, sheet });
      sheet.forEach((a, i) => {
        const b = sheet[(i + 1) % sheet.length];
        if (Math.abs(side(transform(f.map, a), line)) < TOL && Math.abs(side(transform(f.map, b), line)) < TOL) this.creases.push({ a, b, assignment: 'F', stage });
      });
    }
    this.facets = split;
  }

  finish(): { pattern: CreasePattern; graph: PatternGraph; positions: Point[]; parts: Part[]; transforms: Transform[] } {
    const all: CreasePattern = { side: .2, creases: [] };
    for (const f of this.facets) f.sheet.forEach((a, i) => {
      const b = f.sheet[(i + 1) % f.sheet.length];
      if (Math.abs(Math.abs(a[0]) - .1) < TOL && Math.abs(a[0] - b[0]) < TOL || Math.abs(Math.abs(a[1]) - .1) < TOL && Math.abs(a[1] - b[1]) < TOL) return;
      all.creases.push({ a, b, assignment: 'M', stage: Math.max(1, f.stage) });
    });
    const tiled = graph(all);
    const owner = (p: Point) => this.facets.find(f => f.sheet.every((a, i) => {
      const b = f.sheet[(i + 1) % f.sheet.length];
      return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -TOL * TOL;
    }))!;
    const center = (ids: number[], g: PatternGraph): Point => [ids.reduce((s, i) => s + g.vertices[i][0], 0) / ids.length, ids.reduce((s, i) => s + g.vertices[i][1], 0) / ids.length];
    const owners = tiled.faces.map(f => owner(center(f, tiled)));
    const pattern: CreasePattern = { side: .2, creases: [] };
    for (const e of tiled.edges) {
      if (e.faces.length !== 2) continue;
      const a = owners[e.faces[0]], b = owners[e.faces[1]];
      const unfolded = a.map.every((v, i) => Math.abs(v - b.map[i]) < TOL);
      if (unfolded && !this.creases.some(c => c.assignment === 'F' && [tiled.vertices[e.a], tiled.vertices[e.b]].every(p => {
        const dx = c.b[0] - c.a[0], dy = c.b[1] - c.a[1];
        return Math.abs(dx * (p[1] - c.a[1]) - dy * (p[0] - c.a[0])) < TOL * Math.hypot(dx, dy);
      }))) continue;
      pattern.creases.push({ a: tiled.vertices[e.a], b: tiled.vertices[e.b], assignment: unfolded ? 'F' : 'M', stage: Math.max(1, a.stage, b.stage) });
    }
    const g = graph(pattern);
    for (const e of g.edges) {
      if (e.assignment === 'B') continue;
      const p = g.vertices[e.a], q = g.vertices[e.b], m: Point = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const source = this.creases.filter(c => {
        const dx = c.b[0] - c.a[0], dy = c.b[1] - c.a[1], len = Math.hypot(dx, dy);
        const t = ((m[0] - c.a[0]) * dx + (m[1] - c.a[1]) * dy) / (len * len);
        return t >= -TOL && t <= 1 + TOL && Math.abs(dx * (m[1] - c.a[1]) - dy * (m[0] - c.a[0])) < TOL * len;
      });
      if (!source.length) throw new Error(`Unstaged crease at ${m}`);
      e.stage = Math.min(...source.map(c => c.stage));
    }
    assign(g);
    pattern.creases = g.edges.filter(e => e.assignment !== 'B').map(e => ({ a: g.vertices[e.a], b: g.vertices[e.b], assignment: e.assignment as 'M' | 'V' | 'F', stage: e.stage }));
    const positions = g.vertices.map(p => transform(owner(p).map, p));
    const parts = g.faces.map(f => owner(center(f, g)).part);
    return { pattern, graph: g, positions, parts, transforms: g.faces.map(f => owner(center(f, g)).map) };
  }
}

/** Local M/V labels; this does not certify a collision-free layer ordering. */
export function assign(g: PatternGraph): void {
  const vertices = g.vertices.map((_, i) => g.edges.map((e, j) => e.assignment !== 'F' && (e.a === i || e.b === i) ? j : -1).filter(j => j >= 0))
    .filter(es => es.length && !es.some(j => g.edges[j].assignment === 'B'));
  const signs: number[] = g.edges.map(e => e.assignment === 'B' || e.assignment === 'F' ? 0 : -1);
  const order = g.edges.map((_, i) => i).filter(i => signs[i] < 0)
    .sort((a, b) => vertices.filter(v => v.includes(b)).length - vertices.filter(v => v.includes(a)).length || a - b);
  const valid = () => vertices.every(es => {
    const yes = es.filter(i => signs[i] === 1).length, unknown = es.filter(i => signs[i] < 0).length;
    return [es.length / 2 - 1, es.length / 2 + 1].some(n => yes <= n && yes + unknown >= n);
  });
  const solve = (n: number): boolean => {
    if (n === order.length) return valid();
    for (const sign of [1, 0]) {
      signs[order[n]] = sign;
      if (valid() && solve(n + 1)) return true;
    }
    signs[order[n]] = -1;
    return false;
  };
  if (!solve(0)) throw new Error('No local Maekawa assignment');
  order.forEach(i => { g.edges[i].assignment = signs[i] ? 'M' : 'V'; });
}
