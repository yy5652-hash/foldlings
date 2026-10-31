/**
 * The zoo album: every kind of creature on a glass window. Kinds you have
 * folded turn slowly in their paper; the rest wait as dark silhouettes. Opens
 * from the menu and stays where it opened.
 */

import { Box3, Group, LineSegments, Mesh, MeshBasicMaterial, Vector3, World } from '@iwsdk/core';
import { Button } from './button.js';
import { buildRig, CREATURE_KINDS } from './creature-models.js';
import { drawIcon, GlassWindow, INK, LAYER, setFont } from './glass.js';
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
const PX = 1024;
const PAD = 44;
const COLS = 4;
const AUTO_CLOSE = 25;

export class Album {
  private win: GlassWindow;
  private minis = new Group();
  private page: 'zoo' | 'badges' = 'zoo';
  private entries: AlbumEntry[] = [];
  private streak = 0;
  private badges: BadgeEntry[] = [];
  private spin = 0;

  constructor(world: World) {
    this.win = new GlassWindow(world, { name: 'Album', w: W, h: H, px: PX, r: 0.03, autoClose: AUTO_CLOSE });
    this.win.content.add(this.minis);
    const close = new Button('close', () => {
      if (!this.win.ready) return;
      sfx.click();
      this.hide();
    }, '', { r: 0.015 });
    close.root.name = 'AlbumClose';
    close.root.position.set(0, -H / 2 - 0.024, 0.006);
    close.root.rotation.x = Math.PI / 2;
    this.win.addControl(close.root, close);
  }

  get panel() {
    return this.win.root;
  }

  get isOpen(): boolean {
    return this.win.isOpen;
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
    // Keep the caller's API; the shared window places itself using world.camera.
    void camera;
    this.win.open(0.5, 0.11);
    sfx.pick();
  }

  hide() {
    this.win.close();
  }

  private cell(i: number): { x: number; y: number; w: number; h: number } {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    return { x: PAD + col * 238, y: 170 + row * 230, w: 222, h: 222 };
  }

  private redraw() {
    this.win.clearHits();
    this.minis.visible = this.page === 'zoo';
    const g = this.win.clear();
    this.header(g);
    if (this.page === 'zoo') this.draw(g, this.entries, this.streak);
    else this.drawBadges(g);
    this.win.commit();
  }

  private header(g: CanvasRenderingContext2D) {
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = INK.primary;
    setFont(g, 52, 700, -0.8);
    g.fillText(this.page === 'zoo' ? 'Paper zoo' : 'Badges', PAD, 77, 280);

    // Two large pill targets share one track centred in the title row.
    const x = (PX - 320) / 2;
    const y = 32;
    const h = 90;
    g.fillStyle = 'rgba(255,255,255,0.09)';
    g.beginPath();
    g.roundRect(x, y, 320, h, h / 2);
    g.fill();
    const pages = ['zoo', 'badges'] as const;
    pages.forEach((page, i) => {
      const sx = x + i * 160;
      const active = page === this.page;
      if (active) {
        g.fillStyle = 'rgba(255,255,255,0.2)';
        g.beginPath();
        g.roundRect(sx + 4, y + 4, 152, h - 8, (h - 8) / 2);
        g.fill();
      }
      g.textAlign = 'center';
      g.fillStyle = active ? INK.primary : INK.secondary;
      setFont(g, 30, 600);
      g.fillText(page === 'zoo' ? 'Zoo' : 'Badges', sx + 80, y + h / 2, 136);
      this.win.addHit(sx, y, 160, h, h / 2, () => {
        if (this.page === page) return;
        sfx.click();
        this.page = page;
        this.redraw();
      }, `Album_${page}`);
    });

    const count = this.page === 'zoo'
      ? this.entries.filter((e) => e.looks.length > 0).length
      : this.badges.filter((b) => b.earned).length;
    const total = this.page === 'zoo' ? CREATURE_KINDS.length : this.badges.length;
    const text = `${count} of ${total}`;
    g.textAlign = 'right';
    g.fillStyle = INK.secondary;
    setFont(g, 24, 500);
    g.fillText(text, PX - PAD, 77);
    drawIcon(g, 'star', PX - PAD - g.measureText(text).width - 24, 77, 26, INK.secondary);
  }

