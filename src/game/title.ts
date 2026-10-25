/**
 * The opening title: a paper card that unfolds in the air above the mat,
 * reads "Foldlings", then folds itself away. Shown once per session.
 */

import { CanvasTexture, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';
import { sfx } from './sfx.js';

const W = 0.34;
const H = 0.11;
const HOLD = 2.6;

function half(top: boolean): Mesh {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 332;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f6efe2';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#2f4a45';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '700 150px Georgia, "Times New Roman", serif';
  g.fillText('Foldlings', 512, 166);
  g.fillStyle = '#e2574c';
  // A small paper crane mark beside the word.
  g.beginPath();
  g.moveTo(96, 190);
  g.lineTo(160, 120);
  g.lineTo(150, 190);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(150, 190);
  g.lineTo(210, 170);
  g.lineTo(176, 214);
  g.closePath();
  g.fill();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  // Each half shows its own half of the card texture.
  t.repeat.set(1, 0.5);
  t.offset.set(0, top ? 0.5 : 0);
  const m = new Mesh(new PlaneGeometry(W, H / 2), new MeshBasicMaterial({ map: t, side: DoubleSide, transparent: true }));
  m.position.y = top ? H / 4 : -H / 4;
  return m;
}

export class TitleCard {
  readonly root = new Group();
  private top = new Group();
  private bottom = new Group();
  private t = -1;
  private beat = -1;

  constructor() {
    this.root.name = 'TitleCard';
    // The card is hinged along its middle crease, like a folded note.
    this.top.add(half(true));
    this.bottom.add(half(false));
    this.root.add(this.top, this.bottom);
    this.root.visible = false;
  }

  play() {
    this.t = 0;
    this.beat = -1;
    this.root.visible = true;
  }

  get playing(): boolean {
    return this.t >= 0;
  }

  stop() {
    this.t = -1;
    this.root.visible = false;
  }

  update(dt: number) {
    if (this.t < 0) return;
    this.t += dt;
    const t = this.t;
    const open = t < 0.7 ? 1 - Math.pow(1 - t / 0.7, 3) : t < 0.7 + HOLD ? 1 : Math.max(0, 1 - (t - 0.7 - HOLD) / 0.5);
    const beat = t < 0.35 ? 0 : t < 0.7 ? 1 : t < 0.7 + HOLD ? -1 : 2;
    if (beat >= 0 && beat !== this.beat) {
      this.beat = beat;
      sfx.foldBeat(beat + 1);
    }
    // Closed, the bottom half lies folded up against the top.
    this.bottom.rotation.x = (1 - open) * Math.PI;
    this.bottom.position.y = 0;
    this.top.position.y = 0;
    const m = this.root.children;
    for (const g of m) for (const c of g.children) ((c as Mesh).material as MeshBasicMaterial).opacity = Math.min(1, open * 1.5);
    this.root.position.y += Math.sin(t * 1.5) * 0.00008;
    if (t > 0.7 + HOLD + 0.5) {
      this.t = -1;
      this.root.visible = false;
    }
  }
}
