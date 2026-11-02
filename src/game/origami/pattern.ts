/** Sheet coordinates and crease topology, in metres. */
export type Point = [number, number];
export type Part = 'body' | 'wingL' | 'wingR' | 'neck' | 'tail' | 'head' | 'legL' | 'legR' | 'earL' | 'earR';
export interface Crease {
  a: Point;
  b: Point;
  assignment: 'M' | 'V' | 'F';
  stage: number;
}
export interface CreasePattern {
  side: 0.2;
  creases: Crease[];
}
export const TOL = 1e-9;

export interface Edge {
  a: number;
  b: number;
  assignment: 'M' | 'V' | 'F' | 'B';
  stage: number;
  faces: number[];
}
export interface PatternGraph {
  vertices: Point[];
  edges: Edge[];
  faces: number[][];
}
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
export function area(poly: Point[]): number {
  return poly.reduce((s, p, i) => s + cross(p, poly[(i + 1) % poly.length]), 0) / 2;
}

/** Split crossings and collinear overlaps, then walk the directed half-edges. */
export function graph(pattern: CreasePattern): PatternGraph {
  const h = pattern.side / 2;
  const corners: Point[] = [[-h, -h], [h, -h], [h, h], [-h, h]];
  const segments = [
    ...pattern.creases,
    ...corners.map((a, i) => ({ a, b: corners[(i + 1) % 4], assignment: 'B' as const, stage: 0 })),
  ];
  const vertices: Point[] = [];
  const edges: Edge[] = [];
  const id = (p: Point) => {
    const found = vertices.findIndex(q => Math.hypot(q[0] - p[0], q[1] - p[1]) <= TOL);
    if (found >= 0) return found;
    vertices.push(p);
    return vertices.length - 1;
  };
  for (const s of segments) {
    for (const p of [s.a, s.b]) if (Math.max(Math.abs(p[0]), Math.abs(p[1])) > h + TOL) throw new Error(`Outside sheet: ${p}`);
    const d = sub(s.b, s.a), len = Math.hypot(...d);
    if (len <= TOL) throw new Error(`Zero crease: ${s.a}`);
    const cuts = [0, 1];
    for (const q of segments) {
      const e = sub(q.b, q.a), v = sub(q.a, s.a), den = cross(d, e);
      if (Math.abs(den) > TOL * len * Math.hypot(...e)) {
        const t = cross(v, e) / den, u = cross(v, d) / den;
        if (t > 0 && t < 1 && u >= -TOL && u <= 1 + TOL) cuts.push(t);
      } else if (Math.abs(cross(v, d)) / len <= TOL) {
        for (const p of [q.a, q.b]) {
          const t = ((p[0] - s.a[0]) * d[0] + (p[1] - s.a[1]) * d[1]) / (len * len);
          if (t > 0 && t < 1) cuts.push(t);
        }
      }
    }
    cuts.sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      if ((cuts[i] - cuts[i - 1]) * len <= TOL) continue;
      const a = id([s.a[0] + cuts[i - 1] * d[0], s.a[1] + cuts[i - 1] * d[1]]);
      const b = id([s.a[0] + cuts[i] * d[0], s.a[1] + cuts[i] * d[1]]);
      const old = edges.find(e => e.a === a && e.b === b || e.a === b && e.b === a);
      if (old) {
        if (old.assignment !== s.assignment) throw new Error(`Conflicting crease: ${vertices[a]}`);
      } else edges.push({ a, b, assignment: s.assignment, stage: s.stage, faces: [] });
    }
  }
  const neighbors = vertices.map((v, i) => edges.filter(e => e.a === i || e.b === i)
    .map(e => e.a === i ? e.b : e.a)
    .sort((a, b) => Math.atan2(vertices[a][1] - v[1], vertices[a][0] - v[0]) - Math.atan2(vertices[b][1] - v[1], vertices[b][0] - v[0])));
  const seen = new Set<string>(), faces: number[][] = [];
  for (let start = 0; start < vertices.length; start++) for (const next of neighbors[start]) {
    if (seen.has(`${start},${next}`)) continue;
    const face: number[] = [];
    let a = start, b = next;
    do {
      if (face.length > edges.length * 2) throw new Error('Open half-edge walk');
      seen.add(`${a},${b}`);
      face.push(a);
      const ring = neighbors[b], c = ring[(ring.indexOf(a) + ring.length - 1) % ring.length];
      a = b; b = c;
    } while (a !== start || b !== next);
    if (area(face.map(i => vertices[i])) > TOL * TOL) faces.push(face);
  }
  faces.forEach((f, i) => f.forEach((a, j) => {
    const b = f[(j + 1) % f.length];
    edges.find(e => e.a === a && e.b === b || e.a === b && e.b === a)!.faces.push(i);
  }));
  return { vertices, edges, faces };
}

export function validate(g: PatternGraph): void {
  g.vertices.forEach((p, i) => {
    const edges = g.edges.filter(e => e.assignment !== 'F' && (e.a === i || e.b === i));
    if (!edges.length || edges.some(e => e.assignment === 'B')) return;
    const angles = edges.map(e => {
      const q = g.vertices[e.a === i ? e.b : e.a];
      return Math.atan2(q[1] - p[1], q[0] - p[0]);
    }).sort((a, b) => a - b);
    let alternating = 0;
    for (let j = 0; j < angles.length; j += 2) alternating += (angles[(j + 1) % angles.length] - angles[j] + 2 * Math.PI) % (2 * Math.PI);
    if (angles.length % 2 || Math.abs(alternating - Math.PI) > TOL) throw new Error(`Kawasaki at (${p.join(', ')}): ${alternating}`);
    const mountains = edges.filter(e => e.assignment === 'M').length;
    if (Math.abs(2 * mountains - edges.length) !== 2) throw new Error(`Maekawa at (${p.join(', ')}): ${mountains} M / ${edges.length - mountains} V`);
  });
}
