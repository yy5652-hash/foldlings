/**
 * Wires the folding game into the IWSDK world: creates it, keeps the mat in
 * a comfortable place, runs the reveal of each new creature, and steps
 * everything every frame.
 */

import { viewFov } from './view-fov.js';
import {
  NeutralToneMapping,
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
  PokeInteractable,
  RayInteractable,
} from '@iwsdk/core';
import { FoldSpec, paperBounds } from '../fold/paper.js';
import { Pause } from './pause.js';
import { SavedSheet, serialiseSheet, validateSheet } from './resume.js';
import { FoldGame } from './fold-game.js';
import { CreatureKind, customLevel, dailyLevel, dayNumber, FREE_LEVEL, Level, LEVELS, LOOKS, PER_WORLD, WORLDS } from './levels.js';
import { audioContext, audioDestination, isMuted, setListener, setMuted, sfx, startMusic, stopMusic, suspendAudio, resumeAudio } from './sfx.js';
import { ACHIEVEMENTS, AchievementStats, newlyEarned } from './achievements.js';
import { Album } from './album.js';
import { BadgePop } from './badge.js';
import { Button } from './button.js';
import { Creature, HABITAT } from './creatures.js';
import { HoloStage } from './holo-stage.js';
import { RoomModel } from './room-model.js';
import { HoloVolume } from './holo-volume.js';
import { tickHolo } from './holo.js';
import { QualityGuard } from './quality.js';
import { HandBodies } from './hand-bodies.js';
import { Dimmer } from './dimmer.js';
import { Hands } from './hands.js';
import { LevelSelect } from './level-select.js';
import { ResultAction, ResultCard } from './result-card.js';
import { Best, mergeBest, Result, totalStars, worldOpen } from './score.js';
import { decodeFolds, encodeFolds, formatCode } from './share.js';
import { Menagerie } from './menagerie.js';
import { Occluders } from './occluders.js';
import { PalmMenu } from './palm-menu.js';
import { TitleCard } from './title.js';
import { loadSettings, MAT_STEP, saveSettings, SettingsPanel, SettingsState } from './settings.js';
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
  /** Worlds with all ten levels solved (their parade has played). */
  worlds?: number[];
  /** Badge ids earned. */
  badges?: string[];
  /** Player-made puzzles as share codes, oldest first. */
  custom?: string[];
  counters?: { palm?: number; waves?: number };
  /** Day numbers on which the daily fold was solved. */
  daily?: number[];
  muted?: boolean;
  titleSeen?: boolean;
  sheet?: SavedSheet | null;
}

