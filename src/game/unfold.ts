import { composeAffine, reflectPoint, reflectionAffine } from '../fold/geom.js';
import { Crease, creaseLine, FoldSpec, PaperState, rasterize, splitPaper, topFacetAt } from '../fold/paper.js';
import type { V2 } from '../fold/geom.js';

export function isUndo(snap: Crease, last: Crease | undefined, result: PaperState | null, previous: PaperState | undefined): boolean {
  if (!last || !previous || !result || snap.f !== last.f || snap.k !== last.k) return false;
  const a = rasterize(result);
  const b = rasterize(previous);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Reverse only the flap added by the last fold, leaving the stack beneath it. */
export function unfoldFlap(paper: PaperState, previous: PaperState | undefined, last: FoldSpec | undefined, point: V2) {
  if (!last || !previous) return null;
  const line = creaseLine(last);
  const parts = splitPaper(previous, line, last.s);
  if (!parts || paper.facets.length !== parts.stay.length + parts.move.length) return null;
  const stay = paper.facets.slice(0, parts.stay.length);
  const move = paper.facets.slice(parts.stay.length);
  const top = topFacetAt(paper, point);
  if (!top || !move.includes(top)) return null;
  const reflection = reflectionAffine(line);
  const result = { facets: [...stay, ...move.map((f) => ({
    ...f,
    poly: f.poly.map((p) => reflectPoint(line, p)).reverse(),
    toSheet: composeAffine(f.toSheet, reflection),
    flipped: !f.flipped,
  }))] };
  if (!isUndo(last, last, result, previous)) return null;
  return { stay, move, result, line, error: 0, f: last.f, k: last.k, s: -last.s as 1 | -1 };
}
