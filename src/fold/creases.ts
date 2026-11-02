/**
 * Turning a free hand motion into a clean fold.
 *
 * Folding point P of the sheet onto the hand position H means the crease is
 * the set of table points equidistant from P and H: the intersection of the
 * perpendicular bisector plane of PH with the table. That raw line is then
 * snapped to the nearest lattice crease so shaky tracking still lands on an
 * exact fold.
 */

import { Line, lineSide, V2 } from './geom.js';
import {
  BOARD,
  Crease,
  creaseLine,
  foldPaper,
  FoldSpec,
  GRID,
  paperBounds,
  PaperState,
} from './paper.js';

function range(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let k = lo; k <= hi; k++) out.push(k);
  return out;
}

const UK = Math.round(BOARD.maxX / GRID);
const VK = Math.round(BOARD.maxY / GRID);

export const CREASES: Crease[] = [
  ...range(-UK + 1, UK - 1).map((k) => ({ f: 'u' as const, k })),
  ...range(-VK + 1, VK - 1).map((k) => ({ f: 'v' as const, k })),
  ...range(-6, 6).map((k) => ({ f: 'd' as const, k })),
  ...range(-6, 6).map((k) => ({ f: 'a' as const, k })),
];

export interface Point3 {
  x: number;
  y: number;
  /** Height above the table. */
  h: number;
}

/** Crease that would carry P (on the table) to H (anywhere above it). */
export function rawCrease(p: V2, hand: Point3, out?: Line): Line | null {
  const dx = hand.x - p.x;
  const dy = hand.y - p.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.012) return null;
  const rhs =
    (hand.x * hand.x + hand.y * hand.y + hand.h * hand.h - p.x * p.x - p.y * p.y) /
    2;
  if (!out) out = { nx: 0, ny: 0, d: 0 };
  out.nx = dx / len; out.ny = dy / len; out.d = rhs / len;
  return out;
}

export interface Snap extends FoldSpec {
  line: Line;
  /** How far the raw line was from the chosen crease, metres. */
  error: number;
}

function lineDistanceNear(raw: Line, cand: Line, p: V2): number {
  // Compare the two lines around the foot of P on the raw line.
  const s = lineSide(raw, p);
  const fx = p.x - s * raw.nx;
  const fy = p.y - s * raw.ny;
  const tx = -raw.ny;
  const ty = raw.nx;
  let worst = 0;
  for (let i = -1; i <= 1; i++) {
    const t = i * 0.06;
    worst = Math.max(worst, Math.abs(cand.nx * (fx + tx * t) + cand.ny * (fy + ty * t) - cand.d));
  }
  return worst;
}

/** True when every facet stays on the mat's board area. */
export function onBoard(paper: PaperState): boolean {
  const b = paperBounds(paper);
  const e = 1e-6;
  return b.minX >= BOARD.minX - e && b.maxX <= BOARD.maxX + e && b.minY >= BOARD.minY - e && b.maxY <= BOARD.maxY + e;
}

/** Validity depends only on the sheet and grab point, so prepare it once per drag. */
export function prepareSnaps(paper: PaperState, p: V2): Snap[] {
  const candidates: Snap[] = [];
  for (const c of CREASES) {
    const line = creaseLine(c);
    const side = lineSide(line, p);
    if (Math.abs(side) < 0.004) continue;
    const s = side > 0 ? 1 : -1;
    const folded = foldPaper(paper, line, s);
    if (folded && onBoard(folded)) candidates.push({ ...c, s, line, error: 0 });
  }
  return candidates;
}

/**
 * Picks the lattice crease closest to `raw` that leaves P on the moving side,
 * actually splits the paper and keeps it on the mat. `prev` gets a small
 * sticky bonus so the crease does not flicker between two neighbours.
 */
export function snapCrease(
  raw: Line,
  p: V2,
  paper: PaperState,
  prev: Crease | null = null,
  maxError = 0.05,
  candidates?: readonly Snap[],
): Snap | null {
  let best: Snap | null = null;
  let bestScore = Infinity;
  const choices = candidates ?? CREASES;
  for (let i = 0; i < choices.length; i++) {
    const c = choices[i];
    const cached = candidates?.[i];
    const line = cached?.line ?? creaseLine(c);
    const side = lineSide(line, p);
    if (Math.abs(side) < 0.004) continue;
    const s: 1 | -1 = side > 0 ? 1 : -1;
    const error = lineDistanceNear(raw, line, p);
    if (error > maxError) continue;
    const sticky = prev && prev.f === c.f && prev.k === c.k ? 0.007 : 0;
    const score = error - sticky;
    if (score >= bestScore) continue;
    if (!cached) {
      const folded = foldPaper(paper, line, s);
      if (!folded || !onBoard(folded)) continue;
    }
    bestScore = score;
    best = cached ?? { ...c, s, line, error };
    best.error = error;
  }
  return best;
}
