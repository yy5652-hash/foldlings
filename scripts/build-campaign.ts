/**
 * Picks the 80-level campaign from the offline puzzle search.
 *
 *   npx vite-node scripts/gen-levels.ts   (writes .tmp/candidates.json)
 *   npx vite-node scripts/build-campaign.ts
 *
 * Eight worlds of ten, one per creature, along a difficulty curve. Pictures
 * that are rotations or mirror images of each other, or of a daily puzzle,
 * are never used twice. The twelve original levels keep their ids and slots
 * so saved progress carries over. Writes src/game/campaign.ts.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { insideConvex } from '../src/fold/geom.js';
import { applyFolds, BOARD, FoldSpec, PaperState } from '../src/fold/paper.js';
import { DAILY_FOLDS } from '../src/game/daily.js';
import { parseFolds } from '../src/game/levels.js';

const N = 32;

/** Same 32×32 picture as the search uses (0 empty, 1 front, 2 back). */
function raster(s: PaperState): Uint8Array {
  const out = new Uint8Array(N * N);
  const cw = (BOARD.maxX - BOARD.minX) / N;
  const sorted = [...s.facets].sort((a, b) => b.layer - a.layer);
  for (let j = 0; j < N; j++) {
    const y = BOARD.minY + (j + 0.5) * cw + 0.00037;
    for (let i = 0; i < N; i++) {
      const x = BOARD.minX + (i + 0.5) * cw + 0.00071;
      for (const f of sorted) {
        if (insideConvex(f.poly, { x, y })) {
          out[j * N + i] = f.flipped ? 2 : 1;
          break;
        }
      }
    }
  }
  return out;
}

const b64 = (r: Uint8Array) => Buffer.from(r).toString('base64');
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

/** The same picture turned or mirrored any of eight ways, as one key. */
function canonical(r: Uint8Array): { key: string; r: Uint8Array } {
  let best: Uint8Array | null = null;
  let bestKey = '';
  for (let t = 0; t < 8; t++) {
    const o = new Uint8Array(N * N);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        let x = i;
        let y = j;
        if (t & 1) [x, y] = [y, x];
        if (t & 2) x = N - 1 - x;
        if (t & 4) y = N - 1 - y;
        o[y * N + x] = r[j * N + i];
      }
    const k = b64(o);
    if (!best || k < bestKey) {
      best = o;
      bestKey = k;
    }
  }
  return { key: bestKey, r: best! };
}

function distance(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    if (!a[i] && !b[i]) continue;
    n++;
    if (a[i] !== b[i]) d++;
  }
  return n ? d / n : 0;
}

const enc = (f: FoldSpec) => `${f.f}${f.k}${f.s > 0 ? '+' : '-'}`;

/** Folds per slot for each world: gentle start, a four-fold master at the end. */
const CURVE = [
  [1, 1, 1, 2, 2, 2, 2, 2, 3, 3],
  [1, 1, 2, 2, 2, 2, 3, 3, 3, 3],
  [2, 2, 2, 2, 3, 3, 3, 3, 3, 3],
  [2, 2, 3, 3, 3, 3, 3, 3, 4, 4],
  [2, 3, 3, 3, 3, 3, 4, 4, 4, 4],
  [3, 3, 3, 3, 4, 4, 4, 4, 4, 4],
  [3, 3, 4, 4, 4, 4, 4, 4, 4, 4],
  [3, 4, 4, 4, 4, 4, 4, 4, 4, 4],
];

/** The original twelve: [id, folds, world, slot]. */
const KEEP: [string, string, number, number][] = [
  ['crane', 'a0+', 0, 0],
  ['frog', 'v0+', 1, 0],
  ['boat', 'd-2- a2+', 2, 0],
  ['fish', 'd-2- a-2-', 3, 0],
  ['fox', 'd2+ a-2-', 4, 0],
  ['butterfly', 'd-2- a-2- u0-', 5, 0],
  ['rabbit', 'd-2- a2+ v0+', 6, 0],
  ['whale', 'd-2- d3+ a-2-', 7, 0],
  ['crane-2', 'd2+ a-2- v0-', 0, 9],
  ['frog-2', 'v-1- d-3- a3+', 1, 9],
  ['fox-2', 'd2+ a-2- a3+ d-3-', 4, 9],
  ['whale-2', 'd-2- a-2- a3+ d3+', 7, 9],
];

