import { flatFold } from './flat.js';
import { area, validate, type Part } from './pattern.js';
import { cross, dot, normal, measure, subtract, unit, type Position } from './relax.js';
import { triangulate } from './triangulate.js';
import type { BakeResult } from './data.js';
import type { Definition } from './definition.js';

export const patterns = [
  () => import('./crane.js').then(m => m.crane()),
  () => import('./frog.js').then(m => m.frog()),
];

/** Rigid frame taking the original sheet plane to a final face. */
function frame(face: number[], sheet: Position[], positions: Position[]) {
  const triangle = triangulate(face, sheet.map(p => [p[0], p[2]]))[0];
  const [a, b, c] = triangle.map(i => sheet[i]), [p, q, r] = triangle.map(i => positions[i]);
  const u = b[0] - a[0], v = b[2] - a[2], s = c[0] - a[0], t = c[2] - a[2], d = u * t - s * v;
  const x = p.map((n, i) => ((q[i] - n) * t - (r[i] - n) * v) / d) as Position;
  const z = p.map((n, i) => ((r[i] - n) * u - (q[i] - n) * s) / d) as Position;
  const y = cross(z, x), translation = p.map((n, i) => n - x[i] * a[0] - z[i] * a[2]) as Position;
  const trace = x[0] + y[1] + z[2];
  let qx: number, qy: number, qz: number, qw: number;
  if (trace > 0) {
    const k = Math.sqrt(trace + 1) * 2;
    qw = k / 4; qx = (y[2] - z[1]) / k; qy = (z[0] - x[2]) / k; qz = (x[1] - y[0]) / k;
  } else if (x[0] > y[1] && x[0] > z[2]) {
    const k = Math.sqrt(1 + x[0] - y[1] - z[2]) * 2;
    qw = (y[2] - z[1]) / k; qx = k / 4; qy = (y[0] + x[1]) / k; qz = (z[0] + x[2]) / k;
  } else if (y[1] > z[2]) {
    const k = Math.sqrt(1 + y[1] - x[0] - z[2]) * 2;
    qw = (z[0] - x[2]) / k; qx = (y[0] + x[1]) / k; qy = k / 4; qz = (z[1] + y[2]) / k;
  } else {
    const k = Math.sqrt(1 + z[2] - x[0] - y[1]) * 2;
    qw = (x[1] - y[0]) / k; qx = (z[0] + x[2]) / k; qy = (z[1] + y[2]) / k; qz = k / 4;
  }
  const n = Math.hypot(qx, qy, qz);
  const rotation: [number, number, number, number] = n < 1e-12 ? [1, 0, 0, 0] : [qx / n, qy / n, qz / n, 2 * Math.atan2(n, qw)];
  return { rotation, translation };
}

export function bake(definition: Definition): BakeResult {
  const c = definition.construction, g = c.graph;
  validate(g);
  const base = c.parts.indexOf('body');
  const flat = flatFold(g, base, c.transforms[base]);
  const shaped = definition.shape(flat);
  for (const pose of [shaped.positions, shaped.flatPositions]) {
    if (pose.length !== g.vertices.length || pose.some(p => p.length !== 3 || p.some(n => !Number.isFinite(n)))) throw new Error('Invalid shape positions');
  }
  const floor = definition.touchesGround ? Math.min(...shaped.positions.map(p => p[1])) : 0;
  const positions: Position[] = shaped.positions.map(p => [p[0], p[1] - floor, p[2]]);
  const flatPositions: Position[] = shaped.flatPositions.map(p => [p[0], p[1] - floor, p[2]]);
  const report = measure(g, positions);
  if (report.worstStrain > .01 || report.rmsStrain > .002 || report.planarity > .0005) throw new Error(`Paper constraints failed: ${JSON.stringify(report)}`);
  const sheetPositions: Position[] = g.vertices.map(p => [p[0], 0, p[1]]);
  const root = frame(g.faces[base], sheetPositions, flatPositions);
  const normals = g.faces.map(f => normal(f, flatPositions));
  const tree = flat.order.map(face => {
    const parent = flat.parents[face], e = g.edges[flat.hinges[face]];
    if (parent < 0) return { face, parent, a: 0, b: 0, angle: 0, stage: 1 };
    const axis = unit(subtract(flatPositions[e.b], flatPositions[e.a]));
    let angle = Math.atan2(dot(axis, cross(normals[parent], normals[face])), dot(normals[parent], normals[face]));
    if (Math.abs(Math.abs(angle) - Math.PI) < 1e-9) angle = e.assignment === 'M' ? -Math.PI : Math.PI;
    return { face, parent, a: e.a, b: e.b, angle, stage: e.stage };
  });
  const pivots = {} as Record<Part, Position>;
  for (const part of new Set(c.parts)) {
    const edge = g.edges.filter(e => e.faces.length === 2 && c.parts[e.faces[0]] !== c.parts[e.faces[1]] && e.faces.some(f => c.parts[f] === part))
      .sort((a, b) => Math.hypot(...subtract(positions[b.a], positions[b.b])) - Math.hypot(...subtract(positions[a.a], positions[a.b])))[0];
    pivots[part] = edge ? positions[edge.a].map((v, i) => (v + positions[edge.b][i]) / 2) as Position : [0, 0, 0];
  }
  const span = (k: number) => Math.max(...positions.map(p => p[k])) - Math.min(...positions.map(p => p[k]));
  const faces = g.faces.map((vertices, i) => ({ vertices, triangles: triangulate(vertices, g.vertices), part: c.parts[i], front: flat.front[i] }));
  const eyes = definition.eyes.map(eye => {
    const candidates = faces.flatMap(f => f.part === eye.face.part ? f.triangles : []).filter(t => {
      const x = t.reduce((sum, v) => sum + positions[v][0], 0);
      return !eye.face.side || (eye.face.side === 'left' ? x < 0 : x > 0);
    });
    candidates.sort((a, b) => Math.hypot(...cross(subtract(positions[b[1]], positions[b[0]]), subtract(positions[b[2]], positions[b[0]]))) - Math.hypot(...cross(subtract(positions[a[1]], positions[a[0]]), subtract(positions[a[2]], positions[a[0]]))));
    if (!candidates.length || Math.abs(eye.weights.reduce((a, b) => a + b, 0) - 1) > 1e-9 || eye.weights.some(w => w < 0)) throw new Error('Invalid eye selector');
    return { part: eye.face.part, vertices: candidates[0], weights: eye.weights, normalSign: eye.normal ? Math.sign(dot(normal(candidates[0], positions), eye.normal)) || 1 : eye.normalSign ?? 1, radius: eye.radius };
  });
  const baked: BakeResult = {
    rig: definition.rig, eyes, touchesGround: definition.touchesGround,
    side: .2, uvs: g.vertices.map(p => [(p[0] + .1) / .2, (p[1] + .1) / .2]), sheetPositions,
    flatPositions, positions,
    faces,
    creases: g.edges.filter(e => e.assignment !== 'B').map(e => ({ ...e, assignment: e.assignment as 'M' | 'V' | 'F' })),
    tree, rootRotation: root.rotation, rootTranslation: root.translation, pivots,
    stages: Math.max(...g.edges.map(e => e.stage)) + 1,
    report: { faceCount: g.faces.length, creaseCount: c.pattern.creases.length, layers: flat.layerCount,
      area: g.faces.reduce((s, f) => s + area(f.map(v => g.vertices[v])), 0),
      wingspan: span(0), height: span(1), length: span(2), closure: flat.closure, ...report, silhouette: definition.metrics?.(positions) ?? {} },
  };
  return JSON.parse(JSON.stringify(baked));
}
