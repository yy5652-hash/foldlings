import { TOL, type PatternGraph, type Point } from './pattern.js';
import { overlap, triangulate } from './triangulate.js';

export type Transform = [number, number, number, number, number, number];
export interface FlatState {
  graph: PatternGraph;
  transforms: Transform[];
  positions: Point[];
  front: boolean[];
  layers: number[];
  layerCount: number;
  closure: number;
  parents: number[];
  hinges: number[];
  order: number[];
}
export function transform(m: Transform, p: Point): Point {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}
function reflect(m: Transform, a: Point, b: Point): Transform {
  const p = transform(m, a), q = transform(m, b);
  const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const nx = (q[1] - p[1]) / length, ny = (p[0] - q[0]) / length, d = nx * p[0] + ny * p[1];
  const x = 1 - 2 * nx * nx, y = -2 * nx * ny, z = 1 - 2 * ny * ny;
  return [x * m[0] + y * m[1], y * m[0] + z * m[1], x * m[2] + y * m[3], y * m[2] + z * m[3], x * m[4] + y * m[5] + 2 * d * nx, y * m[4] + z * m[5] + 2 * d * ny];
}

/** Reflect a face tree, and check every occurrence, including non-tree cycles. */
export function flatFold(g: PatternGraph, base = 0, initial: Transform = [1, 0, 0, 1, 0, 0]): FlatState {
  const transforms: Transform[] = new Array(g.faces.length);
  const parents = g.faces.map(() => -1), hinges = g.faces.map(() => -1), order = [base];
  transforms[base] = initial;
  for (let i = 0; i < order.length; i++) {
    const f = order[i];
    g.edges.forEach((e, j) => {
      if (!e.faces.includes(f)) return;
      for (const child of e.faces) if (!transforms[child]) {
        transforms[child] = e.assignment === 'F' ? [...transforms[f]] : reflect(transforms[f], g.vertices[e.a], g.vertices[e.b]);
        parents[child] = f; hinges[child] = j; order.push(child);
      }
    });
  }
  if (order.length !== g.faces.length) throw new Error('Disconnected sheet');
  const positions: Point[] = new Array(g.vertices.length);
  let closure = 0;
  g.faces.forEach((face, f) => face.forEach(v => {
    const p = transform(transforms[f], g.vertices[v]);
    if (positions[v]) {
      const error = Math.hypot(p[0] - positions[v][0], p[1] - positions[v][1]);
      closure = Math.max(closure, error);
      if (error > TOL) throw new Error(`Flat closure at (${g.vertices[v].join(', ')}): ${error}`);
    } else positions[v] = p;
  }));
  const front = transforms.map(m => m[0] * m[3] - m[1] * m[2] > 0);
  // Greedy overlap colouring is a layer-count heuristic, not a collision proof.
  const triangles = g.faces.map(face => triangulate(face, g.vertices).map(t => t.map(v => positions[v])));
  const layers = parents.map(() => -1);
  for (const f of order) {
    const occupied = new Set<number>();
    for (const other of order) if (layers[other] >= 0 && triangles[f].some(a => triangles[other].some(b => overlap(a, b)))) occupied.add(layers[other]);
    let layer = 0;
    while (occupied.has(layer)) layer++;
    layers[f] = layer;
  }
  return { graph: g, transforms, positions, front, layers, layerCount: Math.max(...layers) + 1, closure, parents, hinges, order };
}
