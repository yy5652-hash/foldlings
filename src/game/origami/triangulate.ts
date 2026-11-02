import { TOL, type Point } from './pattern.js';

/** Ear clipping keeps real polygons in the data and avoids collinear fan triangles. */
export function triangulate(face: number[], points: Point[]): number[][] {
  const ids = [...face], triangles: number[][] = [];
  const turn = (a: number, b: number, c: number) => (points[b][0] - points[a][0]) * (points[c][1] - points[a][1]) - (points[b][1] - points[a][1]) * (points[c][0] - points[a][0]);
  while (ids.length > 3) {
    let ear = -1;
    for (let i = 0; i < ids.length; i++) {
      const a = ids[(i + ids.length - 1) % ids.length], b = ids[i], c = ids[(i + 1) % ids.length];
      if (Math.abs(turn(a, b, c)) < TOL * TOL) { ear = i; break; }
      if (turn(a, b, c) < 0) continue;
      if (ids.some(v => v !== a && v !== b && v !== c && turn(a, b, v) >= -TOL * TOL && turn(b, c, v) >= -TOL * TOL && turn(c, a, v) >= -TOL * TOL)) continue;
      triangles.push([a, b, c]); ear = i; break;
    }
    if (ear < 0) throw new Error('Cannot triangulate sheet face');
    ids.splice(ear, 1);
  }
  if (Math.abs(turn(ids[0], ids[1], ids[2])) > TOL * TOL) triangles.push(ids);
  return triangles;
}

/** Positive-area triangle overlap, excluding shared edges and point contacts. */
export function overlap(a: Point[], b: Point[]): boolean {
  let polygon = a;
  if ((b[1][0] - b[0][0]) * (b[2][1] - b[0][1]) - (b[1][1] - b[0][1]) * (b[2][0] - b[0][0]) < 0) b = [b[0], b[2], b[1]];
  for (let j = 0; j < 3 && polygon.length; j++) {
    const p = b[j], q = b[(j + 1) % 3], out: Point[] = [];
    const side = (v: Point) => (q[0] - p[0]) * (v[1] - p[1]) - (q[1] - p[1]) * (v[0] - p[0]);
    polygon.forEach((v, i) => {
      const w = polygon[(i + 1) % polygon.length], s = side(v), t = side(w);
      if (s >= 0) out.push(v);
      if (s * t < 0) out.push([v[0] + s / (s - t) * (w[0] - v[0]), v[1] + s / (s - t) * (w[1] - v[1])]);
    });
    polygon = out;
  }
  let sum = 0;
  polygon.forEach((v, i) => { const w = polygon[(i + 1) % polygon.length]; sum += v[0] * w[1] - v[1] * w[0]; });
  return Math.abs(sum) > 1e-14;
}
