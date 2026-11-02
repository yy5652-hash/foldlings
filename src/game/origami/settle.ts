import type { Position } from './relax.js';

type Flat = [number, number];

/** A vertex this close to the lowest one counts as touching the table. */
const CONTACT = 3e-4;

const rotate = (m: number[], p: Position): Position => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
  m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
  m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
];

/** Centre of mass of a uniform sheet: each triangle weighs what its area does. */
export function centreOfMass(points: Position[], triangles: number[][]): Position {
  const sum: Position = [0, 0, 0];
  let total = 0;
  for (const [a, b, c] of triangles) {
    const p = points[a], q = points[b], r = points[c];
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
    const vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    total += area;
    for (let k = 0; k < 3; k++) sum[k] += (area * (p[k] + q[k] + r[k])) / 3;
  }
  return [sum[0] / total, sum[1] / total, sum[2] / total];
}

function hull(points: Flat[]): Flat[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o: Flat, a: Flat, b: Flat) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const chain = (list: Flat[]) => {
    const out: Flat[] = [];
    for (const p of list) {
      while (out.length > 1 && turn(out[out.length - 2], out[out.length - 1], p) <= 1e-12) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  const result = [...chain(sorted), ...chain(sorted.reverse())];
  return result.length ? result : [sorted[0]];
}

/** Signed distance from `c` to the hull boundary (positive inside) and the nearest boundary point. */
function nearest(shape: Flat[], c: Flat): { margin: number; at: Flat } {
  let at = shape[0], best = Math.hypot(c[0] - at[0], c[1] - at[1]);
  let inside = shape.length > 2;
  for (let i = 0; i < shape.length && shape.length > 1; i++) {
    const a = shape[i], b = shape[(i + 1) % shape.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    const p: Flat = [a[0] + dx * t, a[1] + dy * t];
    const d = Math.hypot(c[0] - p[0], c[1] - p[1]);
    if (d < best) (best = d), (at = p);
    if (dx * (c[1] - a[1]) - dy * (c[0] - a[0]) < 0) inside = false;
  }
  return { margin: inside ? best : -best, at };
}

export interface Rest {
  /** Row-major rotation from the shaped pose to the pose it lies in. */
  rotation: number[];
  /** How far the centre of mass sits inside the contact outline, in metres. */
  margin: number;
  /** Total tilt from the shaped pose, in degrees. */
  tilt: number;
}

/**
 * Lets the sheet fall onto a table under its own weight: while the centre of
 * mass is outside what touches the table, it tips over the nearest edge until
 * the next vertex lands.
 */
export function settle(points: Position[], triangles: number[][]): Rest {
  const com = centreOfMass(points, triangles);
  let rotation = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let margin = 0;
  for (let step = 0; step < 64; step++) {
    const posed = points.map(p => rotate(rotation, p));
    const c = rotate(rotation, com);
    const floor = Math.min(...posed.map(p => p[1]));
    const shape = hull(posed.filter(p => p[1] - floor < CONTACT).map(p => [p[0], p[2]] as Flat));
    const near = nearest(shape, [c[0], c[2]]);
    margin = near.margin;
    if (margin >= 0) break;
    // Fall over the nearest boundary point, directly towards the centre of mass.
    const fx = (c[0] - near.at[0]) / -margin, fz = (c[2] - near.at[1]) / -margin;
    let angle = Infinity;
    for (const p of posed) {
      const reach = (p[0] - near.at[0]) * fx + (p[2] - near.at[1]) * fz;
      const height = p[1] - floor;
      if (reach > 1e-9 && height >= CONTACT) angle = Math.min(angle, Math.atan2(height, reach));
    }
    if (!Number.isFinite(angle)) throw new Error('The centre of mass has nothing to fall onto');
    // In (fall, up): fall' = fall cos + up sin, up' = up cos - fall sin; the axis stays put.
    const s = Math.sin(angle), k = Math.cos(angle) - 1;
    const turn = [
      1 + k * fx * fx, s * fx, k * fx * fz,
      -s * fx, 1 + k, -s * fz,
      k * fx * fz, s * fz, 1 + k * fz * fz,
    ];
    rotation = [
      turn[0] * rotation[0] + turn[1] * rotation[3] + turn[2] * rotation[6],
      turn[0] * rotation[1] + turn[1] * rotation[4] + turn[2] * rotation[7],
      turn[0] * rotation[2] + turn[1] * rotation[5] + turn[2] * rotation[8],
      turn[3] * rotation[0] + turn[4] * rotation[3] + turn[5] * rotation[6],
      turn[3] * rotation[1] + turn[4] * rotation[4] + turn[5] * rotation[7],
      turn[3] * rotation[2] + turn[4] * rotation[5] + turn[5] * rotation[8],
      turn[6] * rotation[0] + turn[7] * rotation[3] + turn[8] * rotation[6],
      turn[6] * rotation[1] + turn[7] * rotation[4] + turn[8] * rotation[7],
      turn[6] * rotation[2] + turn[7] * rotation[5] + turn[8] * rotation[8],
    ];
  }
  if (margin < 0) throw new Error('The sheet did not come to rest');
  const trace = rotation[0] + rotation[4] + rotation[8];
  return { rotation, margin, tilt: (Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2))) * 180) / Math.PI };
}

export const applyRest = (rest: Rest, p: Position): Position => rotate(rest.rotation, p);
