import type { Point3 } from './creases.js';
import type { Line, V2 } from './geom.js';
import type { PaperState } from './paper.js';

export interface BendPose extends Line {
  theta: number;
  radius: number;
  residual: number;
}

export interface BentPoint extends Point3 {
  nx: number;
  ny: number;
  nh: number;
}

/** Inextensible cylindrical bend, with the positive side moving. */
export function bendPoint(x: number, y: number, height: number, pose: BendPose, hingeY: number, out: BentPoint): BentPoint {
  const s = pose.nx * x + pose.ny * y - pose.d;
  out.x = x;
  out.y = y;
  out.h = height;
  out.nx = out.ny = 0;
  out.nh = 1;
  if (s <= 0) return out;
  const length = pose.radius * pose.theta;
  const a = s <= length && pose.radius > 0 ? s / pose.radius : pose.theta;
  const sin = Math.sin(a);
  const cos = Math.cos(a);
  const rest = Math.max(0, s - length);
  const u = pose.radius * sin + rest * cos;
  const v = pose.radius * (1 - cos) + rest * sin;
  const dy = height - hingeY;
  out.x += pose.nx * (u - s - dy * sin);
  out.y += pose.ny * (u - s - dy * sin);
  out.h = hingeY + v + dy * cos;
  out.nx = -pose.nx * sin;
  out.ny = -pose.ny * sin;
  out.nh = cos;
  return out;
}

export function solveBend(p: V2, hand: Point3, paper: PaperState, prevN: V2 | null, out: BendPose): BendPose {
  const dx = hand.x - p.x;
  const dy = hand.y - p.y;
  const t = Math.hypot(dx, dy);
  const h = Math.max(0, hand.h);
  let nx = t > 0 ? dx / t : 0;
  let ny = t > 0 ? dy / t : 0;
  if (t < 0.012) {
    let bx = prevN?.x ?? 0;
    let by = prevN?.y ?? 0;
    if (!prevN) {
      let count = 0;
      for (const f of paper.facets) for (const v of f.poly) {
        bx += v.x - p.x;
        by += v.y - p.y;
        count++;
      }
      if (count) { bx /= count; by /= count; }
    }
    const bl = Math.hypot(bx, by);
    bx = bl > 1e-12 ? bx / bl : (t > 0 ? nx : 1);
    by = bl > 1e-12 ? by / bl : (t > 0 ? ny : 0);
    const q = Math.max(0, Math.min(1, (t - 0.004) / 0.008));
    const w = q * q * (3 - 2 * q);
    nx = bx * (1 - w) + nx * w;
    ny = by * (1 - w) + ny * w;
    const len = Math.hypot(nx, ny);
    if (len < 1e-12) { nx = bx; ny = by; }
    else { nx /= len; ny /= len; }
  }
  out.nx = -nx;
  out.ny = -ny;
  out.d = out.nx * p.x + out.ny * p.y;
  out.theta = out.radius = 0;
  out.residual = Math.hypot(t, h);
  if (out.residual < 0.003) return out;
  let radius = Math.min(0.3 * h, 0.012);
  let theta: number;
  if (h < 1e-5) { theta = Math.PI; radius = 0; }
  else if (radius === 0) theta = 2 * Math.atan2(t, h);
  else {
    let lo = 0;
    let hi = Math.PI;
    for (let i = 0; i < 24; i++) {
      const a = (lo + hi) / 2;
      const g = radius * (Math.sin(a) - a) - (h - radius * (1 - Math.cos(a))) * Math.tan(a / 2) + t;
      if (g > 0) lo = a;
      else hi = a;
    }
    theta = (lo + hi) / 2;
  }
  let s = theta > Math.PI / 2
    ? (t + radius * (Math.sin(theta) - theta * Math.cos(theta))) / (1 - Math.cos(theta))
    : (h - radius * (1 - Math.cos(theta))) / Math.sin(theta) + radius * theta;
  let max = -Infinity;
  for (const f of paper.facets) for (const v of f.poly) max = Math.max(max, (v.x - p.x) * nx + (v.y - p.y) * ny);
  max -= 0.002;
  if (s > max) {
    s = max;
    theta = s > 0 ? Math.atan2(h, s - dx * nx - dy * ny) : 0;
    // Keep the radius: the sheet is out of reach here, and must not pop.
    radius = Math.min(radius, s / Math.max(theta, 1e-3));
  }
  out.d -= s;
  out.theta = theta;
  out.radius = radius;
  if (s <= 0) {
    out.residual = Math.hypot(t, hand.h);
    return out;
  }
  const a = radius > 0 && s < radius * theta ? s / radius : theta;
  const rest = Math.max(0, s - radius * theta);
  const u = radius * Math.sin(a) + rest * Math.cos(a);
  const v = radius * (1 - Math.cos(a)) + rest * Math.sin(a);
  out.residual = Math.hypot(nx * (s - u) - dx, ny * (s - u) - dy, v - hand.h);
  return out;
}

/** Settle between poses without changing the unit-normal line convention. */
export function interpolateBend(from: BendPose, to: BendPose, t: number, out: BendPose): BendPose {
  let nx = from.nx + (to.nx - from.nx) * t;
  let ny = from.ny + (to.ny - from.ny) * t;
  if (from.nx * to.nx + from.ny * to.ny < -0.999) {
    const angle = Math.atan2(from.nx * to.ny - from.ny * to.nx, from.nx * to.nx + from.ny * to.ny) * t;
    nx = from.nx * Math.cos(angle) - from.ny * Math.sin(angle);
    ny = from.nx * Math.sin(angle) + from.ny * Math.cos(angle);
  }
  const length = Math.hypot(nx, ny);
  out.nx = nx / length;
  out.ny = ny / length;
  out.d = from.d + (to.d - from.d) * t;
  out.theta = from.theta + (to.theta - from.theta) * t;
  out.radius = from.radius + (to.radius - from.radius) * t;
  out.residual = from.residual + (to.residual - from.residual) * t;
  return out;
}

/** Account for the held layer's offset from the neutral hinge plane. */
export function solveHeldBend(p: V2, hand: Point3, paper: PaperState, prevN: V2 | null, height: number, hingeY: number, out: BendPose, scratch: BentPoint): BendPose {
  solveBend(p, hand, paper, prevN, out);
  const dy = height - hingeY;
  for (let i = 0; i < 3; i++) {
    scratch.x = hand.x + dy * out.nx * Math.sin(out.theta);
    scratch.y = hand.y + dy * out.ny * Math.sin(out.theta);
    scratch.h = hand.h - hingeY - dy * Math.cos(out.theta);
    solveBend(p, scratch, paper, prevN, out);
  }
  bendPoint(p.x, p.y, height, out, hingeY, scratch);
  out.residual = Math.hypot(scratch.x - hand.x, scratch.y - hand.y, scratch.h - hand.h);
  return out;
}
