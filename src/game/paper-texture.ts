/**
 * Washi-style paper textures drawn at runtime: a coloured front with a faint
 * printed motif, a warm white back, and the crease marks left by each fold.
 */

import { CanvasTexture, SRGBColorSpace } from '@iwsdk/core';
import type { V2 } from '../fold/geom.js';
import { PAPER_SIZE } from '../fold/paper.js';

export type Motif = 'waves' | 'dots' | 'stripes' | 'plain' | 'checks';

export interface PaperLook {
  front: string;
  motif: Motif;
  ink: string;
  back: string;
}

const SIZE = 512;

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function fibres(ctx: CanvasRenderingContext2D, seed: number, dark: boolean) {
  const r = rng(seed);
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = dark ? '#000' : '#fff';
  for (let i = 0; i < 260; i++) {
    const x = r() * SIZE;
    const y = r() * SIZE;
    const a = r() * Math.PI;
    const l = 6 + r() * 22;
    ctx.lineWidth = 0.6 + r() * 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(a) * l * 0.5 + (r() - 0.5) * 6,
      y + Math.sin(a) * l * 0.5 + (r() - 0.5) * 6,
      x + Math.cos(a) * l,
      y + Math.sin(a) * l,
    );
    ctx.stroke();
  }
  ctx.restore();
}

function motif(ctx: CanvasRenderingContext2D, m: Motif, ink: string) {
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.28;
  switch (m) {
    case 'waves': {
      // Seigaiha: overlapping arcs.
      ctx.lineWidth = 2.2;
      const r = 32;
      for (let row = -1; row < SIZE / (r / 2) + 2; row++) {
        const y = row * (r / 2);
        const off = row % 2 === 0 ? 0 : r;
        for (let x = -r + off; x < SIZE + r; x += r * 2) {
          for (const k of [1, 0.72, 0.44]) {
            ctx.beginPath();
            ctx.arc(x, y + r, r * k, Math.PI, 2 * Math.PI);
            ctx.stroke();
          }
        }
      }
      break;
    }
    case 'dots': {
      for (let y = 16; y < SIZE; y += 32) {
        for (let x = (y / 32) % 2 ? 32 : 16; x < SIZE; x += 32) {
          ctx.beginPath();
          ctx.arc(x, y, 4.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'stripes': {
      ctx.lineWidth = 7;
      for (let k = -SIZE; k < SIZE * 2; k += 28) {
        ctx.beginPath();
        ctx.moveTo(k, 0);
        ctx.lineTo(k + SIZE, SIZE);
        ctx.stroke();
      }
      break;
    }
    case 'checks': {
      ctx.globalAlpha = 0.16;
      for (let y = 0; y < SIZE; y += 32) {
        for (let x = (y / 32) % 2 ? 32 : 0; x < SIZE; x += 64) {
          ctx.fillRect(x, y, 32, 32);
        }
      }
      break;
    }
    case 'plain':
      break;
  }
  ctx.restore();
}

/** Converts sheet coordinates (metres, centred) to canvas pixels. */
function toPx(p: V2): [number, number] {
  return [
    (p.x / PAPER_SIZE + 0.5) * SIZE,
    (0.5 - p.y / PAPER_SIZE) * SIZE,
  ];
}

export class PaperTextures {
  readonly front: CanvasTexture;
  readonly back: CanvasTexture;
  private frontCanvas: HTMLCanvasElement;
  private backCanvas: HTMLCanvasElement;
  private highContrast = false;
  private creases: readonly [V2, V2][] = [];

  constructor(
    private look: PaperLook,
    private seed: number,
  ) {
    this.frontCanvas = document.createElement('canvas');
    this.backCanvas = document.createElement('canvas');
    this.frontCanvas.width = this.frontCanvas.height = SIZE;
    this.backCanvas.width = this.backCanvas.height = SIZE;
    this.front = new CanvasTexture(this.frontCanvas);
    this.back = new CanvasTexture(this.backCanvas);
    for (const t of [this.front, this.back]) {
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = 4;
    }
    this.redraw([]);
  }

  setLook(look: PaperLook, seed: number) {
    this.look = look;
    this.seed = seed;
  }

  setHighContrast(on: boolean) {
    if (this.highContrast === on) return;
    this.highContrast = on;
    this.redraw(this.creases);
  }

  /** Repaints both sides with the given crease segments (sheet space). */
  redraw(creases: readonly [V2, V2][]) {
    this.creases = creases;
    const f = this.frontCanvas.getContext('2d')!;
    f.fillStyle = this.look.front;
    f.fillRect(0, 0, SIZE, SIZE);
    motif(f, this.look.motif, this.look.ink);
    fibres(f, this.seed, true);
    // A thin border reads as the paper's cut edge.
    f.strokeStyle = 'rgba(255,255,255,0.35)';
    f.lineWidth = 4;
    f.strokeRect(2, 2, SIZE - 4, SIZE - 4);

    const b = this.backCanvas.getContext('2d')!;
    b.fillStyle = this.look.back;
    b.fillRect(0, 0, SIZE, SIZE);
    fibres(b, this.seed * 7 + 3, true);
    if (this.highContrast) {
      b.strokeStyle = '#3b3027';
      b.lineWidth = 5;
      for (let x = 0; x < SIZE * 2; x += 24) {
        b.beginPath();
        b.moveTo(x, 0);
        b.lineTo(x - SIZE, SIZE);
        b.stroke();
      }
    }
    b.strokeStyle = 'rgba(0,0,0,0.05)';
    b.lineWidth = 4;
    b.strokeRect(2, 2, SIZE - 4, SIZE - 4);

    for (const ctx of [f, b]) {
      for (const [p, q] of creases) {
        const [x0, y0] = toPx(p);
        const [x1, y1] = toPx(q);
        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(0,0,0,0.16)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x0 + 1.5, y0 + 1.5);
        ctx.lineTo(x1 + 1.5, y1 + 1.5);
        ctx.stroke();
        ctx.restore();
      }
    }
    this.front.needsUpdate = true;
    this.back.needsUpdate = true;
  }

  dispose() {
    this.front.dispose();
    this.back.dispose();
  }
}
