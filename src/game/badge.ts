/**
 * A glass notification that floats up over the mat when a badge is earned, one
 * at a time if several arrive together.
 */

import { CanvasTexture, Group } from '@iwsdk/core';
import { contentTexture, drawIcon, follow, INK, LAYER, setFont, Surface, WINDOW_GLASS } from './glass.js';
import { sfx } from './sfx.js';

const SHOW = 3;
const W = 0.2;
const H = 0.052;

export class BadgePop {
  readonly root = new Group();
  private canvas = document.createElement('canvas');
  private tex: CanvasTexture;
  private surface: Surface;
  private queue: string[] = [];
  private t = -1;
  private k = 0;

  constructor() {
    this.root.name = 'BadgePop';
    this.canvas.width = 800;
    this.canvas.height = Math.round((800 * H) / W);
    this.tex = contentTexture(this.canvas);
    this.surface = new Surface({
      w: W,
      h: H,
      ...WINDOW_GLASS,
      shadow: 0.36,
      soft: 0.024,
      drop: 0.008,
      map: this.tex,
      order: LAYER.overlay,
    });
    this.root.add(this.surface.mesh);
    this.root.visible = false;
  }

  /** Queues a badge; `title` is its name. */
  show(title: string) {
    this.queue.push(title);
    if (this.t < 0) this.next();
  }

  private next() {
    const title = this.queue.shift();
    if (!title) {
      this.t = -1;
      this.root.visible = false;
      return;
    }
    const c = this.canvas;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    const cy = c.height / 2;
    const grad = g.createRadialGradient(cy, cy, 4, cy, cy, cy * 0.8);
    grad.addColorStop(0, 'rgba(255,209,102,0.6)');
    grad.addColorStop(1, 'rgba(255,209,102,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, cy * 2, c.height);
    drawIcon(g, 'star', cy, cy, 74, INK.gold, 1.6, true);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = INK.secondary;
    setFont(g, 30, 500);
    g.fillText('Badge earned', cy * 2 - 10, cy - 28);
    g.fillStyle = INK.primary;
    setFont(g, 46, 700, -0.4);
    g.fillText(title, cy * 2 - 10, cy + 20, c.width - cy * 2 - 20);
    this.tex.needsUpdate = true;
    this.t = 0;
    this.k = 0;
    this.root.visible = true;
    sfx.badge();
  }

  update(dt: number) {
    if (this.t < 0) return;
    this.t += dt;
    const leaving = this.t > SHOW - 0.3;
    this.k = follow(this.k, leaving ? 0 : 1, leaving ? 18 : 9, dt);
    this.root.scale.setScalar(0.94 + 0.06 * this.k);
    this.surface.mesh.position.y = (1 - this.k) * -0.012;
    this.surface.fade = this.k * this.k;
    if (this.t > SHOW) this.next();
  }
}
