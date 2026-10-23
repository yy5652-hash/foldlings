/**
 * Wires the folding game into the IWSDK world: creates it, keeps the mat in
 * a comfortable place, runs the reveal of each new creature, and steps
 * everything every frame.
 */

import {
  Color,
  createSystem,
  DirectionalLight,
  Group,
  HemisphereLight,
  Vector3,
  VisibilityState,
  XRPlane,
} from '@iwsdk/core';
import { paperBounds } from '../fold/paper.js';
import { Creature } from './creatures.js';
import { FoldGame } from './fold-game.js';
import { dailyLevel, dayNumber, Level, LEVELS, LOOKS } from './levels.js';
import { isMuted, setMuted, startMusic } from './sfx.js';
import { Menagerie } from './menagerie.js';
import {
  floatingPlacement,
  Placement,
  PlaneInfo,
  tablePlacement,
} from './placement.js';
import { RoomFrame, safeGet, safeSet, surfacesFromPlanes } from './room.js';
import { makeDesk, VirtualRoom } from './virtual-room.js';

/** Where the mat rests in the flat browser view. */
const DESKTOP_POSITION = new Vector3(0, 0.74, -0.42);
const PROGRESS_KEY = 'foldlings.progress.v1';

interface Progress {
  level: number;
  solved: string[];
  /** Day numbers on which the daily fold was solved. */
  daily?: number[];
  muted?: boolean;
}