interface Cand {
  depth: number;
  folds: FoldSpec[];
  score: number;
  raster: string;
  cells: number;
  fill: number;
}

/**
 * Pictures worth a level: big enough to read at arm's length (a third of the
 * sheet at least), and favouring slanted outlines over plain rectangles.
 */
const interest = (c: Cand) => c.score + (c.fill < 0.9 ? 0.7 : 0) + Math.min(c.cells, 200) / 200;
const cands = JSON.parse(readFileSync('.tmp/candidates.json', 'utf8')) as Cand[];
const minDepth = new Map<string, number>();
for (const c of cands) {
  const k = canonical(unb64(c.raster)).key;
  minDepth.set(k, Math.min(minDepth.get(k) ?? 99, c.depth));
}

const used = new Set<string>();
for (const d of DAILY_FOLDS) {
  const s = applyFolds(parseFolds(d));
  if (s) used.add(canonical(raster(s)).key);
}

interface Pick {
  id: string;
  world: number;
  slot: number;
  folds: string;
  par: number;
  r: Uint8Array;
}
const picks: Pick[] = [];
/** Original ids whose picture mirrors an earlier one: same id, new picture. */
const renamed = new Map<string, string>();
for (const [id, folds, world, slot] of KEEP) {
  const s = applyFolds(parseFolds(folds));
  if (!s) throw new Error(`${id} does not fold`);
  const c = canonical(raster(s));
  if (used.has(c.key)) {
    renamed.set(`${world}:${slot}`, id);
    continue;
  }
  used.add(c.key);
  picks.push({ id, world, slot, folds, par: minDepth.get(c.key) ?? parseFolds(folds).length, r: c.r });
}

const byDepth = new Map<number, Cand[]>();
for (const c of [...cands].filter((c) => c.cells >= 80).sort((a, b) => interest(b) - interest(a))) {
  if (!byDepth.has(c.depth)) byDepth.set(c.depth, []);
  byDepth.get(c.depth)!.push(c);
}

for (let w = 0; w < CURVE.length; w++) {
  for (let slot = 0; slot < 10; slot++) {
    if (picks.some((p) => p.world === w && p.slot === slot)) continue;
    const depth = CURVE[w][slot];
    const mine = picks.filter((p) => p.world === w);
    let chosen: Pick | null = null;
    for (const c of byDepth.get(depth) ?? []) {
      const cr = canonical(unb64(c.raster));
      if (used.has(cr.key)) continue;
      // Not a near-copy of another picture in the same world.
      if (mine.some((p) => distance(p.r, cr.r) < 0.2)) continue;
      chosen = { id: renamed.get(`${w}:${slot}`) ?? `w${w + 1}-${slot + 1}`, world: w, slot, folds: c.folds.map(enc).join(' '), par: depth, r: cr.r };
      used.add(cr.key);
      break;
    }
    if (!chosen) throw new Error(`no picture left for world ${w + 1} slot ${slot + 1}`);
    picks.push(chosen);
  }
}

picks.sort((a, b) => a.world - b.world || a.slot - b.slot);
const lines = picks.map((p) => `  ['${p.id}', ${p.world}, '${p.folds}', ${p.par}],`);
writeFileSync(
  'src/game/campaign.ts',
  `/**
 * The campaign: eight worlds of ten levels, [id, world, folds, par].
 * Generated by scripts/build-campaign.ts from the offline puzzle search;
 * \`par\` is the fewest folds that make the picture.
 */

export const CAMPAIGN: readonly [string, number, string, number][] = [
${lines.join('\n')}
];
`,
);
console.log(`wrote ${picks.length} levels; par counts:`, [1, 2, 3, 4].map((d) => picks.filter((p) => p.par === d).length));
