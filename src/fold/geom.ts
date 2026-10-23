/**
 * Small 2D geometry kit for the folding engine.
 *
 * Paper lives in "board space": u to the right, v away from the player,
 * metres. Every facet is a convex polygon, because the paper starts as a
 * square and each fold only clips by a half-plane and reflects.
 */

export interface V2 {
  x: number;
  y: number;
}

/** Oriented line: points p with n·p = d, where n is a unit normal. */
export interface Line {
  nx: number;
  ny: number;
  d: number;
}

/** 2D affine map: [x', y'] = [a c; b d] [x, y] + [tx, ty]. */
export type Affine = [number, number, number, number, number, number];

export const EPS = 1e-7;

export const v2 = (x: number, y: number): V2 => ({ x, y });

export function lineSide(line: Line, p: V2): number {
  return line.nx * p.x + line.ny * p.y - line.d;
}

export function reflectPoint(line: Line, p: V2): V2 {
  const s = lineSide(line, p);
  return { x: p.x - 2 * s * line.nx, y: p.y - 2 * s * line.ny };
}

/** Affine map of the reflection across `line`. */
export function reflectionAffine(line: Line): Affine {
  const { nx, ny, d } = line;
  return [
    1 - 2 * nx * nx,
    -2 * nx * ny,
    -2 * nx * ny,
    1 - 2 * ny * ny,
    2 * d * nx,
    2 * d * ny,
  ];
}

export function applyAffine(m: Affine, p: V2): V2 {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  };
}

/** Returns a ∘ b (apply b first, then a). */
export function composeAffine(a: Affine, b: Affine): Affine {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export function polygonArea(poly: readonly V2[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return a / 2;
}

/**
 * Keeps the part of a convex polygon where sign * side(line) >= 0.
 * Sutherland–Hodgman against a single half-plane; result stays convex.
 */
export function clipConvex(
  poly: readonly V2[],
  line: Line,
  sign: 1 | -1,
): V2[] {
  const out: V2[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const sa = sign * lineSide(line, a);
    const sb = sign * lineSide(line, b);
    const aIn = sa >= -EPS;
    const bIn = sb >= -EPS;
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const t = sa / (sa - sb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return dedupe(out);
}

function dedupe(poly: V2[]): V2[] {
  const out: V2[] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1e-9 || Math.abs(last.y - p.y) > 1e-9) {
      out.push(p);
    }
  }
  if (out.length > 1) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.abs(f.x - l.x) <= 1e-9 && Math.abs(f.y - l.y) <= 1e-9) out.pop();
  }
  return out;
}

/** Point in convex CCW polygon, strictly inside up to `tol`. */
export function insideConvex(poly: readonly V2[], p: V2, tol = 0): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    if (cross / len < tol) return false;
  }
  return true;
}

export function normalizeLine(nx: number, ny: number, d: number): Line {
  const len = Math.hypot(nx, ny);
  return { nx: nx / len, ny: ny / len, d: d / len };
}

/** The chord of a convex polygon cut by `line`, or null if it misses. */
export function lineChord(line: Line, poly: readonly V2[]): [V2, V2] | null {
  const pts: V2[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const sa = lineSide(line, a);
    const sb = lineSide(line, b);
    if (Math.abs(sa) < 1e-9) pts.push(a);
    else if (sa * sb < 0) {
      const t = sa / (sa - sb);
      pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  if (pts.length < 2) return null;
  let best: [V2, V2] = [pts[0], pts[1]];
  let bestD = -1;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d > bestD) {
        bestD = d;
        best = [pts[i], pts[j]];
      }
    }
  }
  return bestD > 1e-6 ? best : null;
}

/** Closest point to p on a convex CCW polygon (p itself if inside). */
export function closestOnConvex(poly: readonly V2[], p: V2): V2 {
  if (insideConvex(poly, p)) return p;
  let best = poly[0];
  let bestD = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / (ex * ex + ey * ey || 1)));
    const q = { x: a.x + ex * t, y: a.y + ey * t };
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}