export class GameSystem extends createSystem({
  planes: { required: [XRPlane] },
}) {
  game!: FoldGame;
  private room!: RoomFrame;
  private zoo!: Menagerie;
  private progress: Progress = { level: 0, solved: [] };
  private sessionTime = -1;
  private desktopTime = 0;
  private surfaceClock = 0;
  private placed: Placement | null = null;
  private moveFrom = new Vector3();
  private moveTo = new Vector3();
  private yawFrom = 0;
  private yawTo = 0;
  private moveT = 1;
  private up = new Vector3(0, 1, 0);
  private celebrate: { t: number; level: Level; revealed: boolean; vanished: boolean } | null = null;
  private galleryItems: Creature[] = [];
  private vroom!: VirtualRoom;
  private desk!: Group;
  /** 'ar' shows the real room; 'vr' and 'desktop' show the virtual study. */
  private mode: 'desktop' | 'ar' | 'vr' = 'desktop';

  init(): void {
    // Soft room light for the mat, buttons and creatures.
    const hemi = new HemisphereLight(new Color(0xfff4e6), new Color(0x6b5a4a), 1.6);
    const sun = new DirectionalLight(new Color(0xffffff), 1.4);
    sun.position.set(0.6, 2, 0.8);
    this.world.scene.add(hemi, sun);

    try {
      const p = JSON.parse(safeGet(PROGRESS_KEY) ?? 'null') as Progress | null;
      if (p && typeof p.level === 'number') this.progress = p;
    } catch {
      /* fresh start */
    }

    this.vroom = new VirtualRoom();
    this.world.createTransformEntity(this.vroom.root);
    this.room = new RoomFrame(this.world);
    this.zoo = new Menagerie(this.world, this.room);
    this.game = new FoldGame(this.world, {
      onRecenter: () => this.place(true),
      onSolved: (level) => {
        this.celebrate = { t: 0, level, revealed: false, vanished: false };
      },
      onDaily: () => this.toggleDaily(),
      onSound: () => {
        setMuted(!isMuted());
        this.progress.muted = isMuted();
        this.game.button('sound')?.setIcon(isMuted() ? 'mute' : 'sound');
        this.saveProgress();
      },
    });
    if (this.progress.muted) {
      setMuted(true);
      this.game.button('sound')?.setIcon('mute');
    }
    this.game.loadLevel(this.progress.level);
    this.game.boardRoot.position.copy(DESKTOP_POSITION);
    this.desk = makeDesk();
    this.game.boardRoot.add(this.desk);
    this.setMode('desktop');

    if (import.meta.env.DEV) {
      // Test hook: board point (u, v, height) → world position.
      (window as unknown as Record<string, unknown>).__foldlings = {
        game: this.game,
        zoo: this.zoo,
        world: this.world,
        gallery: () => {
          const kinds = ['crane', 'frog', 'fox', 'fish', 'butterfly', 'boat', 'rabbit', 'whale'] as const;
          kinds.forEach((k, i) => {
            const c = new Creature(k, LOOKS[i % LOOKS.length]);
            c.root.position.set(-0.27 + (i % 4) * 0.18, i < 4 ? 1.1 : 0.92, -1);
            c.root.rotation.set(0.35, 0.7, 0);
            this.world.scene.add(c.root);
            this.galleryItems.push(c);
          });
          this.game.hidePaper(true);
        },
        boardWorld: (u: number, v: number, h = 0) => {
          this.game.boardRoot.updateWorldMatrix(true, false);
          return new Vector3(u, h, -v).applyMatrix4(this.game.boardRoot.matrixWorld).toArray();
        },
      };
    }
    this.world.renderer.xr.addEventListener('sessionstart', () => {
      startMusic();
      this.sessionTime = 0;
      this.placed = null;
      const blend = this.world.renderer.xr.getSession()?.environmentBlendMode;
      this.setMode(blend && blend !== 'opaque' ? 'ar' : 'vr');
    });
    this.world.renderer.xr.addEventListener('sessionend', () => {
      this.sessionTime = -1;
      this.desktopTime = 0;
      this.placed = null;
      this.setMode('desktop');
      this.game.boardRoot.position.copy(DESKTOP_POSITION);
      this.game.boardRoot.quaternion.identity();
    });
  }

  private setMode(mode: 'desktop' | 'ar' | 'vr') {
    this.mode = mode;
    this.zoo.realRoom = mode === 'ar';
    const virtual = mode !== 'ar';
    this.vroom.root.visible = virtual;
    this.desk.visible = virtual;
    if (virtual) this.zoo.setSurfaces(this.vroom.surfaces());
  }

  /** Stretches the desk legs down to the floor under the mat. */
  private fitDesk() {
    if (!this.desk.visible) return;
    const y = this.game.boardRoot.position.y;
    const len = Math.max(0.05, y - 0.0375);
    for (const leg of this.desk.children) {
      if (leg.name !== 'DeskLeg') continue;
      leg.scale.y = len;
      leg.position.y = -0.0375 - len / 2;
    }
  }

  private planeInfos(): PlaneInfo[] {
    const out: PlaneInfo[] = [];
    for (const e of this.queries.planes.entities) {
      const plane = e.getValue(XRPlane, '_plane') as XRPlane | undefined;
      if (plane && e.object3D) out.push({ object: e.object3D, plane });
    }
    return out;
  }

  /** Picks a spot; `force` re-places even if already on a table. */
  private place(force: boolean) {
    if (!force && this.placed?.onSurface) return;
    const head = this.player.head;
    const table = this.mode === 'ar' ? tablePlacement(head, this.planeInfos()) : null;
    const next = table ?? (force || !this.placed ? floatingPlacement(head) : null);
    if (!next) return;
    const root = this.game.boardRoot;
    this.moveFrom.copy(root.position);
    this.yawFrom = this.placed ? this.yawTo : next.yaw;
    if (!this.placed) this.moveFrom.copy(next.position).y -= 0.05;
    this.moveTo.copy(next.position);
    this.yawTo = next.yaw;
    this.moveT = 0;
    this.placed = next;
    console.info(
      '[foldlings] mat placed:',
      next.label,
      next.position.toArray().map((v) => v.toFixed(2)).join(', '),
    );
  }

  private streak(): number {
    const days = new Set(this.progress.daily ?? []);
    let d = dayNumber();
    if (!days.has(d)) d--;
    let n = 0;
    while (days.has(d)) {
      n++;
      d--;
    }
    return n;
  }

  private toggleDaily() {
    if (this.game.isDaily) {
      this.game.loadLevel(this.progress.level);
      this.game.button('daily')?.setIcon('daily');
      return;
    }
    const today = dayNumber();
    const done = (this.progress.daily ?? []).includes(today);
    const n = this.streak();
    const sub = done ? `Solved today · ${n}-day streak` : n > 0 ? `${n}-day streak` : 'A new fold every day';
    this.game.loadDaily(dailyLevel(today), sub);
    this.game.button('daily')?.setIcon('back');
  }

  private boardWorld(): Vector3 {
    return this.game.boardRoot.getWorldPosition(new Vector3());
  }

  private saveProgress() {
    safeSet(PROGRESS_KEY, JSON.stringify(this.progress));
  }

  private updateCelebration(dt: number) {
    const c = this.celebrate!;
    c.t += dt;
    if (!c.vanished && c.t > 0.75) {
      c.vanished = true;
      this.game.vanishPaper();
    }
    if (!c.revealed && c.t > 1.0) {
      c.revealed = true;
      const b = paperBounds(this.game.paper);
      const from = new Vector3((b.minX + b.maxX) / 2, 0.025, -(b.minY + b.maxY) / 2);
      this.game.boardRoot.localToWorld(from);
      const where = this.zoo.reveal(
        c.level.creature,
        Math.max(0, LOOKS.indexOf(c.level.look)),
        from,
        this.boardWorld(),
      );
      const name = c.level.creature;
      const swims = name === 'fish' || name === 'whale';
      this.game.say(
        where
          ? `The ${name} settled on your ${where}`
          : swims
            ? `The ${name} is swimming around you`
            : `The ${name} is flying around you`,
        4.2,
      );
      if (this.game.isDaily) {
        const days = new Set(this.progress.daily ?? []);
        days.add(dayNumber());
        this.progress.daily = [...days].sort((a, b) => a - b).slice(-120);
      } else {
        if (!this.progress.solved.includes(c.level.id)) this.progress.solved.push(c.level.id);
        this.progress.level = (this.game.levelIndex + 1) % LEVELS.length;
      }
      this.saveProgress();
    }
    if (c.t > 2.6) {
      this.celebrate = null;
      this.game.loadLevel(this.progress.level);
      this.game.button('daily')?.setIcon('daily');
      this.game.hidePaper(false);
      // Nudge towards today's fold once the basics are learned.
      const doneToday = (this.progress.daily ?? []).includes(dayNumber());
      if (!doneToday && this.progress.solved.length >= 3) this.game.button('daily')?.pulse(4);
    }
  }

  update(delta: number, time: number): void {
    if (this.world.visibilityState.peek() === VisibilityState.VisibleBlurred) return;
    const frame = this.world.session ? this.world.renderer.xr.getFrame() : null;
    this.room.update(frame, delta);
    if (this.sessionTime >= 0) {
      this.sessionTime += delta;
      // First placement once the head pose has settled, then upgrade to a
      // real table when the room scan arrives.
      if (!this.placed && this.sessionTime > 0.3) this.place(false);
      else if (this.mode === 'ar' && this.placed && !this.placed.onSurface && this.sessionTime < 10) {
        const table = tablePlacement(this.player.head, this.planeInfos());
        if (table) this.place(false);
      }
      this.surfaceClock -= delta;
      if (this.mode === 'ar' && this.surfaceClock <= 0) {
        this.surfaceClock = 1;
        this.zoo.setSurfaces(surfacesFromPlanes(this.planeInfos()));
      }
      if (this.room.ready && this.sessionTime > 2.5 && this.moveT >= 1) {
        this.zoo.restore(this.boardWorld(), this.mode === 'ar');
      }
    } else {
      this.desktopTime += delta;
      if (this.desktopTime > 0.5) this.zoo.restore(this.boardWorld(), false);
    }
    if (this.moveT < 1) {
      this.moveT = Math.min(1, this.moveT + delta / 0.6);
      const e = 1 - Math.pow(1 - this.moveT, 3);
      const root = this.game.boardRoot;
      root.position.lerpVectors(this.moveFrom, this.moveTo, e);
      root.quaternion.setFromAxisAngle(this.up, this.yawFrom + (this.yawTo - this.yawFrom) * e);
    }
    if (this.celebrate) this.updateCelebration(delta);
    this.game.update(delta, time);
    this.zoo.update(delta);
    this.fitDesk();
    for (const c of this.galleryItems) c.update(delta);
  }
}
