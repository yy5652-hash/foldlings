/**
 * The level book: eight worlds with their creature, stars and locks, then
 * ten levels per world with the goal picture and stars on each tile. A
 * Daily Fold banner sits on top. Opens where you look and stays there.
 */

import { Box3, Group, LineSegments, Mesh, MeshBasicMaterial, Vector3, World } from '@iwsdk/core';
import { applyFolds } from '../fold/paper.js';
import { drawShape } from './board-view.js';
import { Button } from './button.js';
import { buildRig } from './creature-models.js';
import { drawIcon, drawStars, GlassWindow, INK, LAYER, setFont } from './glass.js';
import { Level, LEVELS, PER_WORLD, WORLDS } from './levels.js';
import { Best, totalStars, UNLOCK, worldOpen } from './score.js';
import { sfx } from './sfx.js';

const W = 0.5;
const H = 0.36;
const PX = 1024;
const PAD = 44;
const AUTO_CLOSE = 40;

interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LevelBookHost {
  best: () => Record<string, Best>;
  streak: () => number;
  dailyDone: () => boolean;
  play: (index: number) => void;
  daily: () => void;
  /** Saved player puzzles, newest first. */
  mine: () => { level: Level; code: string }[];
  free: () => void;
  playLevel: (level: Level) => void;
}

export class LevelSelect {
  private win: GlassWindow;
  private minis = new Group();
  private back: Button;
  private page = -1;
  private spin = 0;

