/**
 * The card that rises over the mat after a solve: stars pop in one by one,
 * folds against par, a "Perfect" stamp, and Next / Retry / Levels tokens.
 * With no answer it moves on by itself, so play keeps flowing.
 */

import {
  CanvasTexture,
  Color,
  Entity,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PokeInteractable,
  RayInteractable,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  World,
} from '@iwsdk/core';
import { Button } from './button.js';
import type { Best, Result } from './score.js';
import { sfx } from './sfx.js';

export type ResultAction = 'next' | 'retry' | 'levels';

const W = 0.3;
const H = 0.17;
const AUTO_NEXT = 8;
const GOLD = new Color(0xffc53d);
const DIM = new Color(0x55625e);

function starGeometry(r: number): ShapeGeometry {
  const s = new Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  s.closePath();
  return new ShapeGeometry(s);
}

export class ResultCard {
  readonly root = new Group();
  private canvas = document.createElement('canvas');
  private tex: CanvasTexture;
  private stars: Mesh[] = [];
  private buttons: Button[] = [];
  private t = -1;
  private earned = 0;
  private popped = 0;
  private perfect = false;
  private title = '';
  private sub = '';
  private line = '';
  private bestLine = '';
  /** A gold line for a world completed or opened ("" for none). */
  private banner = '';
  private shownSecond = -1;

  constructor(world: World, parent: Entity, private onAction: (a: ResultAction) => void) {
    this.root.name = 'ResultCard';
    this.canvas.width = 1024;
    this.canvas.height = Math.round((1024 * H) / W);
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    const card = new Mesh(new PlaneGeometry(W, H), new MeshBasicMaterial({ map: this.tex, transparent: true }));
    card.renderOrder = -5;
    this.root.add(card);
    const geo = starGeometry(0.021);
    for (let i = 0; i < 3; i++) {
      const m = new Mesh(geo, new MeshBasicMaterial({ color: DIM.clone() }));
      m.position.set((i - 1) * 0.052, H / 2 - 0.045, 0.002);
      this.stars.push(m);
      this.root.add(m);
    }
    const re = world.createTransformEntity(this.root, parent);
    const tokens: [ResultAction, 'next' | 'restart' | 'levels', string][] = [
      ['retry', 'restart', 'Retry'],
      ['next', 'next', 'Next'],
      ['levels', 'levels', 'Levels'],
    ];
    tokens.forEach(([action, icon, label], i) => {
      const b = new Button(icon, () => this.fire(action), label);
      b.root.name = `Result_${action}`;
      b.root.rotation.x = Math.PI / 2;
      b.root.position.set((i - 1) * 0.095, -H / 2 - 0.045, 0.004);
      if (action === 'next') b.root.scale.setScalar(1.25);
      const e = world.createTransformEntity(b.root, re);
      e.addComponent(RayInteractable);
      e.addComponent(PokeInteractable);
      this.buttons.push(b);
    });
    this.hide();
  }

  get showing(): boolean {
    return this.t >= 0;
  }

  show(title: string, sub: string, r: Result, best: Best | undefined, banner = '') {
    this.title = title;
    this.sub = sub;
    this.banner = banner;
    this.line = `Folds ${r.folds}  ·  Par ${r.par}` + (r.hinted ? '  ·  hint used' : '');
    this.bestLine = best ? `Best ${'★'.repeat(best.stars)}${'☆'.repeat(3 - best.stars)}` : '';
    this.earned = r.stars;
    this.perfect = r.perfect;
    this.popped = 0;
    this.shownSecond = -1;
    for (const s of this.stars) {
      (s.material as MeshBasicMaterial).color.copy(DIM);
      s.scale.setScalar(1);
    }
    this.root.position.set(0, 0.2, -0.05);
    this.root.rotation.set(-0.3, 0, 0);
    this.root.visible = true;
    this.t = 0;
    this.draw(AUTO_NEXT);
  }

  hide() {
    this.t = -1;
    this.root.visible = false;
    // Parked far below so hidden tokens never catch a ray.
    this.root.position.set(0, -50, 0);
  }

  private fire(action: ResultAction) {
    if (this.t < 0.6) return;
    sfx.click();
    this.hide();
    this.onAction(action);
  }

  private draw(secondsLeft: number) {
    const c = this.canvas;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(246,239,226,0.97)';
    g.beginPath();
    g.roundRect(4, 4, c.width - 8, c.height - 8, 40);
    g.fill();
    g.textAlign = 'center';
    g.fillStyle = '#2f4a45';
    g.font = '700 64px Georgia, "Times New Roman", serif';
    g.fillText(this.title, 512, 268);
    if (this.banner) {
      g.fillStyle = '#d38a00';
      g.font = '700 36px system-ui, -apple-system, Segoe UI, sans-serif';
      g.fillText(this.banner, 512, 320);
    } else {
      g.fillStyle = '#8a7a6a';
      g.font = '500 34px system-ui, -apple-system, Segoe UI, sans-serif';
      g.fillText(this.sub, 512, 318);
    }
    g.fillStyle = '#3b3027';
    g.font = '600 40px system-ui, -apple-system, Segoe UI, sans-serif';
    g.fillText(this.line, 512, 386);
    g.fillStyle = '#b0795a';
    g.font = '600 30px system-ui, -apple-system, Segoe UI, sans-serif';
    g.fillText(this.bestLine + (secondsLeft > 0 ? `   ·   next in ${secondsLeft}` : ''), 512, 446);
    if (this.perfect && this.popped >= 3) {
      // A slanted red stamp.
      g.save();
      g.translate(880, 150);
      g.rotate(-0.2);
      g.strokeStyle = '#d6453b';
      g.fillStyle = '#d6453b';
      g.lineWidth = 6;
      g.strokeRect(-118, -38, 236, 76);
      g.font = '800 46px system-ui, -apple-system, Segoe UI, sans-serif';
      g.fillText('PERFECT', 0, 17);
      g.restore();
    }
    this.tex.needsUpdate = true;
  }

  update(dt: number) {
    for (const b of this.buttons) b.update(dt);
    if (this.t < 0) return;
    this.t += dt;
    // Stars pop in one by one, each with its own note.
    const due = Math.min(this.earned, Math.floor((this.t - 0.25) / 0.35) + 1);
    while (this.popped < due) {
      const s = this.stars[this.popped];
      (s.material as MeshBasicMaterial).color.copy(GOLD);
      sfx.star(this.popped);
      this.popped++;
      if (this.popped === 3 && this.perfect) {
        sfx.perfect();
        this.draw(Math.ceil(AUTO_NEXT - this.t));
      }
    }
    for (let i = 0; i < this.popped; i++) {
      const age = this.t - 0.25 - i * 0.35;
      const k = Math.min(1, age / 0.3);
      this.stars[i].scale.setScalar(1 + Math.sin(k * Math.PI) * 0.45);
    }
    const left = Math.ceil(AUTO_NEXT - this.t);
    if (left !== this.shownSecond) {
      this.shownSecond = left;
      this.draw(left);
    }
    if (this.t > AUTO_NEXT) {
      this.hide();
      this.onAction('next');
    }
  }
}
