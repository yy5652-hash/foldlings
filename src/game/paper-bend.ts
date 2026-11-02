import { bendPoint, BendPose, BentPoint } from '../fold/bend.js';
import type { Facet } from '../fold/paper.js';
import { PAPER_SIZE } from '../fold/paper.js';

export interface BendBuffers {
  polygon: Float64Array;
  scratchA: Float64Array;
  scratchB: Float64Array;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  point: BentPoint;
  height: number;
}

export interface WallBuffers {
  positions: Float32Array;
  aH: Float32Array;
}

/** Ten bands at most; each clipped convex polygon gains at most four vertices. */
export function createBendBuffers(f: Facet, height: number, expand = 0): BendBuffers {
  const n = f.poly.length;
  const polygon = new Float64Array(n * 2);
  let cx = 0;
  let cy = 0;
  for (const p of f.poly) { cx += p.x / n; cy += p.y / n; }
  for (let i = 0; i < n; i++) {
    const p = f.poly[i];
    const len = Math.hypot(p.x - cx, p.y - cy) || 1;
    polygon[i * 2] = p.x + (p.x - cx) / len * expand;
    polygon[i * 2 + 1] = p.y + (p.y - cy) / len * expand;
  }
  const capacity = 30 * (n + 2);
  return {
    polygon, height,
    scratchA: new Float64Array((n + 4) * 2),
    scratchB: new Float64Array((n + 4) * 2),
    positions: new Float32Array(capacity * 3),
    normals: new Float32Array(capacity * 3),
    uvs: new Float32Array(capacity * 2),
    point: { x: 0, y: 0, h: 0, nx: 0, ny: 0, nh: 1 },
  };
}

function clip(input: Float64Array, count: number, output: Float64Array, pose: BendPose, bound: number, sign: number): number {
  let written = 0;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    const ax = input[i * 2];
    const ay = input[i * 2 + 1];
    const bx = input[j * 2];
    const by = input[j * 2 + 1];
    const sa = sign * (pose.nx * ax + pose.ny * ay - pose.d - bound);
    const sb = sign * (pose.nx * bx + pose.ny * by - pose.d - bound);
    if (sa >= 0) { output[written++] = ax; output[written++] = ay; }
    if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) {
      const t = sa / (sa - sb);
      output[written++] = ax + (bx - ax) * t;
      output[written++] = ay + (by - ay) * t;
    }
  }
  return written / 2;
}

function mapPoint(x: number, y: number, b: BendBuffers, pose: BendPose, hingeY: number, moving: boolean) {
  if (moving) bendPoint(x, y, b.height, pose, hingeY, b.point);
  else {
    b.point.x = x; b.point.y = y; b.point.h = b.height;
    b.point.nx = b.point.ny = 0; b.point.nh = 1;
  }
}

/** Writes triangles in board-local x/up/-y coordinates, retaining sheet-space UVs. */
export function writeBentFacet(f: Facet, b: BendBuffers, pose: BendPose, hingeY: number, moving = true): number {
  const length = moving ? pose.radius * pose.theta : 0;
  const k = Math.max(1, Math.min(8, Math.ceil(length / 0.002)));
  const bands = !moving ? 1 : length > 0 ? k + 2 : 2;
  let count = 0;
  for (let band = 0; band < bands; band++) {
    const lo = band === 0 ? -Infinity : (band - 1) * length / k;
    const hi = band === bands - 1 ? Infinity : band * length / k;
    let poly = b.polygon;
    let n = poly.length / 2;
    if (lo !== -Infinity) { n = clip(poly, n, b.scratchA, pose, lo, 1); poly = b.scratchA; }
    if (hi !== Infinity) { n = clip(poly, n, b.scratchB, pose, hi, -1); poly = b.scratchB; }
    for (let i = 1; i < n - 1; i++) {
      const area = (poly[i * 2] - poly[0]) * (poly[(i + 1) * 2 + 1] - poly[1]) -
        (poly[i * 2 + 1] - poly[1]) * (poly[(i + 1) * 2] - poly[0]);
      if (Math.abs(area) < 1e-16) continue;
      for (let v = 0; v < 3; v++) {
        const index = v === 0 ? 0 : v === 1 ? i : i + 1;
        const x = poly[index * 2];
        const y = poly[index * 2 + 1];
        mapPoint(x, y, b, pose, hingeY, moving);
        const p = b.point;
        b.positions[count * 3] = p.x; b.positions[count * 3 + 1] = p.h; b.positions[count * 3 + 2] = -p.y;
        b.normals[count * 3] = p.nx; b.normals[count * 3 + 1] = p.nh; b.normals[count * 3 + 2] = -p.ny;
        const m = f.toSheet;
        b.uvs[count * 2] = (m[0] * x + m[2] * y + m[4]) / PAPER_SIZE + 0.5;
        b.uvs[count * 2 + 1] = (m[1] * x + m[3] * y + m[5]) / PAPER_SIZE + 0.5;
        count++;
      }
    }
  }
  return count;
}

/** Only original boundary edges get walls; slice cuts never do. Returns vertices written. */
export function writeBentWalls(b: BendBuffers, pose: BendPose, hingeY: number, wallHeight: number, out: WallBuffers, offset = 0, moving = true): number {
  const length = moving ? pose.radius * pose.theta : 0;
  const k = Math.max(1, Math.min(8, Math.ceil(length / 0.002)));
  const bands = !moving ? 1 : length > 0 ? k + 2 : 2;
  const n = b.polygon.length / 2;
  let count = offset;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = b.polygon[i * 2];
    const ay = b.polygon[i * 2 + 1];
    const bx = b.polygon[j * 2];
    const by = b.polygon[j * 2 + 1];
    const sa = pose.nx * ax + pose.ny * ay - pose.d;
    const sb = pose.nx * bx + pose.ny * by - pose.d;
    for (let band = 0; band < bands; band++) {
      const lo = band === 0 ? -Infinity : (band - 1) * length / k;
      const hi = band === bands - 1 ? Infinity : band * length / k;
      let t0 = 0;
      let t1 = 1;
      if (Math.abs(sb - sa) < 1e-14) {
        if (sa < lo || sa >= hi) continue;
      } else {
        const a = (lo - sa) / (sb - sa);
        const c = (hi - sa) / (sb - sa);
        t0 = Math.max(0, Math.min(a, c));
        t1 = Math.min(1, Math.max(a, c));
      }
      if (t1 - t0 < 1e-12) continue;
      for (let v = 0; v < 6; v++) {
        const t = v === 0 || v === 3 || v === 5 ? t0 : t1;
        const top = v === 2 || v === 4 || v === 5 ? 1 : 0;
        mapPoint(ax + (bx - ax) * t, ay + (by - ay) * t, b, pose, hingeY, moving);
        const p = b.point;
        out.positions[count * 3] = p.x + p.nx * wallHeight * top;
        out.positions[count * 3 + 1] = p.h + p.nh * wallHeight * top;
        out.positions[count * 3 + 2] = -p.y - p.ny * wallHeight * top;
        out.aH[count++] = top;
      }
    }
  }
  return count - offset;
}
