/**
 * The zoo album: every kind of creature on one paper page. Kinds you have
 * folded turn slowly in their paper; the rest wait as dark silhouettes. Opens
 * from the menu and stays where it opened.
 */

import {
  Box3,
  CanvasTexture,
  Group,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PokeInteractable,
  RayInteractable,
  SRGBColorSpace,
  Vector3,
  World,
} from '@iwsdk/core';
import { Button } from './button.js';
import { buildRig, CREATURE_KINDS } from './creature-models.js';
import type { CreatureKind } from './levels.js';
import { LOOKS } from './levels.js';
import { sfx } from './sfx.js';

export interface BadgeEntry {
  title: string;
  how: string;
  earned: boolean;
}

export interface AlbumEntry {
  kind: CreatureKind;
  /** Paper looks folded for this kind (indexes into LOOKS), most recent last. */
  looks: number[];
}

const W = 0.46;
const H = 0.3;
const COLS = 4;
const AUTO_CLOSE = 25;

export class Album {
  readonly panel = new Group();
  private canvas = document.createElement('canvas');
  private tex: CanvasTexture;
  private minis = new Group();
  private close: Button;
  private tab: Button;
  private page: 'zoo' | 'badges' = 'zoo';
  private entries: AlbumEntry[] = [];
  private streak = 0;
  private badges: BadgeEntry[] = [];
  private unfold = 0;
  private open = false;
  private idle = 0;
  private spin = 0;
  private head = new Vector3();
  private fwd = new Vector3();

  constructor(world: World) {
    this.panel.name = 'Album';
    this.canvas.width = 1024;
    this.canvas.height = Math.round((1024 * H) / W);
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    const page = new Mesh(new PlaneGeometry(W, H), new MeshBasicMaterial({ map: this.tex, transparent: true }));
    page.renderOrder = -5;
    this.panel.add(page, this.minis);
    const pe = world.createTransformEntity(this.panel);
    this.close = new Button('close', () => {
      sfx.click();
      this.hide();
    });
    this.close.root.name = 'AlbumClose';
    this.close.root.scale.setScalar(0.7);
    this.close.root.rotation.x = Math.PI / 2;
    this.close.root.position.set(W / 2 - 0.03, H / 2 - 0.03, 0.004);
    const ce = world.createTransformEntity(this.close.root, pe);
    ce.addComponent(RayInteractable);
    ce.addComponent(PokeInteractable);
    // Flips between the creatures and the badges.
    this.tab = new Button('next', () => {
      sfx.click();
      this.page = this.page === 'zoo' ? 'badges' : 'zoo';
      this.idle = 0;
      this.redraw();
    }, 'Badges');
    this.tab.root.name = 'AlbumTab';
    this.tab.root.scale.setScalar(0.7);
    this.tab.root.rotation.x = Math.PI / 2;
    this.tab.root.position.set(-W / 2 + 0.03, H / 2 - 0.03, 0.004);
    const te = world.createTransformEntity(this.tab.root, pe);
    te.addComponent(RayInteractable);
    te.addComponent(PokeInteractable);
    this.panel.visible = false;
    this.panel.position.set(0, -50, 0);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Opens the page in front of the player with the zoo as it is now. */
  show(
    entries: AlbumEntry[],
    streak: number,
    camera: { getWorldPosition(v: Vector3): Vector3; getWorldDirection(v: Vector3): Vector3 },
    badges: BadgeEntry[] = [],
  ) {
    this.entries = entries;
    this.streak = streak;
    this.badges = badges;
    this.page = 'zoo';
    this.buildMinis(entries);
    this.redraw();
    camera.getWorldPosition(this.head);
    camera.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-4) this.fwd.set(0, 0, -1);
    this.fwd.normalize();
    this.panel.position.copy(this.head).addScaledVector(this.fwd, 0.5);
    this.panel.position.y -= 0.12;
    this.panel.lookAt(this.head);
    this.panel.visible = true;
    this.open = true;
    this.idle = 0;
    sfx.pick();
  }

  hide() {
    this.open = false;
  }

  private cell(i: number): { x: number; y: number; w: number; h: number } {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    return { x: 40 + col * 240, y: 118 + row * 270, w: 224, h: 254 };
  }

  private redraw() {
    this.minis.visible = this.page === 'zoo';
    this.tab.setLabel(this.page === 'zoo' ? 'Badges' : 'Zoo');
    if (this.page === 'zoo') this.draw(this.entries, this.streak);
    else this.drawBadges();
  }

  /** Twelve badges: gold when earned, grey with how to earn them otherwise. */
  private drawBadges() {
    const c = this.canvas;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(246,239,226,0.97)';
    g.beginPath();
    g.roundRect(4, 4, c.width - 8, c.height - 8, 36);
    g.fill();
    const got = this.badges.filter((b) => b.earned).length;
    g.textAlign = 'center';
    g.fillStyle = '#2f4a45';
    g.font = '700 50px Georgia, "Times New Roman", serif';
    g.fillText('Badges', c.width / 2, 70);
    g.fillStyle = '#b0795a';
    g.font = '600 28px system-ui, -apple-system, Segoe UI, sans-serif';
    g.fillText(`${got} of ${this.badges.length} earned`, c.width / 2, 106);
    this.badges.forEach((b, i) => {
      const x = 40 + (i % 4) * 240;
      const y = 132 + Math.floor(i / 4) * 175;
      g.fillStyle = b.earned ? 'rgba(255,209,102,0.22)' : 'rgba(47,74,69,0.05)';
      g.beginPath();
      g.roundRect(x, y, 224, 162, 20);
      g.fill();
      const grad = g.createRadialGradient(x + 112, y + 52, 4, x + 112, y + 52, 36);
      grad.addColorStop(0, b.earned ? '#ffe08a' : '#d9d2c5');
      grad.addColorStop(1, b.earned ? '#d99a00' : '#b3a898');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x + 112, y + 52, 34, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = b.earned ? '#3b3027' : '#9a8f80';
      g.font = '700 26px system-ui, -apple-system, Segoe UI, sans-serif';
      g.fillText(b.title, x + 112, y + 118);
      g.fillStyle = '#8a7a6a';
      g.font = '500 17px system-ui, -apple-system, Segoe UI, sans-serif';
      g.fillText(b.how, x + 112, y + 146, 212);
    });
    this.tex.needsUpdate = true;
  }