  /** Twelve badges: earned gold stars and quiet outlines for the rest. */
  private drawBadges(g: CanvasRenderingContext2D) {
    g.textAlign = 'left';
    g.fillStyle = INK.secondary;
    setFont(g, 24, 400);
    g.fillText('Little milestones, one fold at a time', PAD, 143, PX - PAD * 2);
    this.badges.forEach((b, i) => {
      const x = PAD + (i % COLS) * 238;
      const y = 170 + Math.floor(i / COLS) * 154;
      const w = 222;
      const cx = x + w / 2;
      g.fillStyle = INK.section;
      g.beginPath();
      g.roundRect(x, y, w, 148, 28);
      g.fill();
      if (b.earned) {
        const grad = g.createRadialGradient(cx, y + 28, 0, cx, y + 28, 28);
        grad.addColorStop(0, 'rgba(255,209,102,0.55)');
        grad.addColorStop(1, 'rgba(255,209,102,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(cx, y + 28, 28, 0, Math.PI * 2);
        g.fill();
      }
      drawIcon(g, 'star', cx, y + 28, 36, b.earned ? INK.gold : INK.tertiary, 1.6, b.earned);
      g.textAlign = 'center';
      g.fillStyle = b.earned ? INK.primary : INK.secondary;
      setFont(g, 30, 600);
      g.fillText(b.title, cx, y + 65, w - 24);
      g.fillStyle = INK.secondary;
      setFont(g, 21, 400);
      // Up to three lines keep the instructions readable without tiny type.
      const lines: string[] = [];
      let line = '';
      for (const word of b.how.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (line && lines.length < 2 && g.measureText(next).width > w - 24) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      lines.push(line);
      lines.forEach((text, row) => g.fillText(text, cx, y + 88 + row * 22, w - 24));
    });
  }

  private draw(g: CanvasRenderingContext2D, entries: AlbumEntry[], streak: number) {
    const kinds = entries.filter((e) => e.looks.length > 0).length;
    const folded = entries.reduce((n, e) => n + e.looks.length, 0);
    g.textAlign = 'left';
    g.fillStyle = INK.secondary;
    setFont(g, 24, 400);
    const line = `${kinds} of ${CREATURE_KINDS.length} kinds · ${folded} folded` + (streak > 0 ? ` · ${streak}-day streak` : '');
    g.fillText(line, PAD, 143, PX - PAD * 2);
    entries.forEach((e, i) => {
      const r = this.cell(i);
      const have = e.looks.length > 0;
      g.fillStyle = INK.section;
      g.beginPath();
      g.roundRect(r.x, r.y, r.w, r.h, 28);
      g.fill();
      g.textAlign = 'center';
      g.fillStyle = have ? INK.primary : INK.secondary;
      setFont(g, 32, 600);
      const name = e.kind[0].toUpperCase() + e.kind.slice(1);
      g.fillText(have ? name : '? ? ?', r.x + r.w / 2, r.y + r.h - 54, r.w - 24);
      setFont(g, 24, 500);
      g.fillStyle = INK.secondary;
      if (!have) {
        g.fillText('not folded yet', r.x + r.w / 2, r.y + r.h - 22, r.w - 24);
        return;
      }
      // One swatch per paper colour folded, then the count.
      const colours = [...new Set(e.looks)].slice(-5);
      const x0 = r.x + r.w / 2 - (colours.length * 26) / 2 - 22;
      colours.forEach((look, k) => {
        g.fillStyle = LOOKS[look % LOOKS.length].front;
        g.beginPath();
        g.arc(x0 + k * 26 + 13, r.y + r.h - 24, 10, 0, Math.PI * 2);
        g.fill();
      });
      g.fillStyle = INK.secondary;
      g.textAlign = 'left';
      g.fillText(`×${e.looks.length}`, x0 + colours.length * 26 + 8, r.y + r.h - 22, r.x + r.w - 12 - (x0 + colours.length * 26 + 8));
    });
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
      const rig = buildRig(e.kind, look?.front ?? '#202126', look?.back ?? '#202126');
      if (!have) rig.lines.opacity = 0;
      const root = rig.root;
      const size = new Box3().setFromObject(root).getSize(new Vector3());
      root.scale.setScalar(0.07 / Math.max(size.x, size.y, size.z));
      root.traverse((o) => {
        o.renderOrder = LAYER.control;
        o.raycast = () => {};
      });
      const holder = new Group();
      const r = this.cell(i);
      const [x, y] = this.win.toLocal(r.x + r.w / 2, r.y + 80);
      holder.position.set(x, y - 0.02, 0.03);
      holder.rotation.x = 0.35;
      holder.add(root);
      root.traverse((o) => (o.castShadow = false));
      this.minis.add(holder);
    });
  }

  update(dt: number) {
    this.win.update(dt);
    if (this.win.isOpen) {
      this.spin += dt * 0.7;
      for (const m of this.minis.children) m.children[0].rotation.y = this.spin;
    }
  }
}
