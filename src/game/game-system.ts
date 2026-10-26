/**
 * Wires the folding game into the IWSDK world: creates it, keeps the mat in
 * a comfortable place, runs the reveal of each new creature, and steps
 * everything every frame.
 */

import {
  Color,
  createSystem,
  DirectionalLight,
  Euler,
  Group,
  HemisphereLight,
  Vector3,
  VisibilityState,
  XRMesh,
  XRPlane,
} from '@iwsdk/core';
import { paperBounds } from '../fold/paper.js';
import { Creature } from './creatures.js';
import { FoldGame } from './fold-game.js';
import { dailyLevel, dayNumber, Level, LEVELS, LOOKS, PER_WORLD, WORLDS } from './levels.js';
import { audioContext, audioDestination, isMuted, setListener, setMuted, startMusic, stopMusic } from './sfx.js';
import { Album } from './album.js';
import { Hands } from './hands.js';
import { LevelSelect } from './level-select.js';
import { ResultAction, ResultCard } from './result-card.js';
import { Best, mergeBest, Result } from './score.js';
import { Menagerie } from './menagerie.js';
import { Occluders } from './occluders.js';
import { PalmMenu } from './palm-menu.js';
import { TitleCard } from './title.js';
import { loadSettings, saveSettings, SettingsPanel, SettingsState } from './settings.js';
import { floatingPlacement, Placement, tablePlacement } from './placement.js';
import {
  MeshInfo,
  PlaneInfo,
  RoomFrame,
  roomSurfaces,
  safeGet,
  safeSet,
  Surface,
} from './room.js';
import { RoomScan } from './scan.js';
import { makeDesk, VirtualRoom } from './virtual-room.js';

/** Where the mat rests in the flat browser view. */
const DESKTOP_POSITION = new Vector3(0, 0.74, -0.42);
const PROGRESS_KEY = 'foldlings.progress.v1';
/** Where the mat stood last time, in the room frame (passthrough only). */
const MAT_KEY = 'foldlings.mat.v1';

interface SavedMat {
  p: [number, number, number];
  yaw: number;
  onSurface: boolean;
}

interface Progress {
  level: number;
  solved: string[];
  /** Best stars and fewest folds per level id. */
  best?: Record<string, Best>;
  /** 2 since the eighty-level campaign. */
  version?: number;
  /** Day numbers on which the daily fold was solved. */
  daily?: number[];
  muted?: boolean;
}

