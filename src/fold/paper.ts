/**
 * Folding engine: a sheet of paper as a stack of convex facets.
 *
 * A fold reflects every facet part on the moving side of a crease line onto
 * the other side and stacks it on top in reverse order, which is what happens
 * when you fold a whole stack of paper flat on a table.
 */

import {
  Affine,
  clipConvex,
  composeAffine,
  IDENTITY,
  insideConvex,
  Line,
  normalizeLine,
  polygonArea,
  reflectionAffine,
  reflectPoint,
  V2,
} from './geom.js';

export const PAPER_SIZE = 0.2;
export const GRID = 0.05;

export interface Facet {
  /** Convex CCW polygon in board space. */
  poly: V2[];
  /** Maps board space back to the original sheet (for texture lookup). */
  toSheet: Affine;
  /** True when the back of the sheet faces up. */
  flipped: boolean;
  /** Stacking order; higher draws on top. */
  layer: number;
}

export interface PaperState {
  facets: Facet[];
}

export type CreaseFamily = 'u' | 'v' | 'd' | 'a';

/**
 * A crease on the board lattice.
 *  u: u = k·GRID     v: v = k·GRID
 *  d: u − v = k·GRID a: u + v = k·GRID
 */
export interface Crease {
  f: CreaseFamily;
  k: number;
}

/** A fold: crease plus which side of it (relative to the normal) moves. */
export interface FoldSpec extends Crease {
  s: 1 | -1;
}

const MIN_AREA = 1e-6;

export function creaseLine(c: Crease): Line {
  const off = c.k * GRID;
  switch (c.f) {
    case 'u':
      return { nx: 1, ny: 0, d: off };
    case 'v':
      return { nx: 0, ny: 1, d: off };
    case 'd':
      return normalizeLine(1, -1, off);
    case 'a':
      return normalizeLine(1, 1, off);
  }
}

export function creaseId(c: Crease): string {
  return `${c.f}${c.k}`;
}

export function initialPaper(size = PAPER_SIZE): PaperState {
  const h = size / 2;
  return {
    facets: [
      {
        poly: [
          { x: -h, y: -h },
          { x: h, y: -h },
          { x: h, y: h },
          { x: -h, y: h },
        ],
        toSheet: IDENTITY,
        flipped: false,
        layer: 0,
      },
    ],
  };
}

export interface FoldParts {
  stay: Facet[];
  move: Facet[];
}

/** Splits the stack by a crease without folding (used for the live flap). */
export function splitPaper(
  state: PaperState,
  line: Line,
  movingSign: 1 | -1,
): FoldParts | null {
  const stay: Facet[] = [];
  const move: Facet[] = [];
  let stayArea = 0;
  let moveArea = 0;
  for (const f of state.facets) {
    const s = clipConvex(f.poly, line, (-movingSign) as 1 | -1);
    const m = clipConvex(f.poly, line, movingSign);
    const sa = s.length >= 3 ? polygonArea(s) : 0;
    const ma = m.length >= 3 ? polygonArea(m) : 0;
    if (sa > MIN_AREA * 0.01) {
      stay.push({ ...f, poly: s });
      stayArea += sa;
    }
    if (ma > MIN_AREA * 0.01) {
      move.push({ ...f, poly: m });
      moveArea += ma;
    }
  }
  if (stayArea < MIN_AREA || moveArea < MIN_AREA) return null;
  return { stay, move };
}

export function foldPaper(
  state: PaperState,
  line: Line,
  movingSign: 1 | -1,
): PaperState | null {
  const parts = splitPaper(state, line, movingSign);
  if (!parts) return null;
  const reflect = reflectionAffine(line);
  let maxLayer = 0;
  for (const f of state.facets) maxLayer = Math.max(maxLayer, f.layer);
  const moved = parts.move.map<Facet>((f) => ({
    poly: f.poly.map((p) => reflectPoint(line, p)).reverse(),
    toSheet: composeAffine(f.toSheet, reflect),
    flipped: !f.flipped,
    layer: maxLayer + 1 + (maxLayer - f.layer),
  }));
  return { facets: compactLayers([...parts.stay, ...moved]) };
}

export function applyFold(state: PaperState, spec: FoldSpec): PaperState | null {
  return foldPaper(state, creaseLine(spec), spec.s);
}

