/**
 * The level book: eight worlds with their creature, stars and locks, then
 * ten levels per world with the goal picture and stars on each tile. A
 * Daily Fold banner sits on top. Opens where you look and stays there.
 */

import {
  Box3,
  CanvasTexture,
  Entity,
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
import { applyFolds } from '../fold/paper.js';
import { drawShape } from './board-view.js';
import { Button } from './button.js';
import { buildRig } from './creature-models.js';
import { Level, LEVELS, PER_WORLD, WORLDS } from './levels.js';
import { Best, totalStars, UNLOCK, worldOpen } from './score.js';
import { sfx } from './sfx.js';

const W = 0.5;
const H = 0.36;
const PX = 1024;
const PY = Math.round((PX * H) / W);
const AUTO_CLOSE = 40;

interface Tile {
  hit: Mesh;
  /** Canvas rectangle. */
  x: number;
  y: number;
  w: number;
  h: number;
  run: () => void;
}

export interface LevelBookHost {
  best: () => Record<string, Best>;
  streak: () => number;
  dailyDone: () => boolean;
  play: (index: number) => void;
  daily: () => void;
}

export class LevelSelect {
  readonly panel = new Group();
  private canvas = document.createElement('canvas');
  private tex: CanvasTexture;
  private minis = new Group();
  private tiles: Tile[] = [];
  private tileRoot = new Group();
  private pe: Entity;
  private back: Button;
  private close: Button;
  private page = -1;
  private hover = -1;
  private lastPress = -1e9;
  private open = false;
  private unfold = 0;
  private idle = 0;
  private spin = 0;
  private head = new Vector3();
  private fwd = new Vector3();

  constructor(
    private world: World,
    private host: LevelBookHost,
  ) {
    this.panel.name = 'LevelBook';
    this.canvas.width = PX;
    this.canvas.height = PY;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    const page = new Mesh(new PlaneGeometry(W, H), new MeshBasicMaterial({ map: this.tex, transparent: true }));
    page.renderOrder = -5;
    this.panel.add(page, this.minis, this.tileRoot);
    this.pe = world.createTransformEntity(this.panel);
    const token = (icon: 'back' | 'close', x: number, run: () => void) => {
      const b = new Button(icon, () => {
        sfx.click();
        run();
      });
      b.root.name = `LevelBook_${icon}`;
      b.root.scale.setScalar(0.7);
      b.root.rotation.x = Math.PI / 2;
      b.root.position.set(x, H / 2 - 0.032, 0.004);
      const e = world.createTransformEntity(b.root, this.pe);
      e.addComponent(RayInteractable);
      e.addComponent(PokeInteractable);
      return b;
    };
    this.back = token('back', -W / 2 + 0.032, () => this.showWorlds());
    this.close = token('close', W / 2 - 0.032, () => this.hide());
    this.panel.visible = false;
    this.panel.position.set(0, -50, 0);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Opens in front of the player on the given world (or the world list). */
  show(camera: { getWorldPosition(v: Vector3): Vector3; getWorldDirection(v: Vector3): Vector3 }, world = -1) {
    camera.getWorldPosition(this.head);
    camera.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-4) this.fwd.set(0, 0, -1);
    this.fwd.normalize();
    this.panel.position.copy(this.head).addScaledVector(this.fwd, 0.52);
    this.panel.position.y -= 0.1;
    this.panel.lookAt(this.head);
    this.panel.visible = true;
    this.open = true;
    this.idle = 0;
    sfx.pick();
    if (world >= 0 && worldOpen(world, totalStars(this.host.best()))) this.showWorld(world);
    else this.showWorlds();
  }

  hide() {
    this.open = false;
  }

  /** Canvas pixels → panel-local metres. */
  private local(px: number, py: number): [number, number] {
    return [(px / PX - 0.5) * W, (0.5 - py / PY) * H];
  }

  private clearTiles() {
    for (const t of this.tiles) {
      this.tileRoot.remove(t.hit.parent!);
      t.hit.geometry.dispose();
    }
    this.tiles = [];
    for (const m of [...this.minis.children]) {
      this.minis.remove(m);
      m.traverse((o) => {
        if ((o as Mesh).isMesh && o.name === 'Paper') (o as Mesh).geometry.dispose();
        if ((o as LineSegments).isLineSegments) {
          (o as LineSegments).geometry.dispose();
          ((o as LineSegments).material as MeshBasicMaterial).dispose();
        }
      });
    }
  }

  /** An invisible pressable area over a canvas rectangle. */
  private addTile(x: number, y: number, w: number, h: number, run: () => void) {
    const [cx, cy] = this.local(x + w / 2, y + h / 2);
    const hit = new Mesh(
      new PlaneGeometry((w / PX) * W, (h / PY) * H),
      new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    const holder = new Group();
    holder.position.set(cx, cy, 0.003);
    holder.add(hit);
    this.tileRoot.add(holder);
    const e = this.world.createTransformEntity(holder, this.pe);
    e.addComponent(RayInteractable);
    e.addComponent(PokeInteractable);
    const index = this.tiles.length;
    const target = holder as unknown as { addEventListener(type: string, fn: () => void): void };
    target.addEventListener('pointerdown', () => {
      // One press per touch, even when a fingertip passes in and out.
      const now = performance.now();
      if (!this.open || this.unfold < 0.9 || now - this.lastPress < 500) return;
      this.lastPress = now;
      sfx.click();
      run();
    });
    target.addEventListener('pointerenter', () => this.setHover(index));
    target.addEventListener('pointerleave', () => this.hover === index && this.setHover(-1));
    this.tiles.push({ hit, x, y, w, h, run });
  }

  private setHover(i: number) {
    this.hover = i;
    this.idle = 0;
    this.redraw();
  }

  private redraw() {
    if (this.page < 0) this.drawWorlds();
    else this.drawWorld(this.page);
  }

  private card(g: CanvasRenderingContext2D, t: { x: number; y: number; w: number; h: number }, i: number, dim: boolean) {
    g.fillStyle = dim ? 'rgba(47,74,69,0.05)' : i === this.hover ? 'rgba(255,209,102,0.35)' : 'rgba(47,74,69,0.09)';
    g.beginPath();
    g.roundRect(t.x, t.y, t.w, t.h, 22);
    g.fill();
  }

  private page0(g: CanvasRenderingContext2D, title: string, right: string) {
    g.clearRect(0, 0, PX, PY);
    g.fillStyle = 'rgba(246,239,226,0.97)';
    g.beginPath();
    g.roundRect(4, 4, PX - 8, PY - 8, 36);
    g.fill();
    g.fillStyle = '#2f4a45';
    g.font = '700 50px Georgia, "Times New Roman", serif';
    g.textAlign = 'center';
    g.fillText(title, PX / 2, 72);
    g.fillStyle = '#b0795a';
    g.font = '600 30px system-ui, -apple-system, Segoe UI, sans-serif';
    g.fillText(right, PX / 2, 112);
  }

  private lock(g: CanvasRenderingContext2D, x: number, y: number) {
    g.strokeStyle = '#8a7a6a';
    g.fillStyle = '#8a7a6a';
    g.lineWidth = 7;
    g.beginPath();
    g.arc(x, y - 14, 16, Math.PI, 0);
    g.stroke();
    g.fillRect(x - 24, y - 14, 48, 36);
  }

  private worldTiles() {
    const out: { x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i < WORLDS.length; i++) out.push({ x: 60 + (i % 4) * 230, y: 240 + Math.floor(i / 4) * 245, w: 212, h: 230 });
    return out;
  }

  private showWorlds() {
    this.page = -1;
    this.clearTiles();
    this.hover = -1;
    this.parkBack(true);
    const best = this.host.best();
    const stars = totalStars(best);
    // Daily banner first, then the eight worlds.
    this.addTile(60, 140, 904, 80, () => {
      this.hide();
      this.host.daily();
    });
    this.worldTiles().forEach((t, w) => {
      const open = worldOpen(w, stars);
      this.addTile(t.x, t.y, t.w, t.h, () => open && this.showWorld(w));
      const look = LEVELS[w * PER_WORLD].look;
      const rig = buildRig(WORLDS[w].kind, open ? look.front : '#25302d', open ? look.back : '#25302d');
      if (!open) rig.lines.opacity = 0;
      const size = new Box3().setFromObject(rig.root).getSize(new Vector3());
      rig.root.scale.setScalar(0.062 / Math.max(size.x, size.y, size.z));
      const holder = new Group();
      const [lx, ly] = this.local(t.x + t.w / 2, t.y + 92);
      holder.position.set(lx, ly - 0.012, 0.03);
      holder.rotation.x = 0.35;
      holder.add(rig.root);
      this.minis.add(holder);
    });
    this.drawWorlds();
  }

  private drawWorlds() {
    const g = this.canvas.getContext('2d')!;
    const best = this.host.best();
    const stars = totalStars(best);
    this.page0(g, 'Levels', `★ ${stars} / ${LEVELS.length * 3}`);
    const banner = { x: 60, y: 140, w: 904, h: 80 };
    this.card(g, banner, 0, false);
    g.textAlign = 'left';
    g.fillStyle = '#2f4a45';
    g.font = '700 34px system-ui, -apple-system, Segoe UI, sans-serif';
    g.fillText('Daily Fold', 90, 192);
    g.fillStyle = '#8a7a6a';
    g.font = '500 28px system-ui, -apple-system, Segoe UI, sans-serif';
    const k = this.host.streak();
    g.fillText(
      (this.host.dailyDone() ? 'Solved today' : 'A new fold every day') + (k > 0 ? `  ·  ${k}-day streak` : ''),
      290,
      192,
    );
    this.worldTiles().forEach((t, w) => {
      const open = worldOpen(w, stars);
      this.card(g, t, w + 1, !open);
      g.textAlign = 'center';
      g.fillStyle = open ? '#3b3027' : '#b3a898';
      g.font = '600 32px system-ui, -apple-system, Segoe UI, sans-serif';
      g.fillText(WORLDS[w].name, t.x + t.w / 2, t.y + 178);
      g.font = '600 26px system-ui, -apple-system, Segoe UI, sans-serif';
      if (open) {
        let s = 0;
        for (const l of LEVELS) if (l.world === w) s += best[l.id]?.stars ?? 0;
        g.fillStyle = '#b0795a';
        g.fillText(`★ ${s} / ${PER_WORLD * 3}`, t.x + t.w / 2, t.y + 214);
      } else {
        this.lock(g, t.x + t.w / 2, t.y + 96);
        g.fillStyle = '#8a7a6a';
        g.fillText(`★ ${UNLOCK[w]} to open`, t.x + t.w / 2, t.y + 214);
      }
    });
    this.tex.needsUpdate = true;
  }

  private levelTiles() {
    const out: { x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i < PER_WORLD; i++) out.push({ x: 60 + (i % 5) * 183, y: 150 + Math.floor(i / 5) * 280, w: 165, h: 262 });
    return out;
  }

  private levels(w: number): Level[] {
    return LEVELS.filter((l) => l.world === w);
  }

  /** A level opens once the one before it is solved. */
  private levelOpen(list: Level[], i: number, best: Record<string, Best>): boolean {
    return i === 0 || !!best[list[i - 1].id];
  }

  private showWorld(w: number) {
    this.page = w;
    this.clearTiles();
    this.hover = -1;
    this.parkBack(false);
    const list = this.levels(w);
    this.levelTiles().forEach((t, i) => {
      this.addTile(t.x, t.y, t.w, t.h, () => {
        if (!this.levelOpen(list, i, this.host.best())) return;
        this.hide();
        this.host.play(LEVELS.indexOf(list[i]));
      });
    });
    this.drawWorld(w);
  }

  private thumbs = new Map<string, HTMLCanvasElement>();

  /** The goal picture of a level, drawn once and kept. */
  private thumb(l: Level): HTMLCanvasElement {
    let c = this.thumbs.get(l.id);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const s = applyFolds(l.solution);
    if (s) drawShape(g, s.facets, l.look, 256, 'rgba(255,255,255,0.9)', 4);
    this.thumbs.set(l.id, c);
    return c;
  }

  private drawWorld(w: number) {
    const g = this.canvas.getContext('2d')!;
    const best = this.host.best();
    const list = this.levels(w);
    let s = 0;
    for (const l of list) s += best[l.id]?.stars ?? 0;
    this.page0(g, `${WORLDS[w].name} world`, `★ ${s} / ${PER_WORLD * 3}`);
    const next = list.findIndex((l) => !best[l.id]);
    this.levelTiles().forEach((t, i) => {
      const l = list[i];
      const open = this.levelOpen(list, i, best);
      this.card(g, t, i, !open);
      if (i === next && open) {
        g.strokeStyle = '#ffb703';
        g.lineWidth = 5;
        g.beginPath();
        g.roundRect(t.x + 2, t.y + 2, t.w - 4, t.h - 4, 20);
        g.stroke();
      }
      g.textAlign = 'left';
      g.fillStyle = open ? '#2f4a45' : '#b3a898';
      g.font = '700 30px system-ui, -apple-system, Segoe UI, sans-serif';
      g.fillText(String(i + 1), t.x + 14, t.y + 36);
      if (open) {
        // Goal picture on a little felt square, as on the mat.
        g.fillStyle = '#2f4a45';
        g.beginPath();
        g.roundRect(t.x + 15, t.y + 48, 135, 135, 14);
        g.fill();
        g.drawImage(this.thumb(l), t.x + 15, t.y + 48, 135, 135);
        const b = best[l.id];
        g.textAlign = 'center';
        g.fillStyle = b ? '#f2a900' : '#cbbfae';
        g.font = '600 32px system-ui, -apple-system, Segoe UI, sans-serif';
        const st = b?.stars ?? 0;
        g.fillText('★'.repeat(st) + '☆'.repeat(3 - st), t.x + t.w / 2, t.y + 222);
        g.fillStyle = '#8a7a6a';
        g.font = '500 22px system-ui, -apple-system, Segoe UI, sans-serif';
        g.fillText(`par ${l.par}`, t.x + t.w / 2, t.y + 250);
      } else {
        this.lock(g, t.x + t.w / 2, t.y + 120);
      }
    });
    this.tex.needsUpdate = true;
  }

  /** The back token only shows on a world's page. */
  private parkBack(hidden: boolean) {
    this.back.root.position.y = hidden ? -50 : H / 2 - 0.032;
  }

  update(dt: number) {
    this.unfold += ((this.open ? 1 : 0) - this.unfold) * Math.min(1, dt * 10);
    this.panel.scale.set(1, Math.max(0.02, this.unfold), 1);
    this.back.update(dt);
    this.close.update(dt);
    if (this.open) {
      this.idle += dt;
      if (this.idle > AUTO_CLOSE) this.hide();
      this.spin += dt * 0.7;
      for (const m of this.minis.children) m.children[0].rotation.y = this.spin;
    } else if (this.unfold < 0.03 && this.panel.visible) {
      this.panel.visible = false;
      this.panel.position.set(0, -50, 0);
    }
  }
}
