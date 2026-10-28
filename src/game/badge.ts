/**
 * A gold paper medallion that pops up over the mat when a badge is earned,
 * one at a time if several arrive together.
 */

import { CanvasTexture, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';
import { sfx } from './sfx.js';

const SHOW = 2.8;

export class BadgePop {
  readonly root = new Group();
  private canvas = document.createElement('canvas');
  private tex: CanvasTexture;
  private mat: MeshBasicMaterial;
  private queue: string[] = [];
  private t = -1;

  constructor() {
    this.root.name = 'BadgePop';
    this.canvas.width = 512;
    this.canvas.height = 256;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.mat = new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false });
    const m = new Mesh(new PlaneGeometry(0.22, 0.11), this.mat);
    m.renderOrder = 95;
    this.root.add(m);
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
    const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, 512, 256);
    g.fillStyle = 'rgba(246,239,226,0.97)';
    g.beginPath();
    g.roundRect(6, 30, 500, 196, 98);
    g.fill();
    // Gold medallion with a star.
    const grad = g.createRadialGradient(120, 128, 10, 120, 128, 86);
    grad.addColorStop(0, '#ffe08a');
    grad.addColorStop(1, '#d99a00');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(120, 128, 82, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff6d8';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 22 : 52;
      g.lineTo(120 + Math.cos(a) * r, 128 + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    g.textAlign = 'left';
    g.fillStyle = '#b0795a';
    g.font = '600 26px system-ui, -apple-system, Segoe UI, sans-serif';
    g.fillText('BADGE EARNED', 226, 108);
    g.fillStyle = '#2f4a45';
    g.font = '700 44px Georgia, "Times New Roman", serif';
    g.fillText(title, 226, 162);
    this.tex.needsUpdate = true;
    this.t = 0;
    this.root.visible = true;
    sfx.badge();
  }

  update(dt: number) {
    if (this.t < 0) return;
    this.t += dt;
    const k = Math.min(1, this.t / 0.35);
    const pop = this.t < 0.35 ? 1 + Math.sin(k * Math.PI) * 0.25 : 1;
    this.root.scale.setScalar(Math.max(0.01, k) * pop);
    this.mat.opacity = this.t > SHOW - 0.4 ? Math.max(0, (SHOW - this.t) / 0.4) : 1;
    if (this.t > SHOW) this.next();
  }
}
