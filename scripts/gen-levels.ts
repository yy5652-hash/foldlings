/**
 * Offline puzzle search. Breadth-first over fold sequences, dedupes by the
 * picture a player sees, and records the fewest folds that reach it.
 *
 *   npx vite-node scripts/gen-levels.ts
 *
 * Writes .tmp/levels-*.png contact sheets and .tmp/candidates.json.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { CREASES } from '../src/fold/creases.js';
import { insideConvex } from '../src/fold/geom.js';
import {
  applyFold,
  BOARD,
  FoldSpec,
  initialPaper,
  PaperState,
  paperBounds,
} from '../src/fold/paper.js';

const N = 32;

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

const key = (r: Uint8Array) => Buffer.from(r).toString('base64');

interface Node {
  state: PaperState;
  folds: FoldSpec[];
  r: Uint8Array;
}

const moves: FoldSpec[] = [];
for (const c of CREASES) for (const s of [1, -1] as const) moves.push({ ...c, s });

const seen = new Map<string, Node>();
let frontier: Node[] = [];
const start = initialPaper();
const r0 = raster(start);
seen.set(key(r0), { state: start, folds: [], r: r0 });
frontier.push({ state: start, folds: [], r: r0 });

const MAX_DEPTH = Number(process.env.DEPTH ?? 3);
const byDepth: Node[][] = [[frontier[0]]];

function inBoard(s: PaperState): boolean {
  const b = paperBounds(s);
  return b.minX >= -0.2 + 1e-6 && b.maxX <= 0.2 - 1e-6 && b.minY >= -0.2 + 1e-6 && b.maxY <= 0.2 - 1e-6;
}

for (let depth = 1; depth <= MAX_DEPTH; depth++) {
  const next: Node[] = [];
  const t0 = Date.now();
  // Cap the frontier so the deepest level stays tractable.
  const cap = depth === MAX_DEPTH ? 4000 : Infinity;
  const src = frontier.length > cap ? frontier.filter((_, i) => i % Math.ceil(frontier.length / cap) === 0) : frontier;
  for (const n of src) {
    for (const m of moves) {
      const s = applyFold(n.state, m);
      if (!s || !inBoard(s)) continue;
      const r = raster(s);
      const k = key(r);
      if (seen.has(k)) continue;
      const node = { state: s, folds: [...n.folds, m], r };
      seen.set(k, node);
      next.push(node);
    }
  }
  byDepth.push(next);
  frontier = next;
  console.log(`depth ${depth}: ${next.length} new pictures (${Date.now() - t0} ms)`);
}

// ---- scoring: favour symmetric, compact, two-tone pictures.

function stats(r: Uint8Array) {
  let front = 0;
  let back = 0;
  let minI = N, maxI = 0, minJ = N, maxJ = 0;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const v = r[j * N + i];
      if (!v) continue;
      if (v === 1) front++;
      else back++;
      minI = Math.min(minI, i);
      maxI = Math.max(maxI, i);
      minJ = Math.min(minJ, j);
      maxJ = Math.max(maxJ, j);
    }
  const w = maxI - minI + 1;
  const h = maxJ - minJ + 1;
  // Mirror symmetry about the bounding box's vertical and horizontal axes.
  let symV = 0;
  let symH = 0;
  let total = 0;
  for (let j = minJ; j <= maxJ; j++)
    for (let i = minI; i <= maxI; i++) {
      const v = r[j * N + i];
      if (!v) continue;
      total++;
      if (r[j * N + (maxI - (i - minI))] === v) symV++;
      if (r[(maxJ - (j - minJ)) * N + i] === v) symH++;
    }
  const sym = total ? Math.max(symV, symH) / total : 0;
  const fill = total / (w * h);
  return { front, back, sym, fill, w, h, cells: total };
}

const out: object[] = [];
for (let d = 1; d <= MAX_DEPTH; d++) {
  for (const n of byDepth[d]) {
    const st = stats(n.r);
    const twoTone = Math.min(st.front, st.back) / Math.max(1, st.cells);
    const score = st.sym * 2 + twoTone * 1.5 + (st.fill > 0.45 ? 0.3 : 0) + (st.cells > 120 ? 0.3 : 0);
    out.push({ depth: d, folds: n.folds, score, ...st, raster: key(n.r) });
  }
}
mkdirSync('.tmp', { recursive: true });
writeFileSync('.tmp/candidates.json', JSON.stringify(out));

// ---- contact sheets (tiny PNG encoder, no dependencies)

function crc32(buf: Buffer): number {
  let c: number;
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function png(w: number, h: number, rgb: Uint8Array): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 3x5 digit font for labels.
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];

function sheet(items: { r: string; label: number }[], file: string) {
  const cols = 8;
  const cell = 4;
  const pad = 6;
  const tile = N * cell + pad * 2;
  const rows = Math.ceil(items.length / cols);
  const W = cols * tile;
  const H = rows * (tile + 10);
  const img = new Uint8Array(W * H * 3).fill(30);
  const set = (x: number, y: number, c: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 3;
    img[o] = c[0];
    img[o + 1] = c[1];
    img[o + 2] = c[2];
  };
  items.forEach((it, idx) => {
    const r = Buffer.from(it.r, 'base64');
    const ox = (idx % cols) * tile + pad;
    const oy = Math.floor(idx / cols) * (tile + 10) + pad;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const v = r[j * N + i];
        const c: [number, number, number] = v === 1 ? [226, 87, 76] : v === 2 ? [246, 240, 228] : [47, 74, 69];
        for (let yy = 0; yy < cell; yy++)
          for (let xx = 0; xx < cell; xx++) set(ox + i * cell + xx, oy + (N - 1 - j) * cell + yy, c);
      }
    const label = String(it.label);
    for (let d = 0; d < label.length; d++) {
      const g = DIGITS[Number(label[d])];
      for (let p = 0; p < 15; p++)
        if (g[p] === '1') {
          for (let s = 0; s < 2; s++)
            for (let t = 0; t < 2; t++) set(ox + d * 8 + (p % 3) * 2 + s, oy + N * cell + 2 + Math.floor(p / 3) * 2 + t, [255, 255, 255]);
        }
    }
  });
  writeFileSync(file, png(W, H, img));
}

const all = out as { depth: number; score: number; raster: string }[];
for (let d = 1; d <= MAX_DEPTH; d++) {
  const best = all
    .map((c, i) => ({ ...c, i }))
    .filter((c) => c.depth === d)
    .sort((a, b) => b.score - a.score)
    .slice(0, 48);
  sheet(best.map((b) => ({ r: b.raster, label: b.i })), `.tmp/levels-d${d}.png`);
}
console.log('candidates:', out.length);