  constructor(world: World, private host: LevelBookHost) {
    this.win = new GlassWindow(world, { name: 'LevelBook', w: W, h: H, px: PX, r: 0.03, autoClose: AUTO_CLOSE });
    this.win.content.add(this.minis);
    this.back = new Button('back', () => {
      if (!this.win.ready) return;
      this.win.touch();
      sfx.click();
      this.showWorlds();
    }, '', { plain: true, r: 0.016 });
    this.back.root.name = 'LevelBook_back';
    // Include the kit's hit margin: the plain control spans just over 90 px.
    this.back.root.scale.setScalar(1.15);
    this.back.root.position.set((PAD + 45) * W / PX - W / 2, 0, 0.006);
    this.back.root.rotation.x = Math.PI / 2;
    this.win.addControl(this.back.root, this.back);
    this.parkBack(true);

    const close = new Button('close', () => {
      if (!this.win.ready) return;
      sfx.click();
      this.hide();
    }, '', { r: 0.015 });
    close.root.name = 'LevelBook_close';
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

  /** Opens in front of the player on the given world (or the world list). */
  show(camera: { getWorldPosition(v: Vector3): Vector3; getWorldDirection(v: Vector3): Vector3 }, world = -1) {
    // Keep the caller's API; the shared window places itself using world.camera.
    void camera;
    if (world === -2) this.showMine();
    else if (world >= 0 && worldOpen(world, totalStars(this.host.best()))) this.showWorld(world);
    else this.showWorlds();
    this.win.open(0.52, 0.1);
    sfx.pick();
  }

  hide() {
    this.win.close();
  }

  private clearTiles() {
    this.win.clearHits();
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

  private addTile(t: Tile, run: () => void, name: string) {
    this.win.addHit(t.x, t.y, t.w, t.h, 28, () => {
      sfx.click();
      run();
    }, name);
  }

  /** Free fold first, then the player's own puzzles, newest first. */
  private showMine() {
    this.page = -2;
    this.clearTiles();
    this.parkBack(false);
    const mine = this.host.mine().slice(0, PER_WORLD - 1);
    this.levelTiles().forEach((t, i) => {
      if (i === 0) {
        this.addTile(t, () => {
          this.hide();
          this.host.free();
        }, 'LevelBook_free');
      } else if (i <= mine.length) {
        const m = mine[i - 1];
        this.addTile(t, () => {
          this.hide();
          this.host.playLevel(m.level);
        }, `LevelBook_mine_${i}`);
      }
    });
    this.drawMine();
  }

  private drawMine() {
    const g = this.win.clear();
    const best = this.host.best();
    const mine = this.host.mine().slice(0, PER_WORLD - 1);
    this.header(g, 'My puzzles', `${this.host.mine().length} saved`, false);
    g.textAlign = 'left';
    g.fillStyle = INK.secondary;
    setFont(g, 22, 400);
    g.fillText(mine.length ? 'Send a code to a friend, or open it with ?p=CODE' : 'Fold anything and save it as a puzzle', PAD + 76, 112, PX - PAD * 2 - 240);
    this.levelTiles().forEach((t, i) => {
      this.card(g, t);
      const cx = t.x + t.w / 2;
      if (i === 0) {
        drawIcon(g, 'plus', cx, t.y + 102, 72, INK.primary);
        g.textAlign = 'center';
        g.fillStyle = INK.primary;
        setFont(g, 30, 600);
        g.fillText('Free fold', cx, t.y + 190, t.w - 20);
        g.fillStyle = INK.secondary;
        setFont(g, 22, 400);
        g.fillText('make a puzzle', cx, t.y + 224, t.w - 20);
        return;
      }
      const m = mine[i - 1];
      if (!m) return;
      this.drawThumb(g, m.level, cx - 67.5, t.y + 24);
      drawStars(g, cx, t.y + 190, 28, best[m.level.id]?.stars ?? 0);
      g.textAlign = 'center';
      g.fillStyle = INK.primary;
      setFont(g, 22, 600, 1.5);
      g.fillText(m.code, cx, t.y + 229, t.w - 20);
    });
    this.win.commit();
  }

  private card(g: CanvasRenderingContext2D, t: Tile) {
    g.fillStyle = INK.section;
    g.beginPath();
    g.roundRect(t.x, t.y, t.w, t.h, 28);
    g.fill();
  }

  private header(g: CanvasRenderingContext2D, title: string, total: string, star = true) {
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = INK.primary;
    setFont(g, 52, 700, -0.8);
    // On a subpage the title sits beside the back button.
    g.fillText(title, this.page === -1 ? PAD : PAD + 76, 70, PX - PAD * 2 - 240);
    setFont(g, 24, 500);
    g.fillStyle = INK.secondary;
    g.textAlign = 'right';
    const y = 70;
    g.fillText(total, PX - PAD, y);
    if (star) drawIcon(g, 'star', PX - PAD - g.measureText(total).width - 24, y, 26, INK.secondary);
  }

  private worldTiles(): Tile[] {
    const out: Tile[] = [];
    for (let i = 0; i < WORLDS.length; i++) out.push({ x: PAD + (i % 4) * 238, y: 238 + Math.floor(i / 4) * 232, w: 222, h: 218 });
    return out;
  }

  private showWorlds() {
    this.page = -1;
    this.clearTiles();
    this.parkBack(true);
    const stars = totalStars(this.host.best());
    this.addTile({ x: PAD, y: 120, w: 458, h: 100 }, () => {
      this.hide();
      this.host.daily();
    }, 'LevelBook_daily');
    this.addTile({ x: 522, y: 120, w: 458, h: 100 }, () => this.showMine(), 'LevelBook_mine');
    this.worldTiles().forEach((t, w) => {
      const open = worldOpen(w, stars);
      this.addTile(t, () => open && this.showWorld(w), `LevelBook_world_${w}`);
      const look = LEVELS[w * PER_WORLD].look;
      const rig = buildRig(WORLDS[w].kind, open ? look.front : '#202126', open ? look.back : '#202126');
      if (!open) rig.lines.opacity = 0;
      const size = new Box3().setFromObject(rig.root).getSize(new Vector3());
      rig.root.scale.setScalar(0.062 / Math.max(size.x, size.y, size.z));
      rig.root.traverse((o) => {
        o.renderOrder = LAYER.control;
        o.raycast = () => {};
      });
      const holder = new Group();
      const [lx, ly] = this.win.toLocal(t.x + t.w / 2, t.y + 80);
      holder.position.set(lx, ly - 0.012, 0.03);
      holder.rotation.x = 0.35;
      holder.add(rig.root);
      rig.root.traverse((o) => (o.castShadow = false));
      this.minis.add(holder);
    });
    this.drawWorlds();
  }

  private drawWorlds() {
    const g = this.win.clear();
    const best = this.host.best();
    const stars = totalStars(best);
    this.header(g, 'Levels', `${stars} of ${LEVELS.length * 3}`);
    this.card(g, { x: PAD, y: 120, w: 458, h: 100 });
    this.card(g, { x: 522, y: 120, w: 458, h: 100 });
    g.textAlign = 'left';
    g.fillStyle = INK.primary;
    setFont(g, 32, 600);
    g.fillText('Daily Fold', PAD + 24, 153);
    g.fillText('My puzzles', 546, 153);
    g.fillStyle = INK.secondary;
    setFont(g, 22, 400);
    const k = this.host.streak();
    g.fillText((this.host.dailyDone() ? 'Solved today' : 'A new fold every day') + (k > 0 ? ` · ${k}-day streak` : ''), PAD + 24, 190, 410);
    const n = this.host.mine().length;
    g.fillText(n ? `${n} saved · free fold` : 'Free fold, make your own', 546, 190, 410);
    this.worldTiles().forEach((t, w) => {
      const open = worldOpen(w, stars);
      this.card(g, t);
      const cx = t.x + t.w / 2;
      g.textAlign = 'center';
      g.fillStyle = open ? INK.primary : INK.secondary;
      setFont(g, 32, 600);
      g.fillText(WORLDS[w].name, cx, t.y + 161, t.w - 24);
      g.fillStyle = INK.secondary;
      setFont(g, 24, 500);
      let label: string;
      if (open) {
        let s = 0;
        for (const l of LEVELS) if (l.world === w) s += best[l.id]?.stars ?? 0;
        label = `${s} of ${PER_WORLD * 3}`;
      } else {
        drawIcon(g, 'lock', t.x + t.w - 34, t.y + 34, 44, INK.tertiary);
        label = `${UNLOCK[w]} to open`;
      }
      const width = g.measureText(label).width;
      drawIcon(g, 'star', cx - width / 2 - 14, t.y + 195, 22, INK.secondary);
      g.fillText(label, cx + 14, t.y + 195, t.w - 54);
    });
    this.win.commit();
  }

  private levelTiles(): Tile[] {
    const out: Tile[] = [];
    for (let i = 0; i < PER_WORLD; i++) out.push({ x: PAD + (i % 5) * 190, y: 132 + Math.floor(i / 5) * 280, w: 176, h: 254 });
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
    this.parkBack(false);
    const list = this.levels(w);
    this.levelTiles().forEach((t, i) => {
      this.addTile(t, () => {
        if (!this.levelOpen(list, i, this.host.best())) return;
        this.hide();
        this.host.play(LEVELS.indexOf(list[i]));
      }, `LevelBook_level_${i + 1}`);
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

  private drawThumb(g: CanvasRenderingContext2D, l: Level, x: number, y: number) {
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.roundRect(x, y, 135, 135, 18);
    g.fill();
    g.drawImage(this.thumb(l), x, y, 135, 135);
  }

  private drawWorld(w: number) {
    const g = this.win.clear();
    const best = this.host.best();
    const list = this.levels(w);
    let s = 0;
    for (const l of list) s += best[l.id]?.stars ?? 0;
    this.header(g, `${WORLDS[w].name} world`, `${s} of ${PER_WORLD * 3}`);
    const next = list.findIndex((l) => !best[l.id]);
    this.levelTiles().forEach((t, i) => {
      const l = list[i];
      const open = this.levelOpen(list, i, best);
      this.card(g, t);
      if (i === next && open) {
        g.strokeStyle = 'rgba(255,255,255,0.75)';
        g.lineWidth = 3;
        g.beginPath();
        g.roundRect(t.x + 1.5, t.y + 1.5, t.w - 3, t.h - 3, 26.5);
        g.stroke();
      }
      g.textAlign = 'left';
      g.fillStyle = INK.secondary;
      setFont(g, 26, 600);
      g.fillText(String(i + 1), t.x + 16, t.y + 25);
      const cx = t.x + t.w / 2;
      if (open) {
        this.drawThumb(g, l, cx - 67.5, t.y + 46);
        drawStars(g, cx, t.y + 204, 28, best[l.id]?.stars ?? 0);
        g.textAlign = 'center';
        g.fillStyle = INK.secondary;
        setFont(g, 22, 400);
        g.fillText(`Par ${l.par}`, cx, t.y + 235);
      } else {
        drawIcon(g, 'lock', cx, t.y + 120, 44, INK.tertiary);
      }
    });
    this.win.commit();
  }

  /** Park the back control outside ray reach on the worlds page. */
  private parkBack(hidden: boolean) {
    this.back.root.position.y = hidden ? -50 : this.win.toLocal(0, 70)[1];
  }

  update(dt: number) {
    this.win.update(dt);
    if (this.win.isOpen) {
      this.spin += dt * 0.7;
      for (const m of this.minis.children) m.children[0].rotation.y = this.spin;
    }
  }
}