export function applyFolds(
  specs: readonly FoldSpec[],
  start: PaperState = initialPaper(),
): PaperState | null {
  let s: PaperState | null = start;
  for (const spec of specs) {
    if (!s) return null;
    s = applyFold(s, spec);
  }
  return s;
}

function compactLayers(facets: Facet[]): Facet[] {
  const layers = [...new Set(facets.map((f) => f.layer))].sort((a, b) => a - b);
  const remap = new Map(layers.map((l, i) => [l, i]));
  return facets.map((f) => ({ ...f, layer: remap.get(f.layer)! }));
}

/** Topmost facet covering point p, or null. */
export function topFacetAt(state: PaperState, p: V2, tol = 0): Facet | null {
  let best: Facet | null = null;
  for (const f of state.facets) {
    if ((best === null || f.layer > best.layer) && insideConvex(f.poly, p, tol)) {
      best = f;
    }
  }
  return best;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function paperBounds(state: PaperState): Bounds {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const f of state.facets) {
    for (const p of f.poly) {
      b.minX = Math.min(b.minX, p.x);
      b.minY = Math.min(b.minY, p.y);
      b.maxX = Math.max(b.maxX, p.x);
      b.maxY = Math.max(b.maxY, p.y);
    }
  }
  return b;
}

/** Board area that rasterisation and the target ghost cover. */
export const BOARD = { minX: -0.2, minY: -0.2, maxX: 0.2, maxY: 0.2 };
export const RASTER_W = 64;
export const RASTER_H = 64;

/**
 * What a player sees from above, cell by cell: 0 empty, 1 front, 2 back.
 * Sample points are nudged off the lattice so they never sit on a crease.
 */
export function rasterize(state: PaperState): Uint8Array {
  const out = new Uint8Array(RASTER_W * RASTER_H);
  const cw = (BOARD.maxX - BOARD.minX) / RASTER_W;
  const ch = (BOARD.maxY - BOARD.minY) / RASTER_H;
  const sorted = [...state.facets].sort((a, b) => b.layer - a.layer);
  for (let j = 0; j < RASTER_H; j++) {
    const y = BOARD.minY + (j + 0.5) * ch + 0.00037;
    for (let i = 0; i < RASTER_W; i++) {
      const x = BOARD.minX + (i + 0.5) * cw + 0.00071;
      for (const f of sorted) {
        if (insideConvex(f.poly, { x, y })) {
          out[j * RASTER_W + i] = f.flipped ? 2 : 1;
          break;
        }
      }
    }
  }
  return out;
}

/** Share of cells that agree, over the union of both images. */
export function rasterMatch(a: Uint8Array, b: Uint8Array): number {
  let union = 0;
  let same = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0 && b[i] === 0) continue;
    union++;
    if (a[i] === b[i]) same++;
  }
  return union === 0 ? 1 : same / union;
}

export function rasterKey(r: Uint8Array): string {
  let s = '';
  for (let i = 0; i < r.length; i++) s += r[i];
  return s;
}

/**
 * The goal as seen turned or mirrored any of the eight ways the square sheet
 * allows, each rasterised from geometry so ties on diagonal edges break the
 * same way as for the paper. A solve in any of them counts.
 */
export function symmetricTargets(state: PaperState): Uint8Array[] {
  const out: Uint8Array[] = [];
  const seen = new Set<string>();
  for (let t = 0; t < 8; t++) {
    const map = (p: V2): V2 => {
      let x = p.x;
      let y = p.y;
      if (t & 1) [x, y] = [y, x];
      if (t & 2) x = -x;
      if (t & 4) y = -y;
      return { x, y };
    };
    // An odd number of reflections reverses winding; keep polygons CCW.
    const odd = ((t & 1) + ((t >> 1) & 1) + ((t >> 2) & 1)) % 2 === 1;
    const facets = state.facets.map((f) => {
      const poly = f.poly.map(map);
      return { ...f, poly: odd ? poly.reverse() : poly };
    });
    const r = rasterize({ facets });
    const key = r.join('');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** Best match of `r` against any of `targets` (0..1, honest per cell). */
export function bestMatch(r: Uint8Array, targets: readonly Uint8Array[]): number {
  let best = 0;
  for (const t of targets) best = Math.max(best, rasterMatch(r, t));
  return best;
}