export class GameSystem extends createSystem({
  planes: { required: [XRPlane] },
  meshes: { required: [XRMesh] },
}) {
  game!: FoldGame;
  private room!: RoomFrame;
  private zoo!: Menagerie;
  private progress: Progress = { level: 0, solved: [], best: {}, version: 2 };
  private sessionTime = -1;
  private desktopTime = 0;
  private surfaceClock = 0;
  private placed: Placement | null = null;
  /** The current mat spot has been saved against the room anchor. */
  private matSaved = false;
  private euler = new Euler(0, 0, 0, 'YXZ');
  private moveFrom = new Vector3();
  private moveTo = new Vector3();
  private yawFrom = 0;
  private yawTo = 0;
  private moveT = 1;
  private up = new Vector3(0, 1, 0);
  private celebrate: {
    t: number;
    level: Level;
    revealed: boolean;
    vanished: boolean;
    where: string;
    sayAt: number;
    nextAt: number;
    result: Result;
  } | null = null;
  private resultCard!: ResultCard;
  private levelSelect!: LevelSelect;
  /** The level the result card is about, for Retry. */
  private lastLevel: Level | null = null;
  private ear = new Vector3();
  private menu!: PalmMenu;
  private album!: Album;
  private settingsPanel!: SettingsPanel;
  private settings = loadSettings();
  private hands!: Hands;
  private watchPoint = new Vector3();
  /** Real furniture and walls hide creatures behind them (passthrough only). */
  private occluders = new Occluders();
  private occluderKey = '';
  private occluderCheck = 0;
  private title = new TitleCard();
  private titleShown = false;
  private earFwd = new Vector3();
  private galleryItems: Creature[] = [];
  private vroom!: VirtualRoom;
  private scan = new RoomScan();
  private lastScan = -10;
  private scanHinted = false;
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
      if (p && typeof p.level === 'number') this.progress = migrate(p);
    } catch {
      /* fresh start */
    }

    this.vroom = new VirtualRoom();
    this.world.createTransformEntity(this.vroom.root);
    this.world.createTransformEntity(this.scan.root);
    this.room = new RoomFrame(this.world);
    this.zoo = new Menagerie(this.world, this.room);
    this.hands = new Hands(this.world);
    this.world.createTransformEntity(this.occluders.root);
    this.zoo.hands = this.hands;
    this.game = new FoldGame(this.world, {
      onRecenter: () => this.place(true),
      onSolved: (level, _paper, _root, result) => {
        this.zoo.cheer();
        this.celebrate = { t: 0, level, revealed: false, vanished: false, where: '', sayAt: Infinity, nextAt: Infinity, result };
      },
      onDaily: () => this.toggleDaily(),
      footer: () => {
        const n = this.zoo.count;
        const k = this.streak();
        if (!n) return '';
        return `Zoo ${n}` + (k > 0 ? ` · ${k}-day streak` : '');
      },
      onSound: () => this.toggleSound(),
      onMenu: () => this.menu.toggle(),
      onLevels: () => this.openLevels(this.game.level.world),
    });
    this.album = new Album(this.world);
    this.resultCard = new ResultCard(this.world, this.game.boardEntity, (a) => this.afterResult(a));
    this.levelSelect = new LevelSelect(this.world, {
      best: () => this.progress.best ?? {},
      streak: () => this.streak(),
      dailyDone: () => (this.progress.daily ?? []).includes(dayNumber()),
      play: (i) => {
        this.resultCard.hide();
        this.progress.level = i;
        this.saveProgress();
        this.game.loadLevel(i);
        this.game.hidePaper(false);
      },
      daily: () => {
        this.resultCard.hide();
        if (!this.game.isDaily) this.toggleDaily();
        this.game.hidePaper(false);
      },
    });
    this.settingsPanel = new SettingsPanel(this.world, this.settings, (state) => {
      this.applySettings(state);
      saveSettings(state);
    });
    this.menu = new PalmMenu(this.world, [
      { icon: 'levels', label: 'Levels', run: () => this.openLevels(this.game.level.world) },
      { icon: 'album', label: 'Album', run: () => this.album.show(this.zoo.collection(), this.streak(), this.world.camera) },
      { icon: 'daily', label: 'Daily fold', run: () => this.toggleDaily() },
      { icon: 'restart', label: 'Restart', run: () => this.game.restart() },
      { icon: 'sound', label: 'Sound', run: () => this.toggleSound() },
      { icon: 'recenter', label: 'Move mat', run: () => this.place(true) },
      { icon: 'settings', label: 'Settings', run: () => {
        this.album.hide();
        this.settingsPanel.open();
      } },
    ]);
    this.menu.hands = this.hands;
    this.applySettings(this.settings);
    this.world.createTransformEntity(this.title.root);
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
        recenter: () => this.place(true),
        placement: () => this.placed && { label: this.placed.label, onSurface: this.placed.onSurface, p: this.placed.position.toArray().map((v) => +v.toFixed(2)) },
        resetAll: () => {
          this.zoo.reset();
          this.progress = { level: 0, solved: [], daily: [], muted: false, best: {}, version: 2 };
          this.saveProgress();
          this.game.loadLevel(0);
        },
        audio: () => ({ ctx: audioContext(), master: audioDestination() }),
        stopMusic: () => stopMusic(),
        planes: () =>
          this.roomSurfaces().map((p) => ({
            kind: p.kind,
            label: p.label,
            c: p.center.toArray().map((v) => +v.toFixed(2)),
            n: p.normal.toArray().map((v) => +v.toFixed(2)),
            size: (() => {
              const xs = p.polygon.map((q) => q.x);
              const zs = p.polygon.map((q) => q.z);
              const ys = p.polygon.map((q) => q.y);
              return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs)].map((v) => +v.toFixed(2));
            })(),
          })),
        menu: () => this.menu,
        room: () => this.room,
        levels: (w = -1) => this.openLevels(w),
        book: () => this.levelSelect,
        skipTitle: () => {
          this.titleShown = true;
          this.title.stop();
        },
        album: () => this.album.show(this.zoo.collection(), this.streak(), this.world.camera),
        hands: () => this.hands,
        settings: () => this.settingsPanel,
        occluders: () => this.occluders.root.children.length,
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
      this.titleShown = false;
      this.occluderKey = '';
      // Panels left open in another mode would float in the wrong place.
      this.menu.close();
      this.album.hide();
      this.settingsPanel.close();
      this.levelSelect.hide();
      this.scanHinted = false;
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

  private meshInfos(): MeshInfo[] {
    const out: MeshInfo[] = [];
    for (const e of this.queries.meshes.entities) {
      if (!e.object3D || !e.getValue(XRMesh, 'isBounded3D')) continue;
      out.push({
        object: e.object3D,
        label: (e.getValue(XRMesh, 'semanticLabel') as string | undefined) ?? '',
        min: e.getVectorView(XRMesh, 'min'),
        max: e.getVectorView(XRMesh, 'max'),
      });
    }
    return out;
  }

  /** Planes plus furniture tops, in world space. */
  private roomSurfaces(): Surface[] {
    return roomSurfaces(this.planeInfos(), this.meshInfos());
  }

  /** Picks a spot; `force` re-places even if already on a table. */
  private place(force: boolean) {
    if (!force && this.placed?.onSurface) return;
    const head = this.player.head;
    const table = this.mode === 'ar' ? tablePlacement(head, this.roomSurfaces()) : null;
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
    this.matSaved = false;
    // Show what the headset sees of the room while the mat finds its spot.
    if (this.mode === 'ar' && (force || this.sessionTime - this.lastScan > 3)) {
      const surfaces = this.roomSurfaces();
      if (surfaces.length) {
        this.lastScan = this.sessionTime;
        this.scan.start(surfaces, head.getWorldPosition(new Vector3()), next.onSurface ? next.position : null);
      }
    }
    console.info(
      '[foldlings] mat placed:',
      next.label,
      next.position.toArray().map((v) => v.toFixed(2)).join(', '),
    );
  }

  private savedMat(): SavedMat | null {
    try {
      return JSON.parse(safeGet(MAT_KEY) ?? 'null') as SavedMat | null;
    } catch {
      return null;
    }
  }

  /** Yaw of the room frame about world up. */
  private roomYaw(): number {
    return this.euler.setFromQuaternion(this.room.root.quaternion, 'YXZ').y;
  }

  private saveMat() {
    this.matSaved = true;
    const p = this.room.root.worldToLocal(this.game.boardRoot.position.clone());
    const saved: SavedMat = { p: [p.x, p.y, p.z], yaw: this.yawTo - this.roomYaw(), onSurface: !!this.placed?.onSurface };
    safeSet(MAT_KEY, JSON.stringify(saved));
  }

  /** Puts the mat back where it stood last visit. */
  private restoreMat(m: SavedMat) {
    const position = this.room.root.localToWorld(new Vector3(...m.p));
    const root = this.game.boardRoot;
    this.moveFrom.copy(position).y -= 0.05;
    this.moveTo.copy(position);
    this.yawFrom = this.yawTo = m.yaw + this.roomYaw();
    this.moveT = 0;
    // A remembered floating mat may still move onto a table found later.
    this.placed = { position, yaw: this.yawTo, onSurface: m.onSurface, label: 'remembered' };
    this.matSaved = true;
    root.position.copy(this.moveFrom);
    this.game.say('Your mat is right where you left it', 3);
    console.info('[foldlings] mat restored:', position.toArray().map((v) => v.toFixed(2)).join(', '));
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

  /** Rebuilds the depth-only room when the scan gains or loses pieces. */
  private refreshOccluders() {
    const on = this.mode === 'ar';
    this.occluders.setEnabled(on);
    if (!on) return;
    const planes = this.planeInfos();
    const meshes = this.meshInfos();
    const mat = this.game.boardRoot.getWorldPosition(this.watchPoint);
    // Rebuilt when the scan or the mat changes; the head position is taken then.
    const key = `${planes.length}:${meshes.length}:${mat.x.toFixed(2)},${mat.y.toFixed(2)},${mat.z.toFixed(2)}`;
    if (key === this.occluderKey) return;
    this.occluderKey = key;
    this.occluders.update(planes, meshes, mat, this.world.camera.getWorldPosition(this.ear));
  }

  private toggleSound() {
    setMuted(!isMuted());
    this.progress.muted = isMuted();
    this.saveProgress();
  }

  private applySettings(state: SettingsState) {
    this.settings = state;
    this.game.setEasyFolds(state.easyFolds);
    this.menu.menuHand = state.leftHanded ? 'right' : 'left';
    this.game.setLeftHanded(state.leftHanded);
    this.game.setReduceMotion(state.reduceMotion);
    this.zoo.setReduceMotion(state.reduceMotion);
    if (state.reduceMotion) this.title.stop();
    this.game.setHighContrast(state.highContrast);
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
      const { where, prelude } = this.zoo.reveal(
        c.level.creature,
        Math.max(0, LOOKS.indexOf(c.level.look)),
        from,
        this.boardWorld(),
      );
      // Speak once it has folded itself up and is about to set off.
      c.where = where;
      c.sayAt = c.t + prelude;
      c.nextAt = c.t + prelude + 0.5;
      if (this.game.isDaily) {
        const days = new Set(this.progress.daily ?? []);
        days.add(dayNumber());
        this.progress.daily = [...days].sort((a, b) => a - b).slice(-120);
      } else {
        if (!this.progress.solved.includes(c.level.id)) this.progress.solved.push(c.level.id);
        this.progress.level = (this.game.levelIndex + 1) % LEVELS.length;
        this.progress.best ??= {};
        this.progress.best[c.level.id] = mergeBest(this.progress.best[c.level.id], c.result);
      }
      this.saveProgress();
    }
    if (c.t > c.sayAt) {
      c.sayAt = Infinity;
      const name = c.level.creature;
      const swims = name === 'fish' || name === 'whale';
      this.game.say(
        c.where
          ? `The ${name} is off to your ${c.where}`
          : swims
            ? `The ${name} will swim around you`
            : `The ${name} will fly around you`,
        4,
      );
    }
    if (c.t > c.nextAt) {
      this.celebrate = null;
      this.lastLevel = c.level;
      const sub = c.level.world < 0 ? 'Daily Fold' : `${WORLDS[c.level.world].name} world  ·  ${c.level.slot + 1} / ${PER_WORLD}`;
      this.resultCard.show(c.level.name, sub, c.result, this.progress.best?.[c.level.id]);
    }
  }

  /** The level book, open on `world` when it is unlocked. */
  private openLevels(world: number) {
    this.menu.close();
    this.album.hide();
    this.levelSelect.show(this.world.camera, world);
  }

  /** What the result card asked for: the next level, another try, or the level list. */
  private afterResult(action: ResultAction) {
    const last = this.lastLevel;
    if (action === 'retry' && last) {
      if (last.world < 0) this.game.loadDaily(last, 'Daily Fold');
      else this.game.loadLevel(LEVELS.indexOf(last));
    } else {
      this.game.loadLevel(this.progress.level);
      this.game.button('daily')?.setIcon('daily');
    }
    this.game.hidePaper(false);
    if (action === 'levels') this.openLevels(this.game.level.world);
    // Nudge towards today's fold once the basics are learned.
    const doneToday = (this.progress.daily ?? []).includes(dayNumber());
    if (!doneToday && this.progress.solved.length >= 3) this.game.button('daily')?.pulse(4);
  }

  update(delta: number, time: number): void {
    if (this.world.visibilityState.peek() === VisibilityState.VisibleBlurred) return;
    delta = Math.min(delta, 0.1);
    const frame = this.world.session ? this.world.renderer.xr.getFrame() : null;
    this.room.update(frame, delta);
    if (this.sessionTime >= 0) {
      this.sessionTime += delta;
      // A mat remembered from last time goes straight back to its spot;
      // otherwise first placement once the head pose has settled, then
      // upgrade to a real table when the room scan arrives.
      const remembered = this.mode === 'ar' ? this.savedMat() : null;
      if (!this.placed && remembered && this.room.restored && this.room.ready) this.restoreMat(remembered);
      else if (!this.placed && this.sessionTime > (remembered ? 3 : 0.3)) this.place(false);
      else if (
        this.mode === 'ar' &&
        this.placed &&
        !this.placed.onSurface &&
        this.sessionTime < 10 &&
        !this.game.busy
      ) {
        const table = tablePlacement(this.player.head, this.roomSurfaces());
        if (table) this.place(false);
      }
      if (this.mode === 'ar' && this.placed && !this.matSaved && this.room.anchored && this.moveT >= 1) this.saveMat();
      this.surfaceClock -= delta;
      if (this.mode === 'ar' && this.surfaceClock <= 0) {
        this.surfaceClock = 1;
        const surfaces = this.roomSurfaces();
        this.zoo.setSurfaces(surfaces);
        // No room scan: say so once, so the floating mat is not a surprise.
        if (!this.scanHinted && this.sessionTime > 6 && surfaces.length === 0) {
          this.scanHinted = true;
          this.game.say('No room scan found. Run Space Setup so creatures can live on your furniture.', 7);
        }
      }
      if (this.room.ready && this.sessionTime > 2.5 && this.moveT >= 1) {
        const n = this.zoo.restore(this.boardWorld(), this.mode === 'ar');
        if (n) {
          this.game.say(
            n === 1 ? 'Welcome back! Your paper friend is still here' : `Welcome back! Your ${n} paper friends are still here`,
            4,
          );
        }
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
    // The title unfolds once the mat has settled after the room scan.
    if (!this.settings.reduceMotion && !this.titleShown && this.sessionTime > 1 && this.moveT >= 1 && !this.scan.active) {
      this.titleShown = true;
      this.game.boardRoot.updateWorldMatrix(true, false);
      this.title.root.position.set(0, 0.2, -0.17).applyMatrix4(this.game.boardRoot.matrixWorld);
      this.title.root.lookAt(this.world.camera.getWorldPosition(this.ear));
      this.title.play();
    }
    this.title.update(delta);
    this.hands.update(delta);
    this.occluderCheck -= delta;
    if (this.occluderCheck <= 0) {
      this.occluderCheck = 1;
      this.refreshOccluders();
    }
    this.zoo.watch = this.game.busy ? this.game.boardRoot.getWorldPosition(this.watchPoint) : null;
    this.menu.blocked = this.game.busy;
    this.menu.update(delta, this.world.renderer.xr.isPresenting);
    this.album.update(delta);
    this.resultCard.update(delta);
    this.levelSelect.update(delta);
    this.settingsPanel.update(delta);
    this.world.camera.getWorldPosition(this.ear);
    Creature.viewer.copy(this.ear);
    this.world.camera.getWorldDirection(this.earFwd);
    setListener(this.ear, this.earFwd);
    this.game.update(delta, time);
    this.zoo.update(delta);
    this.scan.update(delta);
    this.fitDesk();
    for (const c of this.galleryItems) c.update(delta);
  }
}

/** The twelve-level order before the campaign, for old saves. */
const OLD_ORDER = ['crane', 'frog', 'boat', 'fish', 'fox', 'butterfly', 'rabbit', 'whale', 'crane-2', 'frog-2', 'fox-2', 'whale-2'];

/** Brings an old save into the campaign: same next level, one star per solve. */
export function migrate(p: Progress): Progress {
  if (p.version === 2) return p;
  const next = LEVELS.findIndex((l) => l.id === OLD_ORDER[p.level]);
  const best: Record<string, Best> = {};
  for (const id of p.solved ?? []) best[id] = { stars: 1, folds: 99 };
  return { ...p, level: Math.max(0, next), best, version: 2 };
}