  private draw(entries: AlbumEntry[], streak: number) {
    const c = this.canvas;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(246,239,226,0.97)';
    g.beginPath();
    g.roundRect(4, 4, c.width - 8, c.height - 8, 36);
    g.fill();
    const kinds = entries.filter((e) => e.looks.length > 0).length;
    const folded = entries.reduce((n, e) => n + e.looks.length, 0);
    g.fillStyle = '#2f4a45';
    g.font = '700 54px Georgia, "Times New Roman", serif';
    g.textAlign = 'left';
    g.fillText('Paper zoo', 44, 78);
    g.fillStyle = '#8a7a6a';
    g.font = '500 28px system-ui, -apple-system, Segoe UI, sans-serif';
    const line = `${kinds} of ${CREATURE_KINDS.length} kinds · ${folded} folded` + (streak > 0 ? ` · ${streak}-day streak` : '');
    g.fillText(line, 330, 76);
    entries.forEach((e, i) => {
      const r = this.cell(i);
      const have = e.looks.length > 0;
      g.fillStyle = have ? 'rgba(47,74,69,0.08)' : 'rgba(47,74,69,0.04)';
      g.beginPath();
      g.roundRect(r.x, r.y, r.w, r.h, 22);
      g.fill();
      g.textAlign = 'center';
      g.fillStyle = have ? '#3b3027' : '#b3a898';
      g.font = '600 32px system-ui, -apple-system, Segoe UI, sans-serif';
      const name = e.kind[0].toUpperCase() + e.kind.slice(1);
      g.fillText(have ? name : '? ? ?', r.x + r.w / 2, r.y + r.h - 54);
      g.font = '500 24px system-ui, -apple-system, Segoe UI, sans-serif';
      g.fillStyle = '#8a7a6a';
      if (!have) {
        g.fillText('not folded yet', r.x + r.w / 2, r.y + r.h - 20);
        return;
      }
      // One swatch per paper colour folded, then the count.
      const colours = [...new Set(e.looks)].slice(-5);
      const x0 = r.x + r.w / 2 - (colours.length * 26) / 2 - 22;
      colours.forEach((look, k) => {
        g.fillStyle = LOOKS[look % LOOKS.length].front;
        g.beginPath();
        g.arc(x0 + k * 26 + 13, r.y + r.h - 28, 10, 0, Math.PI * 2);
        g.fill();
      });
      g.fillStyle = '#8a7a6a';
      g.textAlign = 'left';
      g.fillText(`×${e.looks.length}`, x0 + colours.length * 26 + 8, r.y + r.h - 19);
    });
    this.tex.needsUpdate = true;
  }

  private buildMinis(entries: AlbumEntry[]) {
    for (const child of [...this.minis.children]) {
      this.minis.remove(child);
      child.traverse((o) => {
        if ((o as Mesh).isMesh && o.name === 'Paper') (o as Mesh).geometry.dispose();
        if ((o as LineSegments).isLineSegments) {
          (o as LineSegments).geometry.dispose();
          ((o as LineSegments).material as MeshBasicMaterial).dispose();
        }
      });
    }
    entries.forEach((e, i) => {
      const have = e.looks.length > 0;
      const look = have ? LOOKS[e.looks[e.looks.length - 1] % LOOKS.length] : null;
      const rig = buildRig(e.kind, look?.front ?? '#25302d', look?.back ?? '#25302d');
      if (!have) rig.lines.opacity = 0;
      const root = rig.root;
      const size = new Box3().setFromObject(root).getSize(new Vector3());
      root.scale.setScalar(0.07 / Math.max(size.x, size.y, size.z));
      const holder = new Group();
      const r = this.cell(i);
      holder.position.set(
        ((r.x + r.w / 2) / this.canvas.width - 0.5) * W,
        (0.5 - (r.y + 96) / this.canvas.height) * H - 0.02,
        0.03,
      );
      holder.rotation.x = 0.35;
      holder.add(root);
      this.minis.add(holder);
    });
  }

  update(dt: number) {
    this.unfold += ((this.open ? 1 : 0) - this.unfold) * Math.min(1, dt * 10);
    this.panel.scale.set(1, Math.max(0.02, this.unfold), 1);
    if (this.open) {
      this.idle += dt;
      if (this.idle > AUTO_CLOSE) this.hide();
      this.spin += dt * 0.7;
      for (const m of this.minis.children) m.children[0].rotation.y = this.spin;
    } else if (this.unfold < 0.03 && this.panel.visible) {
      this.panel.visible = false;
      this.panel.position.set(0, -50, 0);
    }
    this.close.update(dt);
    this.tab.update(dt);
  }
}
