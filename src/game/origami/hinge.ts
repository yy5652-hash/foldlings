import type { Position } from './relax.js';

/** The straight crease that best fits a seam between two parts of the sheet. */
export interface Hinge {
  centre: Position;
  axis: Position;
  /** Metres the seam strays from that line: how far it opens per radian turned. */
  residual: number;
}

export function bestLine(points: Position[]): Hinge {
  const centre: Position = [0, 0, 0];
  for (const p of points) for (let k = 0; k < 3; k++) centre[k] += p[k] / points.length;
  const c = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of points) {
    const d = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c[i * 3 + j] += d[i] * d[j];
  }
  // Power iteration on the scatter matrix; three starts so none lands orthogonal to the answer.
  let axis: Position = [1, 0, 0], best = -1;
  for (const start of [[1, 0.3, 0.2], [0.2, 1, 0.3], [0.3, 0.2, 1]] as Position[]) {
    let v = start;
    for (let i = 0; i < 64; i++) {
      const w: Position = [
        c[0] * v[0] + c[1] * v[1] + c[2] * v[2],
        c[3] * v[0] + c[4] * v[1] + c[5] * v[2],
        c[6] * v[0] + c[7] * v[1] + c[8] * v[2],
      ];
      const n = Math.hypot(w[0], w[1], w[2]);
      if (n < 1e-18) break;
      v = [w[0] / n, w[1] / n, w[2] / n];
    }
    const spread =
      v[0] * (c[0] * v[0] + c[1] * v[1] + c[2] * v[2]) +
      v[1] * (c[3] * v[0] + c[4] * v[1] + c[5] * v[2]) +
      v[2] * (c[6] * v[0] + c[7] * v[1] + c[8] * v[2]);
    if (spread > best) (best = spread), (axis = v);
  }
  let residual = 0;
  for (const p of points) {
    const d = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]];
    const along = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
    residual = Math.max(residual, Math.hypot(d[0] - along * axis[0], d[1] - along * axis[1], d[2] - along * axis[2]));
  }
  return { centre, axis, residual };
}