/** How far the real room stays dimmed while the projection is running. */
const THEATRE_DIM = 0.68;
/** How long a creature from the album stays on the table. */
const INSPECT_SECONDS = 12;

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
    firstSolve: boolean;
    vanished: boolean;
    where: string;
    sayAt: number;
    nextAt: number;
    result: Result;
    /** Gold line for the result card: a world completed or opened. */
    banner?: string;
    /** World just completed, for the parade, or -1. */
    worldDone?: number;
  } | null = null;
  private resultCard!: ResultCard;
  private badge = new BadgePop();
  private levelSelect!: LevelSelect;
  /** The level the result card is about, for Retry. */
  private lastLevel: Level | null = null;
  private ear = new Vector3();
  /** The warm key light; it follows the mat so its shadow box stays on it. */
  private key = new DirectionalLight(new Color(0xffe8cc), 2.2);
  /** Back-left of the mat in its own frame, so shadows fall towards the player. */
  private keyOffset = new Vector3(-0.75, 1.05, -0.55);
  private keyTmp = new Vector3();
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
  private dimmer = new Dimmer();
  private stage!: HoloStage;
  private roomModel = new RoomModel();
  private demo: { c: Creature; t: number; idle: number; yaw: number; pull: number; grabbed: boolean; grabX: number; grabZ: number } | null = null;
  private inspectClose!: Button;
  private quality = new QualityGuard();
  private handBodies!: HandBodies;
  /** Film capture: the emulator has no real hands to see through passthrough. */
  private alwaysGhostHands = false;
  private titleQueued = false;
  private titleOnMat = false;
  private pendingResult: GameSystem['celebrate'] = null;
  private foldReadyAt: number | null = null;
  private awakeAt: number | null = null;
  private pause = new Pause();
  private paused = false;
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
    // Soft studio light: a warm window key that casts the only shadows (a
    // tight box around the mat), a cool fill, and a low sky/ground bounce;
    // the scene's gradient environment does the rest.
    const hemi = new HemisphereLight(new Color(0xfff1e0), new Color(0x5a4a3c), 0.55);
    this.key.castShadow = false;
    this.key.shadow.mapSize.set(1024, 1024);
    const cam = this.key.shadow.camera;
    cam.left = cam.bottom = -0.6;
    cam.right = cam.top = 0.6;
    cam.near = 0.1;
    cam.far = 3;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.008;
    this.key.shadow.radius = 4;
    const fill = new DirectionalLight(new Color(0xcfdcff), 0.35);
    fill.position.set(-1.2, 1.4, -0.4);
    this.world.scene.add(hemi, this.key, this.key.target, fill);

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
      onOpened: () => {
        const sheet = validateSheet(this.progress.sheet);
        if (sheet?.id === this.game.level.id) this.game.restoreSheet(sheet);
        this.saveSheet();
      },
      onChanged: () => this.saveSheet(),
      onSolved: (level, _paper, _root, result) => {
        this.progress.sheet = null;
        this.saveProgress();
        this.zoo.cheer();
        this.celebrate = { t: 0, level, revealed: false, firstSolve: !this.progress.titleSeen && !this.progress.solved.length && !(this.progress.daily?.length), vanished: false, where: '', sayAt: Infinity, nextAt: Infinity, result };
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
      onSave: (folds) => this.saveCustom(folds),
    });
    this.album = new Album(this.world);
    this.album.onInspect = (kind, look, times) => this.inspect(kind, look, times);
    this.resultCard = new ResultCard(this.world, this.game.boardEntity, (a) => this.afterResult(a));
    this.world.createTransformEntity(this.badge.root, this.game.boardEntity);
    this.badge.root.position.set(0, 0.36, -0.12);
    this.zoo.onAwake = () => {
      if (this.awakeAt === null && this.sessionTime >= 0) this.awakeAt = this.sessionTime;
    };
    this.zoo.onPalmRide = () => this.count('palm');
    this.zoo.onWave = () => this.count('waves');
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
      mine: () =>
        [...(this.progress.custom ?? [])]
          .reverse()
          .map((code, i, all) => ({ level: customLevel(code, all.length - 1 - i), code: formatCode(code) })),
      free: () => {
        this.resultCard.hide();
        this.game.loadFree(FREE_LEVEL);
        this.game.hidePaper(false);
      },
      playLevel: (level) => {
        this.resultCard.hide();
        this.game.loadCustom(level, level.world === -3 ? 'My puzzle' : 'Shared puzzle');
        this.game.hidePaper(false);
      },
    });
    this.settingsPanel = new SettingsPanel(this.world, this.settings, (state) => {
      this.applySettings(state);
      saveSettings(state);
    }, { sound: () => !isMuted(), toggleSound: () => this.toggleSound(), restart: () => this.game.restart(), moveMat: () => this.place(true) });
    this.menu = new PalmMenu(this.world, [
      { icon: 'levels', label: 'Levels', run: () => this.openLevels(this.game.level.world) },
      { icon: 'album', label: 'Album', run: () => this.album.show(this.zoo.collection(), this.streak(), this.world.camera, this.badgeEntries()) },
      { icon: 'daily', label: 'Daily Fold', run: () => this.toggleDaily() },
      { icon: 'settings', label: 'Settings', run: () => {
        this.album.hide();
        this.settingsPanel.open();
      } },
    ]);
    this.menu.hands = this.hands;
    this.applySettings(this.settings);
    this.world.createTransformEntity(this.title.root);
    this.game.boardRoot.add(this.title.paper);
    this.title.onGathered = () => {
      if (this.titleOnMat && !this.game.solved) this.game.hidePaper(false);
    };
    this.title.onFinished = () => {
      this.game.setStage(true);
      this.stage.dismiss();
      this.titleOnMat = false;
      const result = this.pendingResult;
      this.pendingResult = null;
      if (result) this.showResult(result);
    };
    this.world.scene.add(this.dimmer.mesh);
    this.handBodies = new HandBodies(this.world);
    this.game.handBodies = this.handBodies;
    this.stage = new HoloStage(this.world);
    this.game.boardRoot.add(this.stage.root);
    this.world.scene.add(this.stage.labels);
    this.game.boardRoot.add(this.roomModel.root);
    this.inspectClose = new Button('close', () => this.endInspect(), 'Close', { r: 0.02 });
    this.inspectClose.root.name = 'Inspect_close';
    this.inspectClose.root.position.y = -50;
    this.inspectClose.root.rotation.x = 0.55;
    const closeEntity = this.world.createTransformEntity(this.inspectClose.root, this.game.boardEntity);
    closeEntity.addComponent(RayInteractable);
    closeEntity.addComponent(PokeInteractable);
    this.roomModel.root.position.set(0, 0.25, -0.03);
    if (this.progress.muted) {
      setMuted(true);
      this.game.button('sound')?.setIcon('mute');
    }
    const sheet = validateSheet(this.progress.sheet);
    this.progress.sheet = sheet;
    const campaign = sheet ? LEVELS.findIndex((l) => l.id === sheet.id) : -1;
    if (sheet?.id === dailyLevel().id) {
      this.game.loadDaily(dailyLevel(), 'A new fold every day');
      this.game.button('daily')?.setIcon('back');
    } else if (sheet?.id.startsWith('my-')) {
      const code = sheet.id.slice(3);
      this.game.loadCustom(customLevel(code, (this.progress.custom ?? []).indexOf(code)), `My puzzles  ·  ${formatCode(code)}`);
    } else this.game.loadLevel(campaign >= 0 ? campaign : this.progress.level);
    // A shared link (?p=CODE) opens that puzzle straight away and keeps it.
    const shared = new URLSearchParams(location.search).get('p');
    const sharedFolds = shared ? decodeFolds(shared) : null;
    if (shared && sharedFolds) {
      const code = encodeFolds(sharedFolds);
      this.addCustom(code);
      this.game.loadCustom(customLevel(code, -1), `Shared puzzle  ·  ${formatCode(code)}`);
    }
    this.game.boardRoot.position.copy(DESKTOP_POSITION);
    this.desk = makeDesk();
    this.game.boardRoot.add(this.desk);
    this.setMode('desktop');

    if (import.meta.env.DEV) {
      // Test hook: board point (u, v, height) → world position.
      (window as unknown as Record<string, unknown>).__foldlings = {
        fov: () => viewFov(this.world),
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
        progress: () => this.progress,
        firstRun: () => ({
          sessionTime: this.sessionTime,
          placed: !!this.placed,
          canFold: this.game.canFold,
          paperVisible: this.game.paperVisible,
          scanActive: this.scan.active,
          modelShowing: this.roomModel.showing,
          titlePlaying: this.title.playing,
          titleSeen: !!this.progress.titleSeen,
          foldReadyAt: this.foldReadyAt,
          awakeAt: this.awakeAt,
        }),
        resetFirstRun: () => {
          this.progress.titleSeen = false;
          this.progress.sheet = null;
          this.saveProgress();
        },
        room: () => this.room,
        levels: (w = -1) => this.openLevels(w),
        book: () => this.levelSelect,
        skipTitle: () => {
          this.titleQueued = false;
          this.title.stop();
        },
        album: () => this.album.show(this.zoo.collection(), this.streak(), this.world.camera, this.badgeEntries()),
        hands: () => this.hands,
        inspect: (kind: CreatureKind = 'crane', look = 0, times = 3) => this.inspect(kind, look, times),
        inspectEnd: () => this.endInspect(),
        replayTitle: () => {
          this.titleQueued = true;
        },
        /** A well-played save, for filming the menus with something in them. */
        filmNoHands: (on: boolean) => this.handBodies.hideAll(on),
        filmQuiet: (on: boolean) => {
          this.game.hintsOff = on;
          this.game.board.setHintsVisible(!on);
        },
        filmSeed: (unearned: string[] = []) => {
          const p = this.progress;
          p.best = {};
          p.solved = [];
          LEVELS.slice(0, 46).forEach((l, i) => {
            p.best![l.id] = { stars: i % 7 === 3 ? 2 : 3, folds: l.par };
            p.solved.push(l.id);
          });
          p.worlds = [0, 1, 2, 3];
          p.badges = ACHIEVEMENTS.map((a) => a.id).filter((id) => !unearned.includes(id));
          p.custom = [LEVELS[12], LEVELS[33], LEVELS[57]].map((l) => encodeFolds(l.solution));
          const today = dayNumber();
          p.daily = [today - 4, today - 3, today - 2, today - 1];
          this.saveProgress();
        },
        ghostHands: (on: boolean) => {
          this.alwaysGhostHands = on;
          this.handBodies.setGhost(on || this.mode === 'vr');
        },
        resultPreview: () =>
          this.resultCard.show('Crane', 'Paper world', { stars: 3, folds: 3, par: 3, hinted: false, perfect: true } as never, undefined),
        badgePreview: (t = 'First fold') => this.badge.show(t),
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
    const playable = (state: VisibilityState) => state === VisibilityState.Visible || state === VisibilityState.NonImmersive;
    let visible = true;
    this.cleanupFuncs.push(this.world.visibilityState.subscribe((state) => {
      const next = playable(state);
      const action = this.pause.transition(visible, next, performance.now() / 1000);
      visible = next;
      if (action === 'pause') {
        this.paused = true;
        suspendAudio();
        this.game.pause();
      } else if (action === 'resume' || action === 'remind') {
        this.paused = false;
        resumeAudio();
        this.game.resume();
        if (action === 'remind') this.game.say('Picked up where you left off', 3);
      }
    }));
    this.world.renderer.xr.addEventListener('sessionstart', () => {
      startMusic();
      this.sessionTime = 0;
      this.lastScan = -10;
      this.foldReadyAt = null;
      this.awakeAt = null;
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

  /** Your scanned room in miniature, from the live scan. */
  private showRoomModel() {
    const marks = this.zoo.positions().map((c) => new Vector3().fromArray(c.p));
    marks.push(this.game.boardRoot.getWorldPosition(new Vector3()));
    this.roomModel.show(this.roomSurfaces(), this.meshInfos(), marks);
    if (!this.roomModel.showing) return;
    this.stage.present(0.05, 0.4);
    this.stage.setCallout(0, this.roomModel.root, [0.1, 0.1, 0], 0.2, 0.06, 'YOUR ROOM', `${this.roomModel.width.toFixed(1)} X ${this.roomModel.depth.toFixed(1)} M`);
    this.stage.setCallout(1, this.roomModel.root, [-0.1, 0, 0], -0.2, 0.02, `${this.roomModel.count} SURFACES`, 'READ JUST NOW');
    this.roomModelOn = true;
  }
  private roomModelOn = false;

  /** Labels, slice and vitals around a creature on the projection table. */
  private updatePresentation(dt: number) {
    const p = this.zoo.presentation();
    if (p && p.c !== this.presented) {
      this.presented = p.c;
      this.beatIn = 0;
      p.c.setPresenting(true);
      this.stage.present(0.05, 0.36);
      this.stage.showTrace(3);
      const c = this.celebrate;
      const [head, a, b, d] = p.c.anchors;
      const where = c
        ? c.level.world >= 0
          ? `${WORLDS[c.level.world].name.toUpperCase()} WORLD ${c.level.slot + 1}/${PER_WORLD}`
          : c.level.name.toUpperCase()
        : '';
      this.stage.setCallout(0, head, [0, 0, 0], 0.19, 0.07, p.c.kind.toUpperCase(), where);
      if (c) {
        this.stage.setCallout(1, a, [0, 0, 0], 0.19, -0.03, `FOLDS ${c.result.folds} PAR ${c.result.par}`, `${c.result.stars} OF 3 STARS`);
      }
      this.stage.setCallout(2, b, [0, 0, 0], -0.19, 0.05, `${p.c.facets} FACETS`, `${this.game.paper.facets.length} PANELS IN THE SHEET`);
      this.stage.setCallout(3, d, [0, 0, 0], -0.19, -0.05, 'VITALS', 'FORMING');
    }
    if (p) {
      p.c.setScan(this.stage.scanY);
      // Pulled apart once, mid-turn, to show how it is made.
      const e = Math.sin(Math.min(1, Math.max(0, (p.left - 0.9) / 2.2)) * Math.PI);
      p.c.setExplode(0.013 * e * e);
      this.stage.setAwake(p.awake);
      if (p.awake) {
        if (!this.wasAwake) this.stage.setCallout(3, p.c.anchors[3], [0, 0, 0], -0.19, -0.05, 'VITALS', 'AWAKE');
        this.beatIn -= dt;
        if (this.beatIn <= 0 && p.left > 0.8) {
          this.beatIn = 1 / 0.9;
          sfx.beep();
        }
      }
      this.wasAwake = p.awake;
      if (p.left < 0.8 && !this.roomModel.showing && !this.title.playing) this.stage.dismiss();
    } else if (this.presented) {
      this.presented.setPresenting(false);
      this.presented = null;
      this.wasAwake = false;
      if (!this.roomModel.showing && !this.title.playing) this.stage.dismiss();
    }
  }
  private presented: Creature | null = null;
  private wasAwake = false;
  private beatIn = 0;

  /** Puts a kind from the album on the table, large, under the full projection. */
  private inspect(kind: CreatureKind, look: number, times: number) {
    this.endInspect();
    this.album.hide();
    const c = new Creature(kind, LOOKS[look % LOOKS.length]);
    c.root.scale.setScalar(c.tableScale);
    c.root.position.set(0, 0.17, -0.02);
    this.game.boardRoot.add(c.root);
    this.game.hidePaper(true);
    this.game.setStage(false);
    c.setPresenting(true);
    this.demo = { c, t: 0, idle: 0, yaw: 0, pull: 0, grabbed: false, grabX: 0, grabZ: 0 };
    this.game.inputLocked = true;
    this.inspectClose.root.position.set(0, 0.06, 0.2);
    this.stage.present(0.05, 0.42);
    const [head, a, b] = c.anchors;
    this.stage.setCallout(0, head, [0, 0, 0], 0.2, 0.07, kind.toUpperCase(), times > 0 ? `FOLDED ${times} ${times === 1 ? 'TIME' : 'TIMES'}` : 'IN YOUR ZOO');
    this.stage.setCallout(1, a, [0, 0, 0], 0.2, -0.03, `${c.facets} FACETS`, `${HABITAT[kind].toUpperCase()} HABITAT`);
    this.stage.setCallout(2, b, [0, 0, 0], -0.2, 0.04, 'INNER LAYER', 'SHOWN IN AMBER');
    sfx.power();
  }

  private endInspect() {
    if (!this.demo) return;
    this.demo.c.setPresenting(false);
    this.demo.c.root.removeFromParent();
    this.demo.c.dispose();
    this.demo = null;
    this.inspectClose.root.position.y = -50;
    this.game.inputLocked = false;
    this.stage.dismiss();
    this.game.hidePaper(false);
    this.game.setStage(true);
  }

  private updateDemo(dt: number) {
    const d = this.demo;
    if (!d) return;
    d.c.update(dt);
    const { left, right } = this.handBodies.pinch;
    const both = left.on && right.on;
    const one = !both && (left.on || right.on) ? (left.on ? left : right) : null;
    if (both || one) d.idle = 0;
    else d.idle += dt;
    // Two hands pull it apart; one hand turns it; left alone it turns by itself.
    if (both) {
      d.pull = Math.max(0, Math.min(1, (left.at.distanceTo(right.at) - 0.14) / 0.38));
    } else {
      d.pull = Math.max(0, d.pull - dt * 0.8);
    }
    if (one) {
      this.world.camera.getWorldDirection(this.ear);
      if (d.grabbed) {
        // Dragging across the view turns the body the same way.
        const dx = (one.at.x - d.grabX) * -this.ear.z + (one.at.z - d.grabZ) * this.ear.x;
        d.yaw += dx * 8;
      }
      d.grabbed = true;
      d.grabX = one.at.x;
      d.grabZ = one.at.z;
    } else {
      d.grabbed = false;
      d.yaw += dt * 0.42;
    }
    d.c.root.rotation.y = d.yaw;
    d.t += dt;
    const breathe = 0.5 - 0.5 * Math.cos(d.t * 0.7);
    d.c.setExplode(Math.max(0.013 * breathe * breathe, 0.05 * d.pull));
    d.c.setScan(this.stage.scanY);
    if (d.idle > INSPECT_SECONDS) this.endInspect();
  }

  /** Gives up the costliest extras if a headset cannot hold its frame rate. */
  private lowerQuality() {
    if (this.quality.level === 1) this.world.renderer.xr.setFoveation(1);
    if (this.quality.level === 1) HoloVolume.steps = 18;
    if (this.quality.level === 2) {
      this.stage.lowPower = true;
      HoloVolume.steps = 12;
    }
    console.info(`[foldlings] quality step ${this.quality.level}`);
  }

  /** The room lowers its lights a little while paper comes to life. */
  private heroDim(): number {
    const c = this.celebrate;
    return c && !this.settings.reduceMotion && c.t < c.nextAt ? 0.8 : 0;
  }

  private setMode(mode: 'desktop' | 'ar' | 'vr') {
    this.mode = mode;
    // Keeps the paper's colours as saturated as they were printed.
    this.world.renderer.toneMapping = NeutralToneMapping;
    this.world.renderer.toneMappingExposure = 1;
    this.handBodies?.setGhost(mode === 'vr' || this.alwaysGhostHands);
    this.zoo.realRoom = mode === 'ar';
    const virtual = mode !== 'ar';
    this.vroom.root.visible = virtual;
    this.desk.visible = virtual;
    // Dusk light from the study's window; a neutral lamp over a real table.
    this.key.color.set(0xbfe6ff);
    this.key.intensity = virtual ? 1.6 : 1.2;
    this.game.board.setShadowCatcher(false);
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
    this.game.readyPaper();
    this.recordFoldReady();
    // Sweep the room in the background while folding is already available.
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
    // The spot before the comfort nudge, which is applied on top each visit.
    const p = this.room.root.worldToLocal(this.moveTo.clone());
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
    // Back in a known room: no sweep, straight to the paper.
    this.lastScan = this.sessionTime;
    this.game.readyPaper();
    this.recordFoldReady();
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
    // Rebuilt when the scan, the mat or the player's spot changes (a quarter
    // metre or more), so the seat under them never hides the mat.
    const head = this.world.camera.getWorldPosition(this.ear);
    const q = (v: number) => Math.round(v * 4);
    const key = `${planes.length}:${meshes.length}:${mat.x.toFixed(2)},${mat.y.toFixed(2)},${mat.z.toFixed(2)}:${q(head.x)},${q(head.y)},${q(head.z)}`;
    if (key === this.occluderKey) return;
    this.occluderKey = key;
    this.occluders.update(planes, meshes, mat, head);
  }

  /** Free fold's Save: the folds become a puzzle in My puzzles. */
  private saveCustom(folds: FoldSpec[]) {
    if (folds.length === 0) {
      this.game.say('Fold the paper first, then save it', 3);
      return;
    }
    if (folds.length > 6) {
      this.game.say('Keep it to six folds or fewer to save it', 3.5);
      return;
    }
    const code = encodeFolds(folds);
    const n = this.addCustom(code);
    sfx.badge();
    this.game.say(`Saved as My puzzle ${n}  ·  code ${formatCode(code)}`, 6);
  }

  /** Adds a puzzle code (once) and returns its number in My puzzles. */
  private addCustom(code: string): number {
    this.progress.custom ??= [];
    if (!this.progress.custom.includes(code)) {
      this.progress.custom.push(code);
      if (this.progress.custom.length > 20) this.progress.custom.shift();
      this.saveProgress();
    }
    return this.progress.custom.indexOf(code) + 1;
  }

  private count(what: 'palm' | 'waves') {
    this.progress.counters ??= {};
    this.progress.counters[what] = (this.progress.counters[what] ?? 0) + 1;
    this.checkBadges();
    this.saveProgress();
  }

  private badgeStats(): AchievementStats {
    const best = this.progress.best ?? {};
    let flawless = 0;
    for (let w = 0; w < WORLDS.length; w++) {
      if (LEVELS.filter((l) => l.world === w).every((l) => best[l.id]?.stars === 3)) flawless++;
    }
    const kinds = this.zoo.collection().filter((e) => e.looks.length > 0).length;
    return {
      solves: Object.keys(best).length,
      perfects: Object.values(best).filter((b) => b.stars === 3).length,
      worldsDone: (this.progress.worlds ?? []).length,
      flawlessWorlds: flawless,
      streak: this.streak(),
      kinds,
      zoo: this.zoo.count,
      palmRides: this.progress.counters?.palm ?? 0,
      waves: this.progress.counters?.waves ?? 0,
    };
  }

  /** Awards any badge just earned, one pop-up each. */
  private checkBadges() {
    this.progress.badges ??= [];
    for (const id of newlyEarned(this.badgeStats(), this.progress.badges)) {
      this.progress.badges.push(id);
      const a = ACHIEVEMENTS.find((x) => x.id === id);
      if (a) this.badge.show(a.title);
    }
  }

  private badgeEntries() {
    const got = this.progress.badges ?? [];
    return ACHIEVEMENTS.map((a) => ({ title: a.title, how: a.how, earned: got.includes(a.id) }));
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

  private recordFoldReady() {
    if (this.foldReadyAt === null && this.sessionTime >= 0 && this.placed && this.game.paperVisible && this.game.canFold) {
      this.foldReadyAt = this.sessionTime;
    }
  }

  private saveSheet() {
    this.progress.sheet = this.game.isFree || this.game.solved ? null : serialiseSheet(this.game.level.id, this.game.playedFolds, this.game.wasHinted);
    this.saveProgress();
  }

  private playTitle(onMat: boolean) {
    this.titleOnMat = onMat;
    this.game.boardRoot.updateWorldMatrix(true, false);
    this.title.root.position.set(0, 0.2, -0.17).applyMatrix4(this.game.boardRoot.matrixWorld);
    this.title.root.lookAt(this.world.camera.getWorldPosition(this.ear));
    if (onMat) this.game.hidePaper(true);
    this.game.setStage(false);
    this.stage.present(0.05, 0.3);
    sfx.power();
    this.title.play(this.game.level.look.front);
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
      c.nextAt = c.t + prelude + 2.0;
      if (this.game.isDaily) {
        const days = new Set(this.progress.daily ?? []);
        days.add(dayNumber());
        this.progress.daily = [...days].sort((a, b) => a - b).slice(-120);
      } else {
        if (!this.progress.solved.includes(c.level.id)) this.progress.solved.push(c.level.id);
        this.progress.level = (this.game.levelIndex + 1) % LEVELS.length;
        this.progress.best ??= {};
        const before = totalStars(this.progress.best);
        this.progress.best[c.level.id] = mergeBest(this.progress.best[c.level.id], c.result);
        const after = totalStars(this.progress.best);
        const w = c.level.world;
        const done = LEVELS.filter((l) => l.world === w).every((l) => this.progress.best![l.id]);
        this.progress.worlds ??= [];
        const lines: string[] = [];
        c.worldDone = -1;
        if (done && !this.progress.worlds.includes(w)) {
          this.progress.worlds.push(w);
          c.worldDone = w;
          let s = 0;
          for (const l of LEVELS) if (l.world === w) s += this.progress.best[l.id]?.stars ?? 0;
          lines.push(`${WORLDS[w].name} world complete, ${s} of ${PER_WORLD * 3} stars`);
        }
        for (let k = 0; k < WORLDS.length; k++) {
          if (!worldOpen(k, before) && worldOpen(k, after)) lines.push(`${WORLDS[k].name} world unlocked`);
        }
        c.banner = lines.join('   ·   ');
      }
      if (c.level.world >= 0 || this.game.isDaily) {
        this.checkBadges();
      }
      this.saveProgress();
    }
    if (c.t > c.sayAt) {
      c.sayAt = Infinity;
      if (c.firstSolve && !this.settings.reduceMotion) this.showRoomModel();
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
    // The first solve shows the room model as the creature leaves; let it finish.
    if (c.t > c.nextAt && !(c.firstSolve && this.roomModel.showing)) {
      this.celebrate = null;
      this.lastLevel = c.level;
      if (!this.progress.titleSeen) {
        this.progress.titleSeen = true;
        this.saveProgress();
        if (!this.settings.reduceMotion) {
          this.pendingResult = c;
          this.playTitle(false);
        } else this.showResult(c);
      } else this.showResult(c);
      if (c.worldDone !== undefined && c.worldDone >= 0 && !this.settings.reduceMotion) {
        this.zoo.parade(WORLDS[c.worldDone].kind, c.level.look.front);
      }
    }
  }

  private showResult(c: NonNullable<GameSystem['celebrate']>) {
    const sub =
      c.level.world === -1
        ? 'Daily Fold'
        : c.level.world < 0
          ? `My puzzles  ·  ${formatCode(c.level.id.replace(/^my-/, ''))}`
          : `${WORLDS[c.level.world].name} world  ·  ${c.level.slot + 1} / ${PER_WORLD}`;
    this.resultCard.show(c.level.name, sub, c.result, this.progress.best?.[c.level.id], c.banner ?? '');
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
      if (last.world === -1) this.game.loadDaily(last, 'Daily Fold');
      else if (last.world < 0) this.game.loadCustom(last, 'My puzzle');
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
    if (this.paused) return;
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
        if (this.placed && this.lastScan < 0 && surfaces.length) {
          this.lastScan = this.sessionTime;
          this.scan.start(surfaces, this.player.head.getWorldPosition(this.ear), this.placed.onSurface ? this.placed.position : null);
        }
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
    if (this.moveT < 1 || this.placed) {
      this.moveT = Math.min(1, this.moveT + delta / 0.6);
      const e = 1 - Math.pow(1 - this.moveT, 3);
      const root = this.game.boardRoot;
      root.position.lerpVectors(this.moveFrom, this.moveTo, e);
      root.quaternion.setFromAxisAngle(this.up, this.yawFrom + (this.yawTo - this.yawFrom) * e);
      // Comfort nudge from the settings: up or down, nearer or farther.
      if (this.placed) {
        const d = this.settings.matDistance * MAT_STEP.matDistance * 0.01;
        root.position.x -= Math.sin(this.yawTo) * d;
        root.position.z -= Math.cos(this.yawTo) * d;
        root.position.y += this.settings.matHeight * MAT_STEP.matHeight * 0.01;
      }
    }
    if (this.celebrate) this.updateCelebration(delta);
    this.recordFoldReady();
    if (this.titleQueued && this.sessionTime > 1 && this.moveT >= 1 && !this.title.playing) {
      this.titleQueued = false;
      this.playTitle(true);
    }
    this.title.update(delta);
    this.handBodies.update(delta);
    this.vroom.update(delta);
    if (this.world.renderer.xr.isPresenting && this.quality.update(delta)) this.lowerQuality();
    this.dimmer.update(delta, this.mode === 'ar' ? Math.max(this.settings.dimRoom ? THEATRE_DIM : 0, this.title.dim * 0.86, this.heroDim(), this.demo ? 0.84 : 0) : 0, this.world.camera);
    tickHolo(delta);
    this.stage.update(delta);
    this.roomModel.update(delta);
    this.updateDemo(delta);
    this.inspectClose.update(delta);
    this.updatePresentation(delta);
    this.game.board.setDecorationStrength(this.title.playing || this.presented || this.demo || this.roomModel.showing ? 1 : 0.4);
    if (this.roomModelOn && !this.roomModel.showing) {
      this.roomModelOn = false;
      if (!this.demo && !this.title.playing) this.stage.dismiss();
    }
    this.game.boardRoot.getWorldPosition(this.key.target.position);
    this.keyTmp.copy(this.keyOffset).applyQuaternion(this.game.boardRoot.quaternion);
    this.key.position.copy(this.key.target.position).add(this.keyTmp);
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
    this.resultCard.update(delta, this.handBodies.pinch);
    this.badge.update(delta);
    this.levelSelect.update(delta, this.handBodies.pinch);
    this.settingsPanel.update(delta);
    this.game.board.setCardAway(
      this.title.playing || !!this.celebrate || !!this.demo || this.roomModel.showing || this.menu.isOpen || this.album.isOpen || this.levelSelect.isOpen || this.settingsPanel.isOpen || this.resultCard.showing,
      delta,
    );
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
  p.titleSeen ??= !!(p.solved?.length || p.daily?.length || Object.keys(p.best ?? {}).length);
  if (p.version === 2) return p;
  const next = LEVELS.findIndex((l) => l.id === OLD_ORDER[p.level]);
  const best: Record<string, Best> = {};
  for (const id of p.solved ?? []) best[id] = { stars: 1, folds: 99 };
  return { ...p, level: Math.max(0, next), best, version: 2 };
}
