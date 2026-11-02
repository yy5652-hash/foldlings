import type { FlatState } from './flat.js';
import type { PatternGraph } from './pattern.js';

export type Position = [number, number, number];
export interface Rotation {
  faces: number[];
  axis: [Position, Position];
  angle: number;
}
export const subtract = (a: Position, b: Position): Position => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: Position, b: Position) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Position, b: Position): Position => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function unit(a: Position): Position {
  const n = Math.hypot(...a);
  if (n < 1e-14) throw new Error('Degenerate axis');
  return [a[0] / n, a[1] / n, a[2] / n];
}
export function normal(face: number[], positions: Position[]): Position {
  let best: Position = [0, 0, 0];
  for (let i = 1; i + 1 < face.length; i++) {
    const n = cross(subtract(positions[face[i]], positions[face[0]]), subtract(positions[face[i + 1]], positions[face[0]]));
    if (dot(n, n) > dot(best, best)) best = n;
  }
  return unit(best);
}
export function rotate(p: Position, axis: [Position, Position], angle: number): Position {
  const v = subtract(p, axis[0]), k = unit(subtract(axis[1], axis[0]));
  const c = Math.cos(angle), s = Math.sin(angle), d = dot(k, v), n = cross(k, v);
  return v.map((x, i) => axis[0][i] + x * c + n[i] * s + k[i] * d * (1 - c)) as Position;
}

function constraints(g: PatternGraph): [number, number, number][] {
  const pairs = new Map<string, [number, number, number]>();
  for (const face of g.faces) for (let i = 0; i < face.length; i++) for (let j = i + 1; j < face.length; j++) {
    const a = Math.min(face[i], face[j]), b = Math.max(face[i], face[j]);
    pairs.set(`${a},${b}`, [a, b, Math.hypot(g.vertices[a][0] - g.vertices[b][0], g.vertices[a][1] - g.vertices[b][1])]);
  }
  return [...pairs.values()];
}
export function measure(g: PatternGraph, positions: Position[]) {
  let worst = 0, squared = 0, planarity = 0;
  const pairs = constraints(g);
  for (const [a, b, length] of pairs) {
    const strain = Math.abs(Math.hypot(...subtract(positions[a], positions[b])) / length - 1);
    worst = Math.max(worst, strain); squared += strain * strain;
  }
  for (const face of g.faces) {
    const n = normal(face, positions), p = positions[face[0]];
    for (const v of face) planarity = Math.max(planarity, Math.abs(dot(n, subtract(positions[v], p))));
  }
  return { worstStrain: worst, rmsStrain: Math.sqrt(squared / pairs.length), planarity, constraints: pairs.length };
}

/** Offline position projection includes all polygon diagonals, not only edges. */
export function relax(flat: FlatState, program: Rotation[]) {
  const g = flat.graph;
  const copies = g.faces.map(face => face.map(v => [...flat.positions[v], 0] as Position));
  for (const step of program) for (const face of step.faces) copies[face] = copies[face].map(p => rotate(p, step.axis, step.angle));
  const positions: Position[] = g.vertices.map(() => [0, 0, 0]);
  const counts = g.vertices.map(() => 0);
  g.faces.forEach((face, f) => face.forEach((v, j) => {
    for (let k = 0; k < 3; k++) positions[v][k] += copies[f][j][k];
    counts[v]++;
  }));
  positions.forEach((p, i) => { for (let k = 0; k < 3; k++) p[k] /= counts[i]; });
  const pairs = constraints(g);
  let iterations = 0;
  for (; iterations < 12000; iterations++) {
    let error = 0;
    for (const [a, b, rest] of pairs) {
      const p = positions[a], q = positions[b];
      const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
      const length = Math.hypot(dx, dy, dz);
      if (length < 1e-14) throw new Error('Collapsed constraint');
      error = Math.max(error, Math.abs(length / rest - 1));
      const d = (length - rest) / (2 * length);
      p[0] += dx * d; p[1] += dy * d; p[2] += dz * d;
      q[0] -= dx * d; q[1] -= dy * d; q[2] -= dz * d;
    }
    if (error < 1e-11) break;
  }
  const report = measure(g, positions);
  if (report.worstStrain > .01 || report.rmsStrain > .002 || report.planarity > .0005) throw new Error(`Paper constraints failed: ${JSON.stringify(report)}`);
  return { positions, report: { ...report, iterations } };
}
